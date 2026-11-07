import { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, like, lte, or } from "drizzle-orm";
import { z } from "zod";
import {
  actionItems,
  attachments,
  codes,
  departments,
  employees,
  meetingAttendees,
  meetings,
} from "../db/schema";
import type { AppEnv } from "../env";
import { writeAudit } from "../lib/audit";
import { Errors } from "../lib/errors";
import { clientIp, requireAuth } from "../middleware/session";
import type {
  MeetingDetailResponse,
  MeetingEmployeeOption,
  MeetingListItem,
  MeetingListResponse,
  MeetingOptionsResponse,
} from "@shared/types";
import { canDeleteMeeting, ISO_DATE_PATTERN, nextMeetingDisplayNo } from "@shared/meeting";

const dateSchema = z.string().regex(ISO_DATE_PATTERN, "회의 일자를 확인하세요.");
const writeSchema = z.object({
  typeCode: z.string().trim().min(1, "회의구분을 선택하세요.").max(30),
  meetingDate: dateSchema,
  timePlace: z.string().trim().max(50, "시간 · 장소는 50자 이하로 입력하세요."),
  chair: z.string().trim().min(1, "주재자를 입력하세요.").max(50),
  attendeeIds: z.array(z.number().int().positive()).max(200).transform((items) => [...new Set(items)]),
  body: z.unknown().nullable(),
  bodyText: z.string().max(100_000),
  intent: z.enum(["draft", "publish"]),
});

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw Errors.badRequest("올바르지 않은 회의록입니다.");
  return id;
}

async function meetingTypes(db: AppEnv["Variables"]["db"]) {
  return db.select({ code: codes.code, name: codes.name })
    .from(codes)
    .where(and(eq(codes.groupCode, "MEETING_TYPE"), eq(codes.isActive, true)))
    .orderBy(asc(codes.sortOrder), asc(codes.name));
}

async function employeeOptions(db: AppEnv["Variables"]["db"]): Promise<MeetingEmployeeOption[]> {
  return db.select({
    id: employees.id,
    name: employees.name,
    position: employees.position,
    departmentId: employees.departmentId,
    departmentName: departments.name,
  }).from(employees)
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .where(eq(employees.status, "active"))
    .orderBy(asc(departments.sortOrder), asc(employees.name));
}

async function assertWriteReferences(
  db: AppEnv["Variables"]["db"],
  typeCode: string,
  attendeeIds: number[],
) {
  const type = await db.select({ code: codes.code }).from(codes).where(and(
    eq(codes.groupCode, "MEETING_TYPE"), eq(codes.code, typeCode), eq(codes.isActive, true),
  )).get();
  if (!type) throw Errors.badRequest("사용 중인 회의구분을 선택하세요.", { typeCode: "회의구분을 확인하세요." });
  if (attendeeIds.length) {
    const rows = await db.select({ id: employees.id }).from(employees)
      .where(and(inArray(employees.id, attendeeIds), eq(employees.status, "active")));
    if (rows.length !== attendeeIds.length) {
      throw Errors.badRequest("재직 중인 참석자만 선택할 수 있습니다.", { attendeeIds: "참석자를 확인하세요." });
    }
  }
}

async function replaceAttendees(
  db: AppEnv["Variables"]["db"],
  meetingId: number,
  attendeeIds: number[],
) {
  await db.delete(meetingAttendees).where(eq(meetingAttendees.meetingId, meetingId));
  if (attendeeIds.length) {
    await db.insert(meetingAttendees).values(attendeeIds.map((employeeId) => ({ meetingId, employeeId })));
  }
}

async function duplicateExists(
  db: AppEnv["Variables"]["db"],
  typeCode: string,
  meetingDate: string,
  excludeId?: number,
) {
  const rows = await db.select({ id: meetings.id }).from(meetings).where(and(
    eq(meetings.typeCode, typeCode), eq(meetings.meetingDate, meetingDate),
  ));
  return rows.some((row) => row.id !== excludeId);
}

