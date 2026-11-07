import { Hono } from "hono";
import { and, asc, desc, eq, gte, inArray, lt, lte, or } from "drizzle-orm";
import { z } from "zod";
import {
  decisionRequests,
  attendances,
  attachments,
  departments,
  employees,
  notifications,
  reportCategories,
  reportDetails,
  reportMemberCompletions,
  reportTitles,
  titleWeekEntries,
  weeklyReports,
} from "../db/schema";
import type { AppEnv, Db, EmployeeRow } from "../env";
import { writeAudit } from "../lib/audit";
import { Errors } from "../lib/errors";
import { loadSettings } from "../lib/settings";
import { clientIp, requireAuth } from "../middleware/session";
import {
  canOpenYearWeek,
  formatYearWeekSlug,
  getIsoWeek,
  getIsoWeekRange,
  parseYearWeekSlug,
  reportDeadlineEpoch,
  shiftYearWeek,
  toKstDateString,
} from "@shared/week";
import { getReportPermissions, getSubmissionStatus, shouldCarryWeeklyEntry } from "@shared/report";
import type {
  WeeklyReportDetailGroup,
  WeeklyReportEntry,
  WeeklyReportOptionsResponse,
  WeeklyReportResponse,
  WeeklyTitleCreateRequest,
  WeeklyTitleUpdateRequest,
  WeeklyEntryUpdateRequest,
  AttendanceWriteRequest,
  WeeklyTitleManageRequest,
  WeeklyTitleHistoryResponse,
} from "@shared/types";

const titleCreateSchema = z.object({
  detailId: z.number().int().positive(),
  ownerId: z.number().int().positive(),
  title: z.string().trim().min(1, "번호와 타이틀을 입력하세요.").max(100),
});
const titleUpdateSchema = z.object({
  reportId: z.number().int().positive(),
  title: z.string().trim().min(1, "번호와 타이틀을 입력하세요.").max(100),
});

const dateSchema = z.string().regex(/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/, "날짜 형식이 올바르지 않습니다.");
const scheduleSchema = z.object({
  type: z.enum(["single", "multiple", "range", "deadline"]),
  dates: z.array(dateSchema).max(31),
}).nullable();
const entryUpdateSchema = z.object({
  version: z.number().int().positive(),
  thisWeekBody: z.unknown().nullable(),
  thisWeekText: z.string().max(20_000).nullable(),
  performSchedule: scheduleSchema,
  result: z.enum(["done", "continue", "stopped", "hold"]).nullable(),
  hideOnHold: z.boolean().optional().default(false),
  nextPlanBody: z.unknown().nullable(),
  nextPlanText: z.string().max(20_000).nullable(),
  dueSchedule: scheduleSchema,
});
const completionSchema = z.object({ completed: z.boolean() });
const decisionSchema = z.object({
  enabled: z.boolean(),
  content: z.string().trim().max(200).optional().default(""),
  desiredDate: dateSchema.nullable().optional().default(null),
});
const decisionResolveSchema = z.object({
  status: z.enum(["approved", "rejected", "held"]),
  comment: z.string().trim().max(500).optional().default(""),
});
const attendanceSchema = z.object({
  employeeId: z.number().int().positive(),
  type: z.enum(["trip", "leave"]),
  startDate: dateSchema,
  endDate: dateSchema,
  note: z.string().trim().max(100).default(""),
}).refine((value) => value.startDate <= value.endDate, {
  message: "종료일은 시작일 이후여야 합니다.", path: ["endDate"],
});
const titleManageSchema = z.object({
  reportId: z.number().int().positive(),
  ownerId: z.number().int().positive(),
  detailId: z.number().int().positive(),
  direction: z.enum(["up", "down"]).optional(),
});

async function notifyUsers(
  db: Db,
  recipientIds: number[],
  input: { type: string; message: string; link: string; dedupeKey: string },
) {
  if (!recipientIds.length) return;
  await db.insert(notifications).values(recipientIds.map((recipientId) => ({
    recipientId,
    type: input.type,
    message: input.message,
    link: input.link,
    dedupeKey: input.dedupeKey + ":" + recipientId,
  }))).onConflictDoNothing();
}

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw Errors.badRequest("올바르지 않은 식별자입니다.");
  return id;
}

function parseTitleInput(value: string): { number: number | null; name: string } {
  const trimmed = value.trim();
  const dotIndex = trimmed.indexOf(".");
  const prefix = dotIndex > 0 ? trimmed.slice(0, dotIndex) : "";
  if (prefix && [...prefix].every((character) => character >= "0" && character <= "9")) {
    const name = trimmed.slice(dotIndex + 1).trim();
    if (name) return { number: Number(prefix), name };
  }
  const match = /^([0-9]+)[.][ ]*(.+)$/.exec(value.trim());
  if (!match) return { number: null, name: value.trim() };
  return { number: Number(match[1]), name: match[2].trim() };
}

function canEditOwner(user: EmployeeRow, departmentId: number, ownerId: number): boolean {
  if (user.departmentId !== departmentId) return false;
  return user.role === "leader" || (user.role === "member" && user.id === ownerId);
}

