import { Hono } from "hono";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import {
  actionItems,
  actionProgress,
  attachments,
  codes,
  departments,
  employees,
  meetings,
  notifications,
  sequences,
} from "../db/schema";
import type { AppEnv, Db } from "../env";
import { writeAudit } from "../lib/audit";
import { Errors } from "../lib/errors";
import { clientIp, requireAuth } from "../middleware/session";
import { actionDisplayNumbers } from "@shared/action";
import { ISO_DATE_PATTERN } from "@shared/meeting";
import type {
  ActionItemRecord,
  ActionListResponse,
  ActionMeetingOption,
  ActionRegisterOptionsResponse,
  ActionTrackingItem,
  ActionTrackingDetailResponse,
  ActionTrackingResponse,
} from "@shared/types";
import { toKstDateString } from "@shared/week";

const itemSchema = z.object({
  meetingId: z.number().int().positive().nullable(),
  meetingTypeCode: z.string().trim().min(1, "회의구분을 선택하세요.").max(30),
  meetingDate: z.string().regex(ISO_DATE_PATTERN, "회의일자를 확인하세요."),
  departmentId: z.number().int().positive("부서를 선택하세요."),
  subject: z.string().trim().min(1, "주제를 입력하세요.").max(50, "주제는 50자 이하로 입력하세요."),
  request: z.string().trim().min(1, "주요 이슈 및 요청 사항을 입력하세요.").max(1_000),
});
const batchSchema = z.object({ items: z.array(itemSchema).min(1).max(200) });
const progressSchema = z.object({
  dueDate: z.string().regex(ISO_DATE_PATTERN, "기한을 확인하세요."),
  status: z.enum(["in_progress", "hold", "done"]),
  content: z.string().trim().min(1, "진행내용을 입력하세요.").max(2_000, "진행내용은 2,000자 이하로 입력하세요."),
});

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw Errors.badRequest("올바르지 않은 액션아이템입니다.");
  return id;
}

async function typeOptions(db: Db) {
  return db.select({ code: codes.code, name: codes.name }).from(codes).where(and(
    eq(codes.groupCode, "MEETING_TYPE"), eq(codes.isActive, true),
  )).orderBy(asc(codes.sortOrder), asc(codes.name));
}

async function publishedMeetings(db: Db): Promise<ActionMeetingOption[]> {
  const rows = await db.select({
    id: meetings.id,
    displayNo: meetings.displayNo,
    typeCode: meetings.typeCode,
    typeName: codes.name,
    meetingDate: meetings.meetingDate,
    timePlace: meetings.timePlace,
    chair: meetings.chair,
    bodyText: meetings.bodyText,
  }).from(meetings).leftJoin(codes, and(
    eq(codes.groupCode, "MEETING_TYPE"), eq(meetings.typeCode, codes.code),
  )).where(eq(meetings.status, "published"))
    .orderBy(desc(meetings.meetingDate), desc(meetings.id)).limit(100);
  return rows.map((row) => ({
    ...row,
    displayNo: row.displayNo ?? "",
    typeName: row.typeName ?? row.typeCode,
    chair: row.chair ?? "",
  }));
}

async function validateAndNormalize(db: Db, items: z.infer<typeof itemSchema>[]) {
  const meetingIds = [...new Set(items.flatMap((item) => item.meetingId ? [item.meetingId] : []))];
  const meetingRows = meetingIds.length
    ? await db.select().from(meetings).where(inArray(meetings.id, meetingIds))
    : [];
  const meetingMap = new Map(meetingRows.map((meeting) => [meeting.id, meeting]));
  if (meetingRows.some((meeting) => meeting.status !== "published") || meetingRows.length !== meetingIds.length) {
    throw Errors.badRequest("등록된 회의록만 연결할 수 있습니다.");
  }
  const [types, deptRows] = await Promise.all([
    typeOptions(db),
    db.select({ id: departments.id }).from(departments).where(eq(departments.isActive, true)),
  ]);
  const typeSet = new Set(types.map((type) => type.code));
  const deptSet = new Set(deptRows.map((department) => department.id));
  return items.map((item) => {
    const meeting = item.meetingId ? meetingMap.get(item.meetingId) : null;
    const normalized = meeting ? {
      ...item, meetingTypeCode: meeting.typeCode, meetingDate: meeting.meetingDate,
    } : item;
    if (!typeSet.has(normalized.meetingTypeCode)) throw Errors.badRequest("등록되지 않은 회의구분입니다.");
    if (!deptSet.has(normalized.departmentId)) throw Errors.badRequest("등록되지 않거나 사용 중지된 부서입니다.");
    return normalized;
  });
}