async function nextDisplayNo(db: AppEnv["Variables"]["db"], date: string) {
  const prefix = "MT-" + date.replaceAll("-", "");
  const rows = await db.select({ displayNo: meetings.displayNo }).from(meetings)
    .where(like(meetings.displayNo, prefix + "-%"));
  return nextMeetingDisplayNo(date, rows.map((row) => row.displayNo));
}

export const meetingRoutes = new Hono<AppEnv>()
  .use("*", requireAuth())
  .get("/options", async (c) => {
    const [types, people, deptRows] = await Promise.all([
      meetingTypes(c.var.db),
      employeeOptions(c.var.db),
      c.var.db.select({ id: departments.id, name: departments.name }).from(departments)
        .where(eq(departments.isActive, true)).orderBy(asc(departments.sortOrder), asc(departments.name)),
    ]);
    return c.json<MeetingOptionsResponse>({
      meetingTypes: types,
      employees: people,
      departments: deptRows,
      canCreate: c.var.user!.isClerk,
    });
  })
  .get("/", async (c) => {
    const user = c.var.user!;
    const typeCode = c.req.query("typeCode")?.trim();
    const from = c.req.query("from")?.trim();
    const to = c.req.query("to")?.trim();
    const conditions = [or(eq(meetings.status, "published"), eq(meetings.clerkId, user.id))!];
    if (typeCode) conditions.push(eq(meetings.typeCode, typeCode));
    if (from && ISO_DATE_PATTERN.test(from)) conditions.push(gte(meetings.meetingDate, from));
    if (to && ISO_DATE_PATTERN.test(to)) conditions.push(lte(meetings.meetingDate, to));

    const [rows, types, actions] = await Promise.all([
      c.var.db.select({
        id: meetings.id, displayNo: meetings.displayNo, typeCode: meetings.typeCode,
        meetingDate: meetings.meetingDate, timePlace: meetings.timePlace, chair: meetings.chair,
        clerkName: employees.name, status: meetings.status, updatedAt: meetings.updatedAt,
      }).from(meetings).innerJoin(employees, eq(meetings.clerkId, employees.id))
        .where(and(...conditions)).orderBy(desc(meetings.meetingDate), desc(meetings.id)),
      meetingTypes(c.var.db),
      c.var.db.select({ meetingId: actionItems.meetingId }).from(actionItems),
    ]);
    const typeMap = new Map(types.map((item) => [item.code, item.name]));
    const counts = new Map<number, number>();
    for (const action of actions) if (action.meetingId) counts.set(action.meetingId, (counts.get(action.meetingId) ?? 0) + 1);
    const items: MeetingListItem[] = rows.map((row) => ({
      ...row,
      chair: row.chair ?? "",
      typeName: typeMap.get(row.typeCode) ?? row.typeCode,
      actionCount: counts.get(row.id) ?? 0,
    }));
    return c.json<MeetingListResponse>({ items, meetingTypes: types, canCreate: user.isClerk });
  })
  .get("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const user = c.var.user!;
    const row = await c.var.db.select({
      meeting: meetings,
      clerkName: employees.name,
      clerkDepartmentName: departments.name,
      typeName: codes.name,
    }).from(meetings)
      .innerJoin(employees, eq(meetings.clerkId, employees.id))
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .leftJoin(codes, and(eq(codes.groupCode, "MEETING_TYPE"), eq(meetings.typeCode, codes.code)))
      .where(eq(meetings.id, id)).get();
    if (!row) throw Errors.notFound();
    if (row.meeting.status === "draft" && row.meeting.clerkId !== user.id) throw Errors.notFound();
    const [attendeeRows, actions, fileRows] = await Promise.all([
      c.var.db.select({ employeeId: meetingAttendees.employeeId }).from(meetingAttendees)
        .where(eq(meetingAttendees.meetingId, id)),
      c.var.db.select({
        id: actionItems.id,
        displayNo: actionItems.displayNo,
        departmentName: departments.name,
        subject: actionItems.subject,
        request: actionItems.request,
        status: actionItems.status,
        latestProgressText: actionItems.latestProgressText,
        completedDate: actionItems.completedDate,
      }).from(actionItems).innerJoin(departments, eq(actionItems.departmentId, departments.id))
        .where(eq(actionItems.meetingId, id)).orderBy(asc(departments.sortOrder), asc(actionItems.id)),
      c.var.db.select({
        id: attachments.id, fileName: attachments.fileName, mimeType: attachments.mimeType,
        size: attachments.size, r2Key: attachments.r2Key, createdAt: attachments.createdAt,
      }).from(attachments).where(and(eq(attachments.ownerType, "meeting"), eq(attachments.ownerId, id)))
        .orderBy(desc(attachments.createdAt)),
    ]);
    const allPeople = await employeeOptions(c.var.db);
    const attendeeSet = new Set(attendeeRows.map((item) => item.employeeId));
    const result: MeetingDetailResponse = {
      id: row.meeting.id,
      displayNo: row.meeting.displayNo,
      typeCode: row.meeting.typeCode,
      typeName: row.typeName ?? row.meeting.typeCode,
      meetingDate: row.meeting.meetingDate,
      timePlace: row.meeting.timePlace,
      chair: row.meeting.chair ?? "",
      body: row.meeting.body,
      bodyText: row.meeting.bodyText,
      clerkId: row.meeting.clerkId,
      clerkName: row.clerkName,
      clerkDepartmentName: row.clerkDepartmentName,
      attendees: allPeople.filter((person) => attendeeSet.has(person.id)),
      attachments: fileRows.map(({ r2Key, ...file }) => ({ ...file, url: "/api/files/" + r2Key })),
      linkedActions: actions,
      status: row.meeting.status,
      actionCount: actions.length,
      publishedAt: row.meeting.publishedAt,
      createdAt: row.meeting.createdAt,
      updatedAt: row.meeting.updatedAt,
      canEdit: user.isClerk && row.meeting.clerkId === user.id,
      canDelete: canDeleteMeeting({
        status: row.meeting.status, clerkId: row.meeting.clerkId, userId: user.id,
        isClerk: user.isClerk, isAdmin: user.isAdmin, linkedActionCount: actions.length,
      }),
      deleteBlockReason: actions.length
        ? "연결된 액션아이템이 있어 삭제할 수 없습니다."
        : row.meeting.status === "draft" && row.meeting.clerkId !== user.id
          ? "작성한 회의 서기만 삭제할 수 있습니다."
          : row.meeting.status === "published" && !user.isAdmin
            ? "등록된 회의록은 시스템 관리자만 삭제할 수 있습니다."
            : null,
    };
    return c.json(result);
  })
  .post("/", async (c) => {
    const user = c.var.user!;
    if (!user.isClerk) throw Errors.forbidden();
    const input = writeSchema.parse(await c.req.json().catch(() => ({})));
    if (input.intent === "publish" && !input.bodyText.trim()) {
      throw Errors.badRequest("등록 및 공유하려면 회의 본문을 입력하세요.", { bodyText: "회의 본문을 입력하세요." });
    }
    await assertWriteReferences(c.var.db, input.typeCode, input.attendeeIds);
    const duplicateWarning = await duplicateExists(c.var.db, input.typeCode, input.meetingDate);
    const now = Date.now();
    const published = input.intent === "publish";
    const inserted = await c.var.db.insert(meetings).values({
      displayNo: published ? await nextDisplayNo(c.var.db, input.meetingDate) : null,
      typeCode: input.typeCode,
      meetingDate: input.meetingDate,
      timePlace: input.timePlace || null,
      chair: input.chair,
      body: input.body ? JSON.stringify(input.body) : null,
      bodyText: input.bodyText || null,
      status: published ? "published" : "draft",
      clerkId: user.id,
      publishedAt: published ? now : null,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: meetings.id, displayNo: meetings.displayNo }).get();
    await replaceAttendees(c.var.db, inserted.id, input.attendeeIds);
    await writeAudit(c.var.db, {
      actorId: user.id,
      action: published ? "meeting.publish" : "meeting.draft_create",
      targetType: "meeting",
      targetId: inserted.id,
      after: { typeCode: input.typeCode, meetingDate: input.meetingDate, attendeeCount: input.attendeeIds.length },
      ip: clientIp(c),
    });
    return c.json({ ...inserted, duplicateWarning, status: published ? "published" : "draft" }, 201);
  })
  .put("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const user = c.var.user!;
    const current = await c.var.db.select().from(meetings).where(eq(meetings.id, id)).get();
    if (!current) throw Errors.notFound();
    if (!user.isClerk || current.clerkId !== user.id) throw Errors.forbidden();
    const input = writeSchema.parse(await c.req.json().catch(() => ({})));
    const publishing = input.intent === "publish" || current.status === "published";
    if (publishing && !input.bodyText.trim()) {
      throw Errors.badRequest("등록 및 공유하려면 회의 본문을 입력하세요.", { bodyText: "회의 본문을 입력하세요." });
    }
    await assertWriteReferences(c.var.db, input.typeCode, input.attendeeIds);
    const duplicateWarning = await duplicateExists(c.var.db, input.typeCode, input.meetingDate, id);
    const now = Date.now();
    const displayNo = publishing
      ? current.displayNo ?? await nextDisplayNo(c.var.db, input.meetingDate)
      : null;
    await c.var.db.update(meetings).set({
      displayNo,
      typeCode: input.typeCode,
      meetingDate: input.meetingDate,
      timePlace: input.timePlace || null,
      chair: input.chair,
      body: input.body ? JSON.stringify(input.body) : null,
      bodyText: input.bodyText || null,
      status: publishing ? "published" : "draft",
      publishedAt: publishing ? current.publishedAt ?? now : null,
      updatedAt: now,
    }).where(eq(meetings.id, id));
    await replaceAttendees(c.var.db, id, input.attendeeIds);
    await writeAudit(c.var.db, {
      actorId: user.id,
      action: current.status === "draft" && publishing ? "meeting.publish" : "meeting.update",
      targetType: "meeting",
      targetId: id,
      before: { status: current.status, typeCode: current.typeCode, meetingDate: current.meetingDate },
      after: { status: publishing ? "published" : "draft", typeCode: input.typeCode, meetingDate: input.meetingDate },
      ip: clientIp(c),
    });
    return c.json({ id, displayNo, duplicateWarning, status: publishing ? "published" : "draft", updatedAt: now });
  })
  .delete("/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const user = c.var.user!;
    const current = await c.var.db.select().from(meetings).where(eq(meetings.id, id)).get();
    if (!current) throw Errors.notFound();
    const allowed = current.status === "draft"
      ? user.isClerk && current.clerkId === user.id
      : user.isAdmin;
    if (!allowed) throw Errors.forbidden();
    const linkedAction = await c.var.db.select({ id: actionItems.id }).from(actionItems)
      .where(eq(actionItems.meetingId, id)).get();
    if (linkedAction) throw Errors.conflict("연결된 액션아이템이 있어 회의록을 삭제할 수 없습니다.");
    const fileRows = await c.var.db.select({ id: attachments.id, r2Key: attachments.r2Key })
      .from(attachments).where(and(eq(attachments.ownerType, "meeting"), eq(attachments.ownerId, id)));

    await writeAudit(c.var.db, {
      actorId: user.id,
      action: "meeting.delete",
      targetType: "meeting",
      targetId: id,
      before: {
        displayNo: current.displayNo,
        status: current.status,
        typeCode: current.typeCode,
        meetingDate: current.meetingDate,
        attachmentCount: fileRows.length,
      },
      ip: clientIp(c),
    });
    await c.var.db.delete(meetingAttendees).where(eq(meetingAttendees.meetingId, id));
    await c.var.db.delete(attachments).where(and(eq(attachments.ownerType, "meeting"), eq(attachments.ownerId, id)));
    await c.var.db.delete(meetings).where(eq(meetings.id, id));
    await Promise.all(fileRows.map((file) => c.env.FILES.delete(file.r2Key)));
    return c.body(null, 204);
  });