async function ensureReport(
  db: Db,
  departmentId: number,
  yearWeek: number,
  actorId: number,
) {
  const existing = await db
    .select()
    .from(weeklyReports)
    .where(and(eq(weeklyReports.departmentId, departmentId), eq(weeklyReports.yearWeek, yearWeek)))
    .get();
  if (existing) return existing;

  const currentYearWeek = getIsoWeek(toKstDateString()).yearWeek;
  if (yearWeek !== currentYearWeek && yearWeek !== shiftYearWeek(currentYearWeek, 1)) {
    return null;
  }

  const now = Date.now();
  const inserted = await db
    .insert(weeklyReports)
    .values({ departmentId, yearWeek, status: "draft", createdAt: now, updatedAt: now })
    .onConflictDoNothing()
    .returning()
    .get();
  const report = inserted ?? await db
    .select()
    .from(weeklyReports)
    .where(and(eq(weeklyReports.departmentId, departmentId), eq(weeklyReports.yearWeek, yearWeek)))
    .get();
  if (!report) throw new Error("보고서를 생성하지 못했습니다.");
  if (!inserted) return report;

  const previous = await db
    .select()
    .from(weeklyReports)
    .where(and(eq(weeklyReports.departmentId, departmentId), lt(weeklyReports.yearWeek, yearWeek)))
    .orderBy(desc(weeklyReports.yearWeek))
    .get();

  let carriedCount = 0;
  if (previous) {
    const candidates = await db
      .select({
        titleId: reportTitles.id,
        detailId: titleWeekEntries.detailId,
        ownerId: titleWeekEntries.ownerId,
        nextPlanBody: titleWeekEntries.nextPlanBody,
        nextPlanText: titleWeekEntries.nextPlanText,
        dueSchedule: titleWeekEntries.dueSchedule,
        result: titleWeekEntries.result,
        endYearWeek: reportTitles.endYearWeek,
        hiddenOnHold: reportTitles.hiddenOnHold,
      })
      .from(titleWeekEntries)
      .innerJoin(reportTitles, eq(titleWeekEntries.titleId, reportTitles.id))
      .where(eq(titleWeekEntries.reportId, previous.id));

    for (const item of candidates) {
      if (!shouldCarryWeeklyEntry(item.result, item.endYearWeek, yearWeek, item.hiddenOnHold)) continue;
      const result = await db
        .insert(titleWeekEntries)
        .values({
          titleId: item.titleId,
          reportId: report.id,
          yearWeek,
          detailId: item.detailId,
          ownerId: item.ownerId,
          thisWeekBody: item.nextPlanBody,
          thisWeekText: item.nextPlanText,
          performSchedule: item.dueSchedule,
          result: null,
          nextPlanBody: null,
          nextPlanText: null,
          dueSchedule: null,
          carriedOver: true,
          version: 1,
          updatedBy: actorId,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoNothing()
        .returning({ id: titleWeekEntries.id })
        .get();
      if (result) carriedCount += 1;
    }
  }

  await writeAudit(db, {
    actorId,
    action: "report.create_auto",
    targetType: "weekly_report",
    targetId: report.id,
    after: { departmentId, yearWeek, carriedCount },
  });
  return report;
}

function reportPermissions(user: EmployeeRow, departmentId: number, status: string) {
  return getReportPermissions({
    role: user.role,
    userDepartmentId: user.departmentId,
    reportDepartmentId: departmentId,
    status: status as "draft" | "submitted" | "late" | "confirmed" | "missing",
  });
}

async function buildReportResponse(
  db: Db,
  user: EmployeeRow,
  department: typeof departments.$inferSelect,
  yearWeek: number,
  report: typeof weeklyReports.$inferSelect | null,
): Promise<WeeklyReportResponse> {
  const range = getIsoWeekRange(yearWeek);
  const deadlineSetting = await loadSettings(db, ["report.deadline"]);
  const deadline = deadlineSetting["report.deadline"];
  const deadlineAt = reportDeadlineEpoch(yearWeek, deadline.weekday, deadline.time);

  const memberRows = await db
    .select({
      id: employees.id,
      name: employees.name,
      position: employees.position,
      role: employees.role,
    })
    .from(employees)
    .where(and(
      eq(employees.departmentId, department.id),
      eq(employees.status, "active"),
      or(eq(employees.role, "member"), eq(employees.role, "leader")),
    ))
    .orderBy(asc(employees.name));

  const attendanceRows = await db
    .select({
      id: attendances.id,
      employeeId: attendances.employeeId,
      employeeName: employees.name,
      type: attendances.type,
      startDate: attendances.startDate,
      endDate: attendances.endDate,
      note: attendances.note,
    })
    .from(attendances)
    .innerJoin(employees, eq(attendances.employeeId, employees.id))
    .where(and(
      eq(employees.departmentId, department.id),
      lte(attendances.startDate, range.nextFriday),
      gte(attendances.endDate, range.monday),
    ))
    .orderBy(asc(attendances.startDate), asc(employees.name));
  const attendanceItems = attendanceRows.map((item) => ({
    ...item,
    canEdit: report?.status === "draft" && user.departmentId === department.id
      && (user.role === "leader" || item.employeeId === user.id),
  }));

  if (!report) {
    return {
      exists: false,
      report: null,
      department: { id: department.id, code: department.code, name: department.name },
      yearWeek,
      week: range,
      deadlineAt,
      permissions: reportPermissions(user, department.id, "missing"),
      members: memberRows.map((member) => ({ ...member, isCompleted: false })),
      details: [],
      attendances: attendanceItems,
      hiddenHolds: [],
      summary: {
        completedMembers: 0,
        totalMembers: memberRows.length,
        totalTitles: 0,
        continued: 0,
        completed: 0,
        held: 0,
        stopped: 0,
        newTitles: 0,
        pendingDecisions: 0,
      },
    };
  }

  const [completionRows, rawEntries, detailRows, categoryRows, hiddenRows] = await Promise.all([
    db
      .select({ employeeId: reportMemberCompletions.employeeId })
      .from(reportMemberCompletions)
      .where(eq(reportMemberCompletions.reportId, report.id)),
    db
      .select({
        id: titleWeekEntries.id,
        titleId: titleWeekEntries.titleId,
        reportId: titleWeekEntries.reportId,
        detailId: titleWeekEntries.detailId,
        ownerId: titleWeekEntries.ownerId,
        number: reportTitles.number,
        title: reportTitles.name,
        sortOrder: reportTitles.sortOrder,
        startYearWeek: reportTitles.startYearWeek,
        endYearWeek: reportTitles.endYearWeek,
        hiddenOnHold: reportTitles.hiddenOnHold,
        thisWeekBody: titleWeekEntries.thisWeekBody,
        thisWeekText: titleWeekEntries.thisWeekText,
        performSchedule: titleWeekEntries.performSchedule,
        result: titleWeekEntries.result,
        nextPlanBody: titleWeekEntries.nextPlanBody,
        nextPlanText: titleWeekEntries.nextPlanText,
        dueSchedule: titleWeekEntries.dueSchedule,
        carriedOver: titleWeekEntries.carriedOver,
        version: titleWeekEntries.version,
        updatedAt: titleWeekEntries.updatedAt,
        ownerName: employees.name,
      })
      .from(titleWeekEntries)
      .innerJoin(reportTitles, eq(titleWeekEntries.titleId, reportTitles.id))
      .innerJoin(employees, eq(titleWeekEntries.ownerId, employees.id))
      .where(eq(titleWeekEntries.reportId, report.id))
      .orderBy(asc(reportTitles.sortOrder), asc(reportTitles.number), asc(reportTitles.name)),
    db
      .select()
      .from(reportDetails)
      .where(eq(reportDetails.departmentId, department.id))
      .orderBy(asc(reportDetails.sortOrder), asc(reportDetails.name)),
    db
      .select()
      .from(reportCategories)
      .orderBy(asc(reportCategories.sortOrder)),
    db.select({
      titleId: reportTitles.id,
      number: reportTitles.number,
      title: reportTitles.name,
      ownerId: reportTitles.ownerId,
      ownerName: employees.name,
      heldYearWeek: titleWeekEntries.yearWeek,
      nextPlanText: titleWeekEntries.nextPlanText,
      result: titleWeekEntries.result,
    }).from(reportTitles)
      .innerJoin(employees, eq(reportTitles.ownerId, employees.id))
      .innerJoin(titleWeekEntries, eq(reportTitles.id, titleWeekEntries.titleId))
      .where(and(eq(reportTitles.departmentId, department.id), eq(reportTitles.hiddenOnHold, true)))
      .orderBy(asc(reportTitles.id), desc(titleWeekEntries.yearWeek)),
  ]);

  const entryIds = rawEntries.map((entry) => entry.id);
  const decisionRows = entryIds.length
    ? await db
        .select({
          id: decisionRequests.id,
          entryId: decisionRequests.entryId,
          content: decisionRequests.content,
          desiredDate: decisionRequests.desiredDate,
          status: decisionRequests.status,
          comment: decisionRequests.comment,
          requestedAt: decisionRequests.requestedAt,
          decidedAt: decisionRequests.decidedAt,
        })
        .from(decisionRequests)
        .where(inArray(decisionRequests.entryId, entryIds))
        .orderBy(desc(decisionRequests.requestedAt), desc(decisionRequests.id))
    : [];
  const decisionByEntry = new Map<number, (typeof decisionRows)[number]>();
  for (const decision of decisionRows) {
    if (!decisionByEntry.has(decision.entryId)) decisionByEntry.set(decision.entryId, decision);
  }
  const entries: WeeklyReportEntry[] = rawEntries.map((entry) => ({
    ...entry,
    decisionRequired: decisionByEntry.get(entry.id)?.status === "pending",
    decision: decisionByEntry.get(entry.id) ?? null,
  }));
  const usedDetailIds = new Set(entries.map((entry) => entry.detailId));
  const categoryMap = new Map(categoryRows.map((category) => [category.id, category]));
  const details: WeeklyReportDetailGroup[] = detailRows
    .filter((detail) => detail.isActive || usedDetailIds.has(detail.id))
    .flatMap((detail) => {
      const category = categoryMap.get(detail.categoryId);
      if (!category || category.code === "TRAVEL") return [];
      return [{
        id: detail.id,
        name: detail.name,
        sortOrder: detail.sortOrder,
        isActive: detail.isActive,
        category: {
          id: category.id,
          code: category.code,
          name: category.name,
          sortOrder: category.sortOrder,
        },
        entries: entries.filter((entry) => entry.detailId === detail.id),
      }];
    })
    .sort((a, b) => a.category.sortOrder - b.category.sortOrder || a.sortOrder - b.sortOrder);

  const completedIds = new Set(completionRows.map((item) => item.employeeId));
  const hiddenByTitle = new Map<number, (typeof hiddenRows)[number]>();
  for (const item of hiddenRows) {
    if (!hiddenByTitle.has(item.titleId)) hiddenByTitle.set(item.titleId, item);
  }
  const hiddenHolds = [...hiddenByTitle.values()]
    .filter((item) => item.result === "hold" && item.heldYearWeek < yearWeek)
    .map((item) => ({
      titleId: item.titleId,
      number: item.number,
      title: item.title,
      ownerId: item.ownerId,
      ownerName: item.ownerName,
      heldYearWeek: item.heldYearWeek,
      nextPlanText: item.nextPlanText,
      canResume: report.status === "draft" && canEditOwner(user, department.id, item.ownerId),
    }));
  return {
    exists: true,
    report: {
      id: report.id,
      status: report.status,
      submittedAt: report.submittedAt,
      confirmedAt: report.confirmedAt,
      createdAt: report.createdAt,
    },
    department: { id: department.id, code: department.code, name: department.name },
    yearWeek,
    week: range,
    deadlineAt,
    permissions: reportPermissions(user, department.id, report.status),
    members: memberRows.map((member) => ({ ...member, isCompleted: completedIds.has(member.id) })),
    details,
    attendances: attendanceItems,
    hiddenHolds,
    summary: {
      completedMembers: completionRows.length,
      totalMembers: memberRows.length,
      totalTitles: entries.length,
      continued: entries.filter((entry) => entry.result === "continue").length,
      completed: entries.filter((entry) => entry.result === "done").length,
      held: entries.filter((entry) => entry.result === "hold").length,
      stopped: entries.filter((entry) => entry.result === "stopped").length,
      newTitles: entries.filter((entry) => entry.startYearWeek === yearWeek).length,
      pendingDecisions: entries.filter((entry) => entry.decisionRequired).length,
    },
  };
}

export const reportRoutes = new Hono<AppEnv>()
  .use("*", requireAuth())
  .post("/:reportId/completion", async (c) => {
    const reportId = parseId(c.req.param("reportId"));
    const { completed } = completionSchema.parse(await c.req.json());
    const user = c.var.user!;
    const report = await c.var.db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId)).get();
    if (!report) throw Errors.notFound();
    if (report.status !== "draft") throw Errors.conflict("제출된 보고서의 작성 상태는 변경할 수 없습니다.");
    if (user.departmentId !== report.departmentId || (user.role !== "member" && user.role !== "leader")) {
      throw Errors.forbidden();
    }
    if (completed) {
      await c.var.db.insert(reportMemberCompletions).values({
        reportId,
        employeeId: user.id,
        completedAt: Date.now(),
      }).onConflictDoNothing();
    } else {
      await c.var.db.delete(reportMemberCompletions).where(and(
        eq(reportMemberCompletions.reportId, reportId),
        eq(reportMemberCompletions.employeeId, user.id),
      ));
    }
    await writeAudit(c.var.db, {
      actorId: user.id,
      action: completed ? "report.member_complete" : "report.member_reopen",
      targetType: "weekly_report",
      targetId: reportId,
      ip: clientIp(c),
    });
    return c.json({ completed });
  })
  .post("/:reportId/submit", async (c) => {
    const reportId = parseId(c.req.param("reportId"));
    const user = c.var.user!;
    const report = await c.var.db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId)).get();
    if (!report) throw Errors.notFound();
    if (user.role !== "leader" || user.departmentId !== report.departmentId) throw Errors.forbidden();
    if (report.status !== "draft") throw Errors.conflict("작성 중인 보고서만 제출할 수 있습니다.");
    const deadlineSetting = await loadSettings(c.var.db, ["report.deadline"]);
    const deadline = deadlineSetting["report.deadline"];
    const now = Date.now();
    const nextStatus = getSubmissionStatus(
      reportDeadlineEpoch(report.yearWeek, deadline.weekday, deadline.time), now,
    );
    const updated = await c.var.db.update(weeklyReports).set({
      status: nextStatus,
      submittedAt: now,
      submittedBy: user.id,
      updatedAt: now,
    }).where(and(eq(weeklyReports.id, reportId), eq(weeklyReports.status, "draft")))
      .returning({ status: weeklyReports.status }).get();
    if (!updated) throw Errors.conflict("보고서 상태가 변경되었습니다. 새로고침해 주세요.");
    const department = await c.var.db.select().from(departments).where(eq(departments.id, report.departmentId)).get();
    const executives = await c.var.db.select({ id: employees.id }).from(employees).where(and(
      eq(employees.role, "executive"), eq(employees.status, "active"),
    ));
    await notifyUsers(c.var.db, executives.map((item) => item.id), {
      type: "N02",
      message: (department?.name ?? "부서") + " 주간업무보고가 제출되었습니다.",
      link: "/reports/" + (department?.code ?? "") + "/" + formatYearWeekSlug(report.yearWeek),
      dedupeKey: "report-submit:" + reportId + ":" + now,
    });
    await writeAudit(c.var.db, {
      actorId: user.id, action: "report.submit", targetType: "weekly_report", targetId: reportId,
      before: { status: report.status }, after: { status: nextStatus }, ip: clientIp(c),
    });
    return c.json({ status: nextStatus });
  })
  .post("/:reportId/recall", async (c) => {
    const reportId = parseId(c.req.param("reportId"));
    const user = c.var.user!;
    const report = await c.var.db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId)).get();
    if (!report) throw Errors.notFound();
    if (user.role !== "leader" || user.departmentId !== report.departmentId) throw Errors.forbidden();
    if (report.status !== "submitted" && report.status !== "late") {
      throw Errors.conflict("제출 또는 지연 제출 상태만 회수할 수 있습니다.");
    }
    const recalled = await c.var.db.update(weeklyReports).set({
      status: "draft", submittedAt: null, submittedBy: null, updatedAt: Date.now(),
    }).where(and(eq(weeklyReports.id, reportId), or(
      eq(weeklyReports.status, "submitted"), eq(weeklyReports.status, "late"),
    ))).returning({ id: weeklyReports.id }).get();
    if (!recalled) throw Errors.conflict("보고서 상태가 변경되었습니다. 새로고침해 주세요.");
    await writeAudit(c.var.db, {
      actorId: user.id, action: "report.recall", targetType: "weekly_report", targetId: reportId,
      before: { status: report.status }, after: { status: "draft" }, ip: clientIp(c),
    });
    return c.json({ status: "draft" });
  })
  .post("/:reportId/confirm", async (c) => {
    const reportId = parseId(c.req.param("reportId"));
    const user = c.var.user!;
    if (user.role !== "executive") throw Errors.forbidden();
    const report = await c.var.db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId)).get();
    if (!report) throw Errors.notFound();
    if (report.status !== "submitted" && report.status !== "late") {
      throw Errors.conflict("제출된 보고서만 확인할 수 있습니다.");
    }
    const now = Date.now();
    const confirmed = await c.var.db.update(weeklyReports).set({
      status: "confirmed", confirmedAt: now, confirmedBy: user.id, updatedAt: now,
    }).where(and(eq(weeklyReports.id, reportId), or(
      eq(weeklyReports.status, "submitted"), eq(weeklyReports.status, "late"),
    ))).returning({ id: weeklyReports.id }).get();
    if (!confirmed) throw Errors.conflict("보고서 상태가 변경되었습니다. 새로고침해 주세요.");
    const department = await c.var.db.select().from(departments).where(eq(departments.id, report.departmentId)).get();
    if (department?.leaderId) await notifyUsers(c.var.db, [department.leaderId], {
      type: "N03", message: "제출한 주간업무보고가 임원 확인되었습니다.",
      link: "/reports/" + department.code + "/" + formatYearWeekSlug(report.yearWeek),
      dedupeKey: "report-confirm:" + reportId,
    });
    await writeAudit(c.var.db, {
      actorId: user.id, action: "report.confirm", targetType: "weekly_report", targetId: reportId,
      before: { status: report.status }, after: { status: "confirmed" }, ip: clientIp(c),
    });
    return c.json({ status: "confirmed" });
  })
  .post("/:reportId/attendance", async (c) => {
    const reportId = parseId(c.req.param("reportId"));
    const input = attendanceSchema.parse(await c.req.json()) as AttendanceWriteRequest;
    const user = c.var.user!;
    const report = await c.var.db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId)).get();
    if (!report) throw Errors.notFound();
    if (report.status !== "draft") throw Errors.conflict("제출된 보고서는 수정할 수 없습니다.");
    if (!canEditOwner(user, report.departmentId, input.employeeId)) throw Errors.forbidden();
    const employee = await c.var.db.select().from(employees).where(eq(employees.id, input.employeeId)).get();
    if (!employee || employee.departmentId !== report.departmentId || employee.status !== "active") {
      throw Errors.badRequest("같은 부서의 재직 사원만 선택할 수 있습니다.");
    }
    const overlaps = await c.var.db.select({ id: attendances.id }).from(attendances).where(and(
      eq(attendances.employeeId, input.employeeId),
      lte(attendances.startDate, input.endDate),
      gte(attendances.endDate, input.startDate),
    ));
    const now = Date.now();
    const attendance = await c.var.db.insert(attendances).values({
      employeeId: input.employeeId,
      type: input.type,
      startDate: input.startDate,
      endDate: input.endDate,
      note: input.note || null,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    }).returning().get();
    await writeAudit(c.var.db, {
      actorId: user.id, action: "report.attendance_create", targetType: "attendance",
      targetId: attendance.id, after: attendance, ip: clientIp(c),
    });
    return c.json({ attendance, overlapWarning: overlaps.length > 0 }, 201);
  })
  .patch("/:reportId/attendance/:attendanceId", async (c) => {
    const reportId = parseId(c.req.param("reportId"));
    const attendanceId = parseId(c.req.param("attendanceId"));
    const input = attendanceSchema.parse(await c.req.json()) as AttendanceWriteRequest;
    const user = c.var.user!;
    const [report, current] = await Promise.all([
      c.var.db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId)).get(),
      c.var.db.select().from(attendances).where(eq(attendances.id, attendanceId)).get(),
    ]);
    if (!report || !current) throw Errors.notFound();
    const currentEmployee = await c.var.db.select({ departmentId: employees.departmentId })
      .from(employees).where(eq(employees.id, current.employeeId)).get();
    if (currentEmployee?.departmentId !== report.departmentId) throw Errors.forbidden();
    if (report.status !== "draft") throw Errors.conflict("제출된 보고서는 수정할 수 없습니다.");
    if (!canEditOwner(user, report.departmentId, current.employeeId)) throw Errors.forbidden();
    if (user.role !== "leader" && input.employeeId !== user.id) throw Errors.forbidden();
    const employee = await c.var.db.select().from(employees).where(eq(employees.id, input.employeeId)).get();
    if (!employee || employee.departmentId !== report.departmentId || employee.status !== "active") {
      throw Errors.badRequest("같은 부서의 재직 사원만 선택할 수 있습니다.");
    }
    const overlaps = await c.var.db.select({ id: attendances.id }).from(attendances).where(and(
      eq(attendances.employeeId, input.employeeId),
      lte(attendances.startDate, input.endDate),
      gte(attendances.endDate, input.startDate),
    ));
    const updated = await c.var.db.update(attendances).set({
      employeeId: input.employeeId, type: input.type, startDate: input.startDate,
      endDate: input.endDate, note: input.note || null, updatedAt: Date.now(),
    }).where(eq(attendances.id, attendanceId)).returning().get();
    await writeAudit(c.var.db, {
      actorId: user.id, action: "report.attendance_update", targetType: "attendance",
      targetId: attendanceId, before: current, after: updated, ip: clientIp(c),
    });
    return c.json({ attendance: updated, overlapWarning: overlaps.some((item) => item.id !== attendanceId) });
  })
  .delete("/:reportId/attendance/:attendanceId", async (c) => {
    const reportId = parseId(c.req.param("reportId"));
    const attendanceId = parseId(c.req.param("attendanceId"));
    const user = c.var.user!;
    const [report, current] = await Promise.all([
      c.var.db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId)).get(),
      c.var.db.select().from(attendances).where(eq(attendances.id, attendanceId)).get(),
    ]);
    if (!report || !current) throw Errors.notFound();
    const currentEmployee = await c.var.db.select({ departmentId: employees.departmentId })
      .from(employees).where(eq(employees.id, current.employeeId)).get();
    if (currentEmployee?.departmentId !== report.departmentId) throw Errors.forbidden();
    if (report.status !== "draft") throw Errors.conflict("제출된 보고서는 수정할 수 없습니다.");
    if (!canEditOwner(user, report.departmentId, current.employeeId)) throw Errors.forbidden();
    await c.var.db.delete(attendances).where(eq(attendances.id, attendanceId));
    await writeAudit(c.var.db, {
      actorId: user.id, action: "report.attendance_delete", targetType: "attendance",
      targetId: attendanceId, before: current, ip: clientIp(c),
    });
    return c.body(null, 204);
  })
  .post("/:reportId/titles", async (c) => {
    const reportId = parseId(c.req.param("reportId"));
    const input = titleCreateSchema.parse(await c.req.json()) as WeeklyTitleCreateRequest;
    const user = c.var.user!;
    const report = await c.var.db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId)).get();
    if (!report) throw Errors.notFound();
    if (report.status !== "draft") throw Errors.conflict("제출된 보고서는 수정할 수 없습니다.");

    const detail = await c.var.db.select().from(reportDetails).where(eq(reportDetails.id, input.detailId)).get();
    if (!detail || detail.departmentId !== report.departmentId || !detail.isActive) {
      throw Errors.badRequest("사용 중인 소속 부서의 세부내용을 선택하세요.");
    }
    if (!canEditOwner(user, report.departmentId, input.ownerId)) throw Errors.forbidden();
    const owner = await c.var.db.select().from(employees).where(eq(employees.id, input.ownerId)).get();
    if (!owner || owner.departmentId !== report.departmentId || owner.status !== "active"
      || (owner.role !== "member" && owner.role !== "leader")) {
      throw Errors.badRequest("같은 부서의 재직 팀원만 담당자로 지정할 수 있습니다.");
    }

    const parsed = parseTitleInput(input.title);
    if (!parsed.name) throw Errors.badRequest("타이틀명을 입력하세요.");
    const existing = await c.var.db
      .select({ number: reportTitles.number, name: reportTitles.name, sortOrder: reportTitles.sortOrder })
      .from(reportTitles).where(eq(reportTitles.detailId, detail.id));
    const number = parsed.number ?? Math.max(0, ...existing.map((item) => item.number ?? 0)) + 1;
    const sortOrder = Math.max(0, ...existing.map((item) => item.sortOrder)) + 1;
    const duplicateWarning = existing.some((item) => item.name.trim() === parsed.name);
    const now = Date.now();
    const title = await c.var.db.insert(reportTitles).values({
      departmentId: report.departmentId,
      detailId: detail.id,
      number,
      name: parsed.name,
      ownerId: owner.id,
      startYearWeek: report.yearWeek,
      sortOrder,
      createdBy: user.id,
      createdAt: now,
      updatedAt: now,
    }).returning().get();

    try {
      const entry = await c.var.db.insert(titleWeekEntries).values({
        titleId: title.id,
        reportId: report.id,
        yearWeek: report.yearWeek,
        detailId: detail.id,
        ownerId: owner.id,
        version: 1,
        updatedBy: user.id,
        createdAt: now,
        updatedAt: now,
      }).returning({ id: titleWeekEntries.id }).get();
      await writeAudit(c.var.db, {
        actorId: user.id,
        action: "report.title_create",
        targetType: "report_title",
        targetId: title.id,
        after: { reportId, detailId: detail.id, ownerId: owner.id, number, name: parsed.name },
        ip: clientIp(c),
      });
      return c.json({ titleId: title.id, entryId: entry.id, duplicateWarning }, 201);
    } catch (error) {
      await c.var.db.delete(reportTitles).where(eq(reportTitles.id, title.id));
      throw error;
    }
  })
  .put("/entries/:entryId/decision", async (c) => {
    const entryId = parseId(c.req.param("entryId"));
    const input = decisionSchema.parse(await c.req.json());
    const user = c.var.user!;
    const current = await c.var.db
      .select({ entry: titleWeekEntries, report: weeklyReports, title: reportTitles, department: departments })
      .from(titleWeekEntries)
      .innerJoin(weeklyReports, eq(titleWeekEntries.reportId, weeklyReports.id))
      .innerJoin(reportTitles, eq(titleWeekEntries.titleId, reportTitles.id))
      .innerJoin(departments, eq(weeklyReports.departmentId, departments.id))
      .where(eq(titleWeekEntries.id, entryId)).get();
    if (!current) throw Errors.notFound();
    if (current.report.status !== "draft") throw Errors.conflict("제출된 보고서는 수정할 수 없습니다.");
    if (!canEditOwner(user, current.report.departmentId, current.entry.ownerId)) throw Errors.forbidden();
    const existing = await c.var.db.select().from(decisionRequests)
      .where(eq(decisionRequests.entryId, entryId)).orderBy(desc(decisionRequests.requestedAt)).get();

    if (!input.enabled) {
      if (!existing) return c.json({ decision: null });
      if (existing.status !== "pending") throw Errors.conflict("처리된 결정 요청은 취소할 수 없습니다.");
      await c.var.db.delete(decisionRequests).where(eq(decisionRequests.id, existing.id));
      await writeAudit(c.var.db, {
        actorId: user.id, action: "report.decision_cancel", targetType: "decision_request",
        targetId: existing.id, before: existing, ip: clientIp(c),
      });
      return c.json({ decision: null });
    }

    if (!input.content) throw Errors.badRequest("결정 요청 내용을 입력하세요.");
    if (input.desiredDate && input.desiredDate < toKstDateString()) {
      throw Errors.badRequest("희망 결정일은 오늘 이후로 선택하세요.");
    }
    const now = Date.now();
    const updateExisting = existing?.status === "pending";
    const decision = updateExisting
      ? await c.var.db.update(decisionRequests).set({
          content: input.content, desiredDate: input.desiredDate,
        }).where(eq(decisionRequests.id, existing!.id)).returning().get()
      : await c.var.db.insert(decisionRequests).values({
          entryId, titleId: current.title.id, departmentId: current.report.departmentId,
          content: input.content, desiredDate: input.desiredDate,
          requestedBy: user.id, requestedAt: now,
        }).returning().get();
    const executives = await c.var.db.select({ id: employees.id }).from(employees).where(and(
      eq(employees.role, "executive"), eq(employees.status, "active"),
    ));
    await notifyUsers(c.var.db, executives.map((item) => item.id), {
      type: "N01",
      message: current.department.name + " · " + current.title.name + " 결정 요청",
      link: "/reports/" + current.department.code + "/" + formatYearWeekSlug(current.report.yearWeek),
      dedupeKey: "decision-request:" + decision.id,
    });
    await writeAudit(c.var.db, {
      actorId: user.id, action: updateExisting ? "report.decision_update" : "report.decision_request",
      targetType: "decision_request", targetId: decision.id, after: decision, ip: clientIp(c),
    });
    return c.json({ decision });
  })
  .post("/decisions/:decisionId/resolve", async (c) => {
    const decisionId = parseId(c.req.param("decisionId"));
    const input = decisionResolveSchema.parse(await c.req.json());
    const user = c.var.user!;
    if (user.role !== "executive") throw Errors.forbidden();
    if ((input.status === "rejected" || input.status === "held") && !input.comment) {
      throw Errors.badRequest("반려 또는 보류 사유를 입력하세요.");
    }
    const current = await c.var.db
      .select({ decision: decisionRequests, title: reportTitles, report: weeklyReports, department: departments })
      .from(decisionRequests)
      .innerJoin(titleWeekEntries, eq(decisionRequests.entryId, titleWeekEntries.id))
      .innerJoin(reportTitles, eq(decisionRequests.titleId, reportTitles.id))
      .innerJoin(weeklyReports, eq(titleWeekEntries.reportId, weeklyReports.id))
      .innerJoin(departments, eq(decisionRequests.departmentId, departments.id))
      .where(eq(decisionRequests.id, decisionId)).get();
    if (!current) throw Errors.notFound();
    if (current.decision.status !== "pending") throw Errors.conflict("이미 처리된 결정 요청입니다.");
    const now = Date.now();
    const updated = await c.var.db.update(decisionRequests).set({
      status: input.status, comment: input.comment || null, decidedBy: user.id, decidedAt: now,
    }).where(and(eq(decisionRequests.id, decisionId), eq(decisionRequests.status, "pending")))
      .returning().get();
    if (!updated) throw Errors.conflict("다른 임원이 먼저 처리했습니다. 새로고침해 주세요.");
    const recipients = [current.decision.requestedBy, current.department.leaderId]
      .filter((id): id is number => id !== null && id !== user.id);
    await notifyUsers(c.var.db, [...new Set(recipients)], {
      type: "N04",
      message: current.title.name + " 결정 요청이 처리되었습니다.",
      link: "/reports/" + current.department.code + "/" + formatYearWeekSlug(current.report.yearWeek),
      dedupeKey: "decision-resolve:" + decisionId,
    });
    await writeAudit(c.var.db, {
      actorId: user.id, action: "report.decision_resolve", targetType: "decision_request",
      targetId: decisionId, before: { status: current.decision.status },
      after: { status: input.status, comment: input.comment || null }, ip: clientIp(c),
    });
    return c.json({ decision: updated });
  })
  .put("/entries/:entryId", async (c) => {
    const entryId = parseId(c.req.param("entryId"));
    const input = entryUpdateSchema.parse(await c.req.json()) as WeeklyEntryUpdateRequest;
    const user = c.var.user!;
    const current = await c.var.db
      .select({ entry: titleWeekEntries, report: weeklyReports, title: reportTitles })
      .from(titleWeekEntries)
      .innerJoin(weeklyReports, eq(titleWeekEntries.reportId, weeklyReports.id))
      .innerJoin(reportTitles, eq(titleWeekEntries.titleId, reportTitles.id))
      .where(eq(titleWeekEntries.id, entryId)).get();
    if (!current) throw Errors.notFound();
    if (current.report.status !== "draft") throw Errors.conflict("제출된 보고서는 수정할 수 없습니다.");
    if (!canEditOwner(user, current.report.departmentId, current.entry.ownerId)) throw Errors.forbidden();
    const now = Date.now();
    const updated = await c.var.db.update(titleWeekEntries).set({
      thisWeekBody: input.thisWeekBody === null ? null : JSON.stringify(input.thisWeekBody),
      thisWeekText: input.thisWeekText?.trim() || null,
      performSchedule: input.performSchedule === null ? null : JSON.stringify(input.performSchedule),
      result: input.result,
      nextPlanBody: input.nextPlanBody === null ? null : JSON.stringify(input.nextPlanBody),
      nextPlanText: input.nextPlanText?.trim() || null,
      dueSchedule: input.dueSchedule === null ? null : JSON.stringify(input.dueSchedule),
      carriedOver: false,
      version: input.version + 1,
      updatedBy: user.id,
      updatedAt: now,
    }).where(and(eq(titleWeekEntries.id, entryId), eq(titleWeekEntries.version, input.version)))
      .returning({ version: titleWeekEntries.version, updatedAt: titleWeekEntries.updatedAt }).get();
    if (!updated) {
      const latest = await c.var.db.select({ updatedBy: titleWeekEntries.updatedBy })
        .from(titleWeekEntries).where(eq(titleWeekEntries.id, entryId)).get();
      const editor = latest?.updatedBy
        ? await c.var.db.select({ name: employees.name }).from(employees).where(eq(employees.id, latest.updatedBy)).get()
        : null;
      throw Errors.conflict((editor?.name ?? "다른 사용자") + "님이 먼저 수정했습니다. 최신 내용을 불러와 주세요.");
    }

    const ended = input.result === "done" || input.result === "stopped";
    await c.var.db.update(reportTitles).set({
      endYearWeek: ended ? current.report.yearWeek
        : current.title.endYearWeek === current.report.yearWeek ? null : current.title.endYearWeek,
      resumeYearWeek: null,
      hiddenOnHold: input.result === "hold" && input.hideOnHold,
      updatedAt: now,
    }).where(eq(reportTitles.id, current.title.id));

    // 다음 주 보고서가 이미 열려 있어도 결과 변경을 이월 상태에 반영한다.
    const nextYearWeek = shiftYearWeek(current.report.yearWeek, 1);
    const nextReport = await c.var.db.select().from(weeklyReports).where(and(
      eq(weeklyReports.departmentId, current.report.departmentId),
      eq(weeklyReports.yearWeek, nextYearWeek),
    )).get();
    if (nextReport && nextReport.status === "draft") {
      const nextEntry = await c.var.db.select().from(titleWeekEntries).where(and(
        eq(titleWeekEntries.titleId, current.title.id),
        eq(titleWeekEntries.yearWeek, nextYearWeek),
      )).get();
      const shouldAppearNext = shouldCarryWeeklyEntry(
        input.result, ended ? current.report.yearWeek : null, nextYearWeek,
        input.result === "hold" && input.hideOnHold,
      );
      if (!shouldAppearNext && nextEntry?.carriedOver && nextEntry.version === 1) {
        await c.var.db.delete(titleWeekEntries).where(eq(titleWeekEntries.id, nextEntry.id));
      } else if (shouldAppearNext && !nextEntry) {
        await c.var.db.insert(titleWeekEntries).values({
          titleId: current.title.id,
          reportId: nextReport.id,
          yearWeek: nextYearWeek,
          detailId: current.entry.detailId,
          ownerId: current.entry.ownerId,
          thisWeekBody: input.nextPlanBody === null ? null : JSON.stringify(input.nextPlanBody),
          thisWeekText: input.nextPlanText?.trim() || null,
          performSchedule: input.dueSchedule === null ? null : JSON.stringify(input.dueSchedule),
          carriedOver: true,
          version: 1,
          updatedBy: user.id,
          createdAt: now,
          updatedAt: now,
        }).onConflictDoNothing();
      }
    }
    await writeAudit(c.var.db, {
      actorId: user.id,
      action: "report.entry_update",
      targetType: "title_week_entry",
      targetId: entryId,
      before: { version: current.entry.version, result: current.entry.result },
      after: { version: updated.version, result: input.result },
      ip: clientIp(c),
    });
    return c.json(updated);
  })
  .post("/:reportId/hidden-holds/:titleId/resume", async (c) => {
    const reportId = parseId(c.req.param("reportId"));
    const titleId = parseId(c.req.param("titleId"));
    const user = c.var.user!;
    const [report, title, source] = await Promise.all([
      c.var.db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId)).get(),
      c.var.db.select().from(reportTitles).where(eq(reportTitles.id, titleId)).get(),
      c.var.db.select().from(titleWeekEntries)
        .where(eq(titleWeekEntries.titleId, titleId))
        .orderBy(desc(titleWeekEntries.yearWeek)).get(),
    ]);
    if (!report || !title || !source) throw Errors.notFound();
    if (report.status !== "draft") throw Errors.conflict("제출된 보고서에서는 업무를 재개할 수 없습니다.");
    if (title.departmentId !== report.departmentId || !title.hiddenOnHold
      || !canEditOwner(user, report.departmentId, title.ownerId)) throw Errors.forbidden();
    if (source.result !== "hold") throw Errors.conflict("현재 보류 중인 타이틀이 아닙니다.");
    const existing = await c.var.db.select({ id: titleWeekEntries.id }).from(titleWeekEntries).where(and(
      eq(titleWeekEntries.titleId, titleId), eq(titleWeekEntries.reportId, reportId),
    )).get();
    if (existing) throw Errors.conflict("이미 금주 보고서에 등록된 타이틀입니다.");

    const now = Date.now();
    const entry = await c.var.db.insert(titleWeekEntries).values({
      titleId,
      reportId,
      yearWeek: report.yearWeek,
      detailId: title.detailId,
      ownerId: title.ownerId,
      thisWeekBody: source.nextPlanBody,
      thisWeekText: source.nextPlanText,
      performSchedule: source.dueSchedule,
      result: null,
      nextPlanBody: null,
      nextPlanText: null,
      dueSchedule: null,
      carriedOver: true,
      version: 1,
      updatedBy: user.id,
      createdAt: now,
      updatedAt: now,
    }).returning({ id: titleWeekEntries.id }).get();
    await c.var.db.update(reportTitles).set({
      hiddenOnHold: false,
      resumeYearWeek: null,
      endYearWeek: null,
      updatedAt: now,
    }).where(eq(reportTitles.id, titleId));
    await writeAudit(c.var.db, {
      actorId: user.id,
      action: "report.hold_resume",
      targetType: "report_title",
      targetId: titleId,
      before: { hiddenOnHold: true, heldYearWeek: source.yearWeek },
      after: { hiddenOnHold: false, reportId, entryId: entry.id },
      ip: clientIp(c),
    });
    return c.json({ entryId: entry.id }, 201);
  })
  .patch("/titles/:titleId", async (c) => {
    const titleId = parseId(c.req.param("titleId"));
    const input = titleUpdateSchema.parse(await c.req.json()) as WeeklyTitleUpdateRequest;
    const user = c.var.user!;
    const current = await c.var.db
      .select({ title: reportTitles, entryOwnerId: titleWeekEntries.ownerId, report: weeklyReports })
      .from(reportTitles)
      .innerJoin(titleWeekEntries, and(
        eq(titleWeekEntries.titleId, reportTitles.id),
        eq(titleWeekEntries.reportId, input.reportId),
      ))
      .innerJoin(weeklyReports, eq(weeklyReports.id, titleWeekEntries.reportId))
      .where(eq(reportTitles.id, titleId)).get();
    if (!current) throw Errors.notFound();
    if (current.report.status !== "draft") throw Errors.conflict("제출된 보고서는 수정할 수 없습니다.");
    if (!canEditOwner(user, current.report.departmentId, current.entryOwnerId)) throw Errors.forbidden();

    const parsed = parseTitleInput(input.title);
    if (!parsed.name) throw Errors.badRequest("타이틀명을 입력하세요.");
    const before = { number: current.title.number, name: current.title.name };
    await c.var.db.update(reportTitles).set({
      number: parsed.number ?? current.title.number,
      name: parsed.name,
      updatedAt: Date.now(),
    }).where(eq(reportTitles.id, titleId));
    await writeAudit(c.var.db, {
      actorId: user.id,
      action: "report.title_update",
      targetType: "report_title",
      targetId: titleId,
      before,
      after: { number: parsed.number ?? current.title.number, name: parsed.name },
      ip: clientIp(c),
    });
    return c.json({ ok: true });
  })
  .patch("/titles/:titleId/manage", async (c) => {
    const titleId = parseId(c.req.param("titleId"));
    const input = titleManageSchema.parse(await c.req.json()) as WeeklyTitleManageRequest;
    const user = c.var.user!;
    const current = await c.var.db
      .select({ title: reportTitles, report: weeklyReports })
      .from(reportTitles)
      .innerJoin(titleWeekEntries, and(
        eq(titleWeekEntries.titleId, reportTitles.id), eq(titleWeekEntries.reportId, input.reportId),
      ))
      .innerJoin(weeklyReports, eq(weeklyReports.id, titleWeekEntries.reportId))
      .where(eq(reportTitles.id, titleId)).get();
    if (!current) throw Errors.notFound();
    if (current.report.status !== "draft") throw Errors.conflict("제출된 보고서는 수정할 수 없습니다.");
    if (user.role !== "leader" || user.departmentId !== current.report.departmentId) throw Errors.forbidden();
    const [owner, detail] = await Promise.all([
      c.var.db.select().from(employees).where(eq(employees.id, input.ownerId)).get(),
      c.var.db.select().from(reportDetails).where(eq(reportDetails.id, input.detailId)).get(),
    ]);
    if (!owner || owner.departmentId !== current.report.departmentId || owner.status !== "active"
      || (owner.role !== "member" && owner.role !== "leader")) {
      throw Errors.badRequest("같은 부서의 재직 사원만 담당자로 지정할 수 있습니다.");
    }
    if (!detail || detail.departmentId !== current.report.departmentId || !detail.isActive) {
      throw Errors.badRequest("같은 부서의 사용 중인 세부내용만 선택할 수 있습니다.");
    }

    const targetTitles = await c.var.db.select({ id: reportTitles.id, sortOrder: reportTitles.sortOrder })
      .from(reportTitles).where(eq(reportTitles.detailId, input.detailId))
      .orderBy(asc(reportTitles.sortOrder), asc(reportTitles.id));
    let sortOrder = current.title.detailId === input.detailId
      ? current.title.sortOrder : Math.max(0, ...targetTitles.map((item) => item.sortOrder)) + 1;
    if (input.direction && current.title.detailId === input.detailId) {
      const index = targetTitles.findIndex((item) => item.id === titleId);
      const neighbor = targetTitles[index + (input.direction === "up" ? -1 : 1)];
      if (neighbor) {
        await c.var.db.update(reportTitles).set({ sortOrder: current.title.sortOrder, updatedAt: Date.now() })
          .where(eq(reportTitles.id, neighbor.id));
        sortOrder = neighbor.sortOrder;
      }
    }
    const now = Date.now();
    await c.var.db.update(reportTitles).set({
      ownerId: input.ownerId, detailId: input.detailId, sortOrder, updatedAt: now,
    }).where(eq(reportTitles.id, titleId));
    await c.var.db.update(titleWeekEntries).set({
      ownerId: input.ownerId, detailId: input.detailId, updatedBy: user.id, updatedAt: now,
    }).where(and(eq(titleWeekEntries.titleId, titleId), gte(titleWeekEntries.yearWeek, current.report.yearWeek)));
    await writeAudit(c.var.db, {
      actorId: user.id, action: "report.title_manage", targetType: "report_title", targetId: titleId,
      before: { ownerId: current.title.ownerId, detailId: current.title.detailId, sortOrder: current.title.sortOrder },
      after: { ownerId: input.ownerId, detailId: input.detailId, sortOrder }, ip: clientIp(c),
    });
    return c.json({ ok: true });
  })
  .get("/titles/:titleId/history", async (c) => {
    const titleId = parseId(c.req.param("titleId"));
    const reportId = parseId(c.req.query("reportId") ?? "");
    const title = await c.var.db.select().from(reportTitles).where(eq(reportTitles.id, titleId)).get();
    if (!title) throw Errors.notFound();
    const items = await c.var.db
      .select({
        id: titleWeekEntries.id,
        reportId: titleWeekEntries.reportId,
        yearWeek: titleWeekEntries.yearWeek,
        status: weeklyReports.status,
        thisWeekText: titleWeekEntries.thisWeekText,
        result: titleWeekEntries.result,
        nextPlanText: titleWeekEntries.nextPlanText,
        updatedAt: titleWeekEntries.updatedAt,
      })
      .from(titleWeekEntries)
      .innerJoin(weeklyReports, eq(titleWeekEntries.reportId, weeklyReports.id))
      .where(eq(titleWeekEntries.titleId, titleId))
      .orderBy(desc(titleWeekEntries.yearWeek));
    const report = await c.var.db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId)).get();
    const user = c.var.user!;
    let deleteBlockReason: string | null = null;
    if (!report || !items.some((item) => item.reportId === reportId)) {
      deleteBlockReason = "현재 보고서에서 이 타이틀을 찾을 수 없습니다.";
    } else if (report.status !== "draft") {
      deleteBlockReason = "제출된 현재 보고서의 타이틀은 삭제할 수 없습니다.";
    } else if (report.departmentId !== title.departmentId
      || user.role !== "leader" || user.departmentId !== title.departmentId) {
      deleteBlockReason = "같은 부서의 팀장만 타이틀을 삭제할 수 있습니다.";
    } else if (items.some((item) => item.status !== "draft")) {
      deleteBlockReason = "제출된 주차 이력이 있어 삭제할 수 없습니다. 중단으로 종료하세요.";
    }
    const canDelete = deleteBlockReason === null;
    return c.json<WeeklyTitleHistoryResponse>({
      title: { id: title.id, number: title.number, name: title.name },
      items: items.map(({ reportId: _reportId, ...item }) => item),
      canDelete,
      deleteBlockReason,
    });
  })
  .delete("/:reportId/titles/:titleId", async (c) => {
    const reportId = parseId(c.req.param("reportId"));
    const titleId = parseId(c.req.param("titleId"));
    const user = c.var.user!;
    const [report, title, entries] = await Promise.all([
      c.var.db.select().from(weeklyReports).where(eq(weeklyReports.id, reportId)).get(),
      c.var.db.select().from(reportTitles).where(eq(reportTitles.id, titleId)).get(),
      c.var.db.select({
        id: titleWeekEntries.id,
        reportId: titleWeekEntries.reportId,
        status: weeklyReports.status,
      }).from(titleWeekEntries)
        .innerJoin(weeklyReports, eq(titleWeekEntries.reportId, weeklyReports.id))
        .where(eq(titleWeekEntries.titleId, titleId)),
    ]);
    if (!report || !title) throw Errors.notFound();
    if (report.status !== "draft") throw Errors.conflict("제출된 보고서는 수정할 수 없습니다.");
    if (user.role !== "leader" || user.departmentId !== report.departmentId
      || title.departmentId !== report.departmentId) throw Errors.forbidden();
    if (!entries.some((entry) => entry.reportId === reportId)) throw Errors.notFound();
    if (entries.some((entry) => entry.status !== "draft")) {
      throw Errors.conflict("제출된 주차 이력이 있어 삭제할 수 없습니다. 중단으로 종료하세요.");
    }
    const entryIds = entries.map((entry) => entry.id);
    const files = entryIds.length > 0 ? await c.var.db.select({ r2Key: attachments.r2Key })
      .from(attachments).where(and(eq(attachments.ownerType, "entry"), inArray(attachments.ownerId, entryIds))) : [];
    await c.env.DB.batch([
      c.env.DB.prepare("DELETE FROM decision_requests WHERE title_id = ?").bind(titleId),
      c.env.DB.prepare("DELETE FROM attachments WHERE owner_type = 'entry' AND owner_id IN (SELECT id FROM title_week_entries WHERE title_id = ?)").bind(titleId),
      c.env.DB.prepare("DELETE FROM title_week_entries WHERE title_id = ?").bind(titleId),
      c.env.DB.prepare("DELETE FROM report_titles WHERE id = ?").bind(titleId),
    ]);
    if (files.length > 0) {
      c.executionCtx.waitUntil(Promise.all(files.map((file) => c.env.FILES.delete(file.r2Key))).then(() => undefined));
    }
    await writeAudit(c.var.db, {
      actorId: user.id, action: "report.title_delete", targetType: "report_title",
      targetId: titleId, before: title, ip: clientIp(c),
    });
    return c.body(null, 204);
  })
  .get("/options", async (c) => {
    const departmentRows = await c.var.db
      .select({ id: departments.id, code: departments.code, name: departments.name })
      .from(departments)
      .where(eq(departments.isActive, true))
      .orderBy(asc(departments.sortOrder), asc(departments.name));
    const currentYearWeek = getIsoWeek(toKstDateString()).yearWeek;
    return c.json<WeeklyReportOptionsResponse>({
      departments: departmentRows,
      currentYearWeek,
      maximumYearWeek: shiftYearWeek(currentYearWeek, 1),
    });
  })
  .get("/:departmentCode/:week", async (c) => {
    const departmentCode = c.req.param("departmentCode").trim().toUpperCase();
    const yearWeek = parseYearWeekSlug(c.req.param("week"));
    if (!yearWeek) throw Errors.badRequest("올바른 주차 형식이 아닙니다. 예: 2026-W42");
    if (!canOpenYearWeek(yearWeek)) throw Errors.badRequest("다음 주차까지만 조회할 수 있습니다.");

    const department = await c.var.db
      .select()
      .from(departments)
      .where(eq(departments.code, departmentCode))
      .get();
    if (!department) throw Errors.notFound();

    const report = await ensureReport(c.var.db, department.id, yearWeek, c.var.user!.id);
    return c.json(await buildReportResponse(c.var.db, c.var.user!, department, yearWeek, report));
  });