async function notifyDepartmentLeaders(
  db: Db,
  departmentIds: number[],
  input: { message: (departmentName: string, count: number) => string; dedupe: string },
) {
  if (!departmentIds.length) return;
  const rows = await db.select({ id: departments.id, name: departments.name, leaderId: departments.leaderId })
    .from(departments).where(inArray(departments.id, [...new Set(departmentIds)]));
  const counts = new Map<number, number>();
  for (const id of departmentIds) counts.set(id, (counts.get(id) ?? 0) + 1);
  const values = rows.flatMap((department) => department.leaderId ? [{
    recipientId: department.leaderId,
    type: "action.assigned",
    message: input.message(department.name, counts.get(department.id) ?? 1),
    link: "/actions/tracking?departmentId=" + department.id,
    dedupeKey: input.dedupe + ":" + department.id + ":" + department.leaderId,
  }] : []);
  if (values.length) await db.insert(notifications).values(values).onConflictDoNothing();
}

export const actionRoutes = new Hono<AppEnv>()
  .use("*", requireAuth())
  .get("/register/options", async (c) => {
    const [meetingRows, types, deptRows] = await Promise.all([
      publishedMeetings(c.var.db),
      typeOptions(c.var.db),
      c.var.db.select({
        id: departments.id, code: departments.code, name: departments.name,
        leaderId: departments.leaderId, isActive: departments.isActive,
      }).from(departments).where(eq(departments.isActive, true))
        .orderBy(asc(departments.sortOrder), asc(departments.name)),
    ]);
    return c.json<ActionRegisterOptionsResponse>({
      meetings: meetingRows,
      meetingTypes: types,
      departments: deptRows,
      canEdit: c.var.user!.isClerk,
    });
  })
  .get("/tracking", async (c) => {
    const user = c.var.user!;
    const departmentParam = c.req.query("departmentId")?.trim();
    const departmentId = departmentParam ? parseId(departmentParam) : null;
    const status = c.req.query("status")?.trim() ?? "";
    if (status && !["unregistered", "in_progress", "hold", "done"].includes(status)) {
      throw Errors.badRequest("진행여부 필터를 확인하세요.");
    }
    const from = c.req.query("from")?.trim() ?? "";
    const to = c.req.query("to")?.trim() ?? "";
    if ((from && !ISO_DATE_PATTERN.test(from)) || (to && !ISO_DATE_PATTERN.test(to))) {
      throw Errors.badRequest("회의일자 필터를 확인하세요.");
    }
    const hideCompleted = c.req.query("hideCompleted") === "true";
    const [rows, deptRows, types] = await Promise.all([
      c.var.db.select({
        id: actionItems.id,
        displayNo: actionItems.displayNo,
        meetingId: actionItems.meetingId,
        meetingTypeCode: actionItems.meetingTypeCode,
        meetingDate: actionItems.meetingDate,
        departmentId: actionItems.departmentId,
        departmentName: departments.name,
        subject: actionItems.subject,
        request: actionItems.request,
        status: actionItems.status,
        latestProgressText: actionItems.latestProgressText,
        latestProgressDate: actionItems.latestProgressDate,
        completedDate: actionItems.completedDate,
        isCompleted: actionItems.isCompleted,
      }).from(actionItems).innerJoin(departments, eq(actionItems.departmentId, departments.id))
        .orderBy(desc(actionItems.meetingDate), asc(departments.sortOrder), asc(actionItems.id)),
      c.var.db.select({
        id: departments.id, code: departments.code, name: departments.name,
        leaderId: departments.leaderId, isActive: departments.isActive,
      }).from(departments).where(eq(departments.isActive, true))
        .orderBy(asc(departments.sortOrder), asc(departments.name)),
      typeOptions(c.var.db),
    ]);
    const typeMap = new Map(types.map((type) => [type.code, type.name]));
    const scoped = rows.filter((row) =>
      (!departmentId || row.departmentId === departmentId)
      && (!from || row.meetingDate >= from)
      && (!to || row.meetingDate <= to)
      && (!hideCompleted || row.status !== "done"));
    const filtered = status ? scoped.filter((row) => row.status === status) : scoped;
    const items: ActionTrackingItem[] = filtered.map((row) => ({
      ...row,
      meetingTypeName: typeMap.get(row.meetingTypeCode) ?? row.meetingTypeCode,
      canUpdate: user.departmentId === row.departmentId,
    }));
    const progressDates = scoped.flatMap((row) => row.latestProgressDate ? [row.latestProgressDate] : []);
    return c.json<ActionTrackingResponse>({
      items,
      departments: deptRows,
      summary: {
        total: scoped.length,
        unregistered: scoped.filter((row) => row.status === "unregistered").length,
        inProgress: scoped.filter((row) => row.status === "in_progress").length,
        hold: scoped.filter((row) => row.status === "hold").length,
        done: scoped.filter((row) => row.status === "done").length,
        latestProgressDate: progressDates.sort().at(-1) ?? null,
      },
    });
  })
  .get("/tracking/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const action = await c.var.db.select({
      id: actionItems.id, meetingDate: actionItems.meetingDate,
      departmentId: actionItems.departmentId, status: actionItems.status,
    }).from(actionItems).where(eq(actionItems.id, id)).get();
    if (!action) throw Errors.notFound();
    const historyRows = await c.var.db.select({
      id: actionProgress.id,
      progressDate: actionProgress.progressDate,
      dueDate: actionProgress.dueDate,
      status: actionProgress.status,
      content: actionProgress.content,
      authorId: actionProgress.authorId,
      authorName: employees.name,
      createdAt: actionProgress.createdAt,
    }).from(actionProgress).innerJoin(employees, eq(actionProgress.authorId, employees.id))
      .where(eq(actionProgress.actionId, id))
      .orderBy(desc(actionProgress.progressDate), desc(actionProgress.createdAt));
    const progressIds = historyRows.map((row) => row.id);
    const fileRows = progressIds.length ? await c.var.db.select({
      id: attachments.id, ownerId: attachments.ownerId, fileName: attachments.fileName,
      mimeType: attachments.mimeType, size: attachments.size, r2Key: attachments.r2Key,
    }).from(attachments).where(and(
      eq(attachments.ownerType, "progress"), inArray(attachments.ownerId, progressIds),
    )) : [];
    return c.json<ActionTrackingDetailResponse>({
      actionId: action.id,
      meetingDate: action.meetingDate,
      status: action.status,
      canUpdate: c.var.user!.departmentId === action.departmentId,
      history: historyRows.map((row) => ({
        ...row,
        attachments: fileRows.filter((file) => file.ownerId === row.id).map(({ r2Key, ownerId: _ownerId, ...file }) => ({
          ...file, url: "/api/files/" + r2Key,
        })),
      })),
    });
  })
  .post("/tracking/:id/progress", async (c) => {
    const id = parseId(c.req.param("id"));
    const user = c.var.user!;
    const action = await c.var.db.select().from(actionItems).where(eq(actionItems.id, id)).get();
    if (!action) throw Errors.notFound();
    if (user.departmentId !== action.departmentId) throw Errors.forbidden();
    const input = progressSchema.parse(await c.req.json().catch(() => ({})));
    if (input.dueDate < action.meetingDate) throw Errors.badRequest("기한은 회의일자보다 빠를 수 없습니다.");
    const progressDate = toKstDateString();
    const now = Date.now();
    const inserted = await c.var.db.insert(actionProgress).values({
      actionId: id,
      progressDate,
      dueDate: input.dueDate,
      status: input.status,
      content: input.content,
      authorId: user.id,
      createdAt: now,
    }).returning({ id: actionProgress.id }).get();
    const completed = input.status === "done";
    await c.var.db.update(actionItems).set({
      status: input.status,
      latestProgressText: input.content,
      latestProgressDate: progressDate,
      completedDate: completed ? progressDate : null,
      isCompleted: completed,
      updatedAt: now,
    }).where(eq(actionItems.id, id));
    await writeAudit(c.var.db, {
      actorId: user.id, action: "action.progress_create", targetType: "action", targetId: id,
      after: { progressId: inserted.id, ...input }, ip: clientIp(c),
    });
    return c.json({ id: inserted.id }, 201);
  })
  .get("/", async (c) => {
    const meetingParam = c.req.query("meetingId")?.trim();
    const meetingId = meetingParam ? parseId(meetingParam) : null;
    const rows = await c.var.db.select({
      id: actionItems.id,
      displayNo: actionItems.displayNo,
      meetingId: actionItems.meetingId,
      meetingTypeCode: actionItems.meetingTypeCode,
      meetingDate: actionItems.meetingDate,
      departmentId: actionItems.departmentId,
      departmentName: departments.name,
      subject: actionItems.subject,
      request: actionItems.request,
      status: actionItems.status,
      createdAt: actionItems.createdAt,
    }).from(actionItems).innerJoin(departments, eq(actionItems.departmentId, departments.id))
      .where(meetingId ? eq(actionItems.meetingId, meetingId) : undefined)
      .orderBy(desc(actionItems.meetingDate), asc(departments.sortOrder), asc(actionItems.id));
    const [types, progressRows] = await Promise.all([
      typeOptions(c.var.db),
      c.var.db.select({ actionId: actionProgress.actionId }).from(actionProgress),
    ]);
    const typeMap = new Map(types.map((type) => [type.code, type.name]));
    const progressCounts = new Map<number, number>();
    for (const progress of progressRows) progressCounts.set(progress.actionId, (progressCounts.get(progress.actionId) ?? 0) + 1);
    const items: ActionItemRecord[] = rows.map((row) => ({
      ...row,
      meetingTypeName: typeMap.get(row.meetingTypeCode) ?? row.meetingTypeCode,
      progressCount: progressCounts.get(row.id) ?? 0,
    }));
    return c.json<ActionListResponse>({ items, canEdit: c.var.user!.isClerk });
  })
  .post("/batch", async (c) => {
    const user = c.var.user!;
    if (!user.isClerk) throw Errors.forbidden();
    const parsed = batchSchema.parse(await c.req.json().catch(() => ({})));
    const items = await validateAndNormalize(c.var.db, parsed.items);
    const numbered = new Map<number, string>();
    const byYear = new Map<number, number[]>();
    items.forEach((item, index) => {
      const year = Number(item.meetingDate.slice(0, 4));
      byYear.set(year, [...(byYear.get(year) ?? []), index]);
    });
    for (const [year, indexes] of byYear) {
      const name = "AC-" + year;
      await c.var.db.insert(sequences).values({ name, value: 0 }).onConflictDoNothing();
      const updated = await c.var.db.update(sequences)
        .set({ value: sql`${sequences.value} + ${indexes.length}` })
        .where(eq(sequences.name, name)).returning({ value: sequences.value }).get();
      const numbers = actionDisplayNumbers(year, updated.value - indexes.length + 1, indexes.length);
      indexes.forEach((itemIndex, numberIndex) => numbered.set(itemIndex, numbers[numberIndex]));
    }
    const now = Date.now();
    const inserted = await c.var.db.insert(actionItems).values(items.map((item, index) => ({
      ...item,
      displayNo: numbered.get(index)!,
      status: "unregistered" as const,
      isCompleted: false,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    }))).returning({ id: actionItems.id, displayNo: actionItems.displayNo });
    const batchId = crypto.randomUUID();
    await notifyDepartmentLeaders(c.var.db, items.map((item) => item.departmentId), {
      message: (name, count) => `${name}에 액션아이템 ${count}건이 배정되었습니다.`,
      dedupe: "action-assigned:" + batchId,
    });
    await writeAudit(c.var.db, {
      actorId: user.id, action: "action.batch_create", targetType: "action_batch", targetId: batchId,
      after: { count: inserted.length, displayNos: inserted.map((item) => item.displayNo) }, ip: clientIp(c),
    });
    return c.json({ items: inserted }, 201);
  })
  .patch("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const user = c.var.user!;
    if (!user.isClerk) throw Errors.forbidden();
    const current = await c.var.db.select().from(actionItems).where(eq(actionItems.id, id)).get();
    if (!current) throw Errors.notFound();
    const progress = await c.var.db.select({ id: actionProgress.id }).from(actionProgress)
      .where(eq(actionProgress.actionId, id)).get();
    if (progress) throw Errors.conflict("진행 이력이 있어 수정할 수 없습니다.");
    const parsed = itemSchema.parse(await c.req.json().catch(() => ({})));
    const [input] = await validateAndNormalize(c.var.db, [parsed]);
    await c.var.db.update(actionItems).set({
      meetingId: input.meetingId,
      meetingTypeCode: input.meetingTypeCode,
      meetingDate: input.meetingDate,
      departmentId: input.departmentId,
      subject: input.subject,
      request: input.request,
      updatedAt: Date.now(),
    }).where(eq(actionItems.id, id));
    if (current.departmentId !== input.departmentId) {
      await notifyDepartmentLeaders(c.var.db, [input.departmentId], {
        message: (name) => `${name}에 ${current.displayNo} 액션아이템이 재배정되었습니다.`,
        dedupe: "action-reassigned:" + id + ":" + Date.now(),
      });
    }
    await writeAudit(c.var.db, {
      actorId: user.id, action: "action.update", targetType: "action", targetId: id,
      before: current, after: input, ip: clientIp(c),
    });
    return c.json({ id });
  })
  .delete("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const user = c.var.user!;
    if (!user.isClerk) throw Errors.forbidden();
    const current = await c.var.db.select().from(actionItems).where(eq(actionItems.id, id)).get();
    if (!current) throw Errors.notFound();
    const progress = await c.var.db.select({ id: actionProgress.id }).from(actionProgress)
      .where(eq(actionProgress.actionId, id)).get();
    if (progress) throw Errors.conflict("진행 이력이 있어 삭제할 수 없습니다.");
    await c.var.db.delete(actionItems).where(eq(actionItems.id, id));
    await writeAudit(c.var.db, {
      actorId: user.id, action: "action.delete", targetType: "action", targetId: id,
      before: current, ip: clientIp(c),
    });
    return c.body(null, 204);
  });
