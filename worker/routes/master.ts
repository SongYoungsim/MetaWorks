import { Hono } from "hono";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import {
  actionItems,
  codes,
  departments,
  employees,
  meetings,
  reportCategories,
  reportDetails,
  reportTitles,
  settings,
  titleWeekEntries,
  weeklyReports,
} from "../db/schema";
import type { AppEnv, Db } from "../env";
import { writeAudit } from "../lib/audit";
import { Errors } from "../lib/errors";
import { loadSettings } from "../lib/settings";
import { clientIp, requireAdmin, requireAuth } from "../middleware/session";
import type {
  MasterCategory,
  MasterDataResponse,
  MasterDepartment,
  MasterEmployeeOption,
  MasterMeetingType,
  MasterReportDetail,
  MasterReportTitle,
  MasterSettings,
} from "@shared/types";

const departmentSchema = z.object({
  code: z.string().trim().toUpperCase().regex(/^T[0-9]{2}$/, "부서 코드는 T01 형식이어야 합니다."),
  name: z.string().trim().min(1, "부서명을 입력하세요.").max(20),
  leaderId: z.number().int().positive().nullable(),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
});

const detailSchema = z.object({
  departmentId: z.number().int().positive(),
  categoryId: z.number().int().positive(),
  name: z.string().trim().min(1, "세부내용명을 입력하세요.").max(30),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
});

const categorySchema = z.object({
  name: z.string().trim().min(1, "구분명을 입력하세요.").max(20),
  sortOrder: z.number().int().min(0).max(999),
});

const meetingTypeSchema = z.object({
  name: z.string().trim().min(1, "회의 구분명을 입력하세요.").max(10),
  sortOrder: z.number().int().min(0).max(999),
  isActive: z.boolean(),
});

const timeSchema = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "시간은 HH:mm 형식이어야 합니다.");
const settingsSchema = z.object({
  reportDeadlineWeekday: z.number().int().min(1).max(7),
  reportDeadlineTime: timeSchema,
  reportReminderWeekday: z.number().int().min(1).max(7),
  reportReminderTime: timeSchema,
  actionOverdueDays: z.number().int().min(3).max(90),
  passwordMinLength: z.number().int().min(8).max(20),
  passwordRequireSpecial: z.boolean(),
  loginMaxFailures: z.number().int().min(3).max(10),
  loginLockMinutes: z.number().int().min(5).max(60),
  sessionIdleHours: z.number().int().min(1).max(24),
  aiDailyLimit: z.number().int().min(0).max(100000),
});

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw Errors.badRequest("올바르지 않은 식별자입니다.");
  return id;
}

function frequency(values: Array<number | null>): Map<number, number> {
  const counts = new Map<number, number>();
  for (const value of values) {
    if (value !== null) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

async function ensureUniqueDepartment(db: Db, code: string, name: string, excludeId?: number) {
  const rows = await db
    .select({ id: departments.id, code: departments.code, name: departments.name })
    .from(departments);
  if (rows.some((row) => row.id !== excludeId && row.code === code)) {
    throw Errors.conflict("이미 사용 중인 부서 코드입니다.", { code: "중복된 코드입니다." });
  }
  if (rows.some((row) => row.id !== excludeId && row.name === name)) {
    throw Errors.conflict("이미 사용 중인 부서명입니다.", { name: "중복된 부서명입니다." });
  }
}

async function validateLeader(db: Db, leaderId: number | null, departmentId: number) {
  if (leaderId === null) return;
  const leader = await db.select().from(employees).where(eq(employees.id, leaderId)).get();
  if (!leader || leader.status === "inactive" || leader.departmentId !== departmentId) {
    throw Errors.badRequest("같은 부서의 재직 사원만 부서장으로 지정할 수 있습니다.", {
      leaderId: "부서와 재직 상태를 확인하세요.",
    });
  }
}

async function changeDepartmentLeader(
  db: Db,
  departmentId: number,
  previousLeaderId: number | null,
  nextLeaderId: number | null,
) {
  if (previousLeaderId && previousLeaderId !== nextLeaderId) {
    await db
      .update(employees)
      .set({ role: "member", updatedAt: Date.now() })
      .where(and(eq(employees.id, previousLeaderId), eq(employees.role, "leader")));
  }
  if (nextLeaderId && previousLeaderId !== nextLeaderId) {
    const otherDepartment = await db
      .select({ id: departments.id })
      .from(departments)
      .where(eq(departments.leaderId, nextLeaderId))
      .get();
    if (otherDepartment && otherDepartment.id !== departmentId) {
      throw Errors.conflict("이미 다른 부서의 부서장으로 지정된 사원입니다.", {
        leaderId: "다른 부서의 부서장입니다.",
      });
    }
    await db
      .update(employees)
      .set({ role: "leader", updatedAt: Date.now() })
      .where(eq(employees.id, nextLeaderId));
  }
}

async function readSettings(db: Db): Promise<MasterSettings> {
  const current = await loadSettings(db, [
    "report.deadline",
    "report.reminderTime",
    "action.overdueDays",
    "password.minLength",
    "password.requireSpecial",
    "login.maxFailures",
    "login.lockMinutes",
    "session.idleHours",
    "ai.dailyLimit",
  ]);
  return {
    reportDeadlineWeekday: current["report.deadline"].weekday,
    reportDeadlineTime: current["report.deadline"].time,
    reportReminderWeekday: current["report.reminderTime"].weekday,
    reportReminderTime: current["report.reminderTime"].time,
    actionOverdueDays: current["action.overdueDays"],
    passwordMinLength: current["password.minLength"],
    passwordRequireSpecial: current["password.requireSpecial"],
    loginMaxFailures: current["login.maxFailures"],
    loginLockMinutes: current["login.lockMinutes"],
    sessionIdleHours: current["session.idleHours"],
    aiDailyLimit: current["ai.dailyLimit"],
  };
}

async function readMasterData(db: Db): Promise<MasterDataResponse> {
  const [departmentRows, employeeRows, actionRows, detailRows, titleRows, titleEntryRows, categoryRows, codeRows, meetingRows] =
    await Promise.all([
      db.select().from(departments).orderBy(asc(departments.sortOrder), asc(departments.name)),
      db
        .select({
          id: employees.id,
          name: employees.name,
          departmentId: employees.departmentId,
          role: employees.role,
          status: employees.status,
        })
        .from(employees)
        .orderBy(asc(employees.name)),
      db.select({ departmentId: actionItems.departmentId, typeCode: actionItems.meetingTypeCode }).from(actionItems),
      db.select().from(reportDetails).orderBy(asc(reportDetails.sortOrder), asc(reportDetails.name)),
      db.select().from(reportTitles),
      db.select({
        titleId: titleWeekEntries.titleId,
        yearWeek: titleWeekEntries.yearWeek,
        result: titleWeekEntries.result,
        reportStatus: weeklyReports.status,
      }).from(titleWeekEntries)
        .innerJoin(weeklyReports, eq(titleWeekEntries.reportId, weeklyReports.id))
        .orderBy(asc(titleWeekEntries.titleId), desc(titleWeekEntries.yearWeek)),
      db.select().from(reportCategories).orderBy(asc(reportCategories.sortOrder)),
      db
        .select()
        .from(codes)
        .where(eq(codes.groupCode, "MEETING_TYPE"))
        .orderBy(asc(codes.sortOrder), asc(codes.name)),
      db.select({ typeCode: meetings.typeCode }).from(meetings),
    ]);

  const employeeCounts = frequency(employeeRows.map((row) => row.departmentId));
  const actionCounts = frequency(actionRows.map((row) => row.departmentId));
  const titleCounts = frequency(titleRows.map((row) => row.detailId));
  const meetingUsage = new Map<string, number>();
  for (const row of meetingRows) meetingUsage.set(row.typeCode, (meetingUsage.get(row.typeCode) ?? 0) + 1);
  for (const row of actionRows) meetingUsage.set(row.typeCode, (meetingUsage.get(row.typeCode) ?? 0) + 1);
  const employeeNames = new Map(employeeRows.map((row) => [row.id, row.name]));
  const departmentCodes = new Map(departmentRows.map((row) => [row.id, row.code]));
  const latestEntryByTitle = new Map<number, (typeof titleEntryRows)[number]>();
  for (const entry of titleEntryRows) {
    if (!latestEntryByTitle.has(entry.titleId)) latestEntryByTitle.set(entry.titleId, entry);
  }

  const departmentResult: MasterDepartment[] = departmentRows.map((row) => ({
    id: row.id,
    code: row.code,
    name: row.name,
    leaderId: row.leaderId,
    leaderName: row.leaderId ? employeeNames.get(row.leaderId) ?? null : null,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    employeeCount: employeeCounts.get(row.id) ?? 0,
    actionCount: actionCounts.get(row.id) ?? 0,
  }));
  const categoryResult: MasterCategory[] = categoryRows;
  const detailResult: MasterReportDetail[] = detailRows.map((row) => ({
    ...row,
    titleCount: titleCounts.get(row.id) ?? 0,
  }));
  const reportTitleResult: MasterReportTitle[] = titleRows.flatMap((row) => {
    const latest = latestEntryByTitle.get(row.id);
    const departmentCode = departmentCodes.get(row.departmentId);
    if (!latest || !departmentCode) return [];
    return [{
      id: row.id,
      detailId: row.detailId,
      departmentCode,
      number: row.number,
      name: row.name,
      ownerName: employeeNames.get(row.ownerId) ?? "미지정",
      startYearWeek: row.startYearWeek,
      endYearWeek: row.endYearWeek,
      hiddenOnHold: row.hiddenOnHold,
      latestYearWeek: latest.yearWeek,
      latestResult: latest.result,
      latestReportStatus: latest.reportStatus,
    }];
  });
  const meetingTypeResult: MasterMeetingType[] = codeRows.map((row) => ({
    code: row.code,
    name: row.name,
    sortOrder: row.sortOrder,
    isActive: row.isActive,
    usageCount: meetingUsage.get(row.code) ?? 0,
  }));
  const employeeResult: MasterEmployeeOption[] = employeeRows;

  return {
    departments: departmentResult,
    categories: categoryResult,
    reportDetails: detailResult,
    reportTitles: reportTitleResult,
    meetingTypes: meetingTypeResult,
    employees: employeeResult,
    settings: await readSettings(db),
  };
}

export const masterRoutes = new Hono<AppEnv>()
  .use("*", requireAuth(), requireAdmin)

  .get("/", async (c) => c.json(await readMasterData(c.var.db)))

  .post("/departments", async (c) => {
    const parsed = departmentSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? "입력값을 확인하세요.");
    const input = parsed.data;
    if (input.leaderId !== null) {
      throw Errors.badRequest("부서를 먼저 등록한 뒤 부서장을 지정하세요.", {
        leaderId: "신규 부서에는 부서장을 바로 지정할 수 없습니다.",
      });
    }
    await ensureUniqueDepartment(c.var.db, input.code, input.name);
    const row = await c.var.db
      .insert(departments)
      .values({ ...input, createdAt: Date.now(), updatedAt: Date.now() })
      .returning()
      .get();
    await writeAudit(c.var.db, {
      actorId: c.var.user!.id,
      action: "master.department.create",
      targetType: "department",
      targetId: row.id,
      after: row,
      ip: clientIp(c),
    });
    return c.json(row, 201);
  })

  .patch("/departments/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const parsed = departmentSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? "입력값을 확인하세요.");
    const before = await c.var.db.select().from(departments).where(eq(departments.id, id)).get();
    if (!before) throw Errors.notFound();
    if (parsed.data.code !== before.code) {
      throw Errors.badRequest("부서 코드는 생성 후 변경할 수 없습니다.", {
        code: "기존 코드를 유지하세요.",
      });
    }
    await ensureUniqueDepartment(c.var.db, parsed.data.code, parsed.data.name, id);
    await validateLeader(c.var.db, parsed.data.leaderId, id);
    await changeDepartmentLeader(c.var.db, id, before.leaderId, parsed.data.leaderId);
    await c.var.db
      .update(departments)
      .set({ ...parsed.data, updatedAt: Date.now() })
      .where(eq(departments.id, id));
    const after = await c.var.db.select().from(departments).where(eq(departments.id, id)).get();
    await writeAudit(c.var.db, {
      actorId: c.var.user!.id,
      action: "master.department.update",
      targetType: "department",
      targetId: id,
      before,
      after,
      ip: clientIp(c),
    });
    return c.json(after!);
  })

  .delete("/departments/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const before = await c.var.db.select().from(departments).where(eq(departments.id, id)).get();
    if (!before) throw Errors.notFound();
    const [employee, action, detail, report] = await Promise.all([
      c.var.db.select({ id: employees.id }).from(employees).where(eq(employees.departmentId, id)).get(),
      c.var.db.select({ id: actionItems.id }).from(actionItems).where(eq(actionItems.departmentId, id)).get(),
      c.var.db.select({ id: reportDetails.id }).from(reportDetails).where(eq(reportDetails.departmentId, id)).get(),
      c.var.db.select({ id: weeklyReports.id }).from(weeklyReports).where(eq(weeklyReports.departmentId, id)).get(),
    ]);
    if (employee || action || detail || report) {
      throw Errors.conflict("연결된 데이터가 있어 삭제할 수 없습니다. 사용 여부를 꺼 주세요.");
    }
    await c.var.db.delete(departments).where(eq(departments.id, id));
    await writeAudit(c.var.db, {
      actorId: c.var.user!.id,
      action: "master.department.delete",
      targetType: "department",
      targetId: id,
      before,
      ip: clientIp(c),
    });
    return c.body(null, 204);
  })

  .patch("/categories/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const parsed = categorySchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? "입력값을 확인하세요.");
    const before = await c.var.db.select().from(reportCategories).where(eq(reportCategories.id, id)).get();
    if (!before) throw Errors.notFound();
    if (before.isSystem || before.code === "TRAVEL") {
      throw Errors.conflict("시스템 구분은 변경할 수 없습니다.");
    }
    await c.var.db
      .update(reportCategories)
      .set({ ...parsed.data, updatedAt: Date.now() })
      .where(eq(reportCategories.id, id));
    const after = await c.var.db.select().from(reportCategories).where(eq(reportCategories.id, id)).get();
    await writeAudit(c.var.db, {
      actorId: c.var.user!.id,
      action: "master.category.update",
      targetType: "report_category",
      targetId: id,
      before,
      after,
      ip: clientIp(c),
    });
    return c.json(after!);
  })

  .post("/report-details", async (c) => {
    const parsed = detailSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? "입력값을 확인하세요.");
    const input = parsed.data;
    const [department, category, duplicate] = await Promise.all([
      c.var.db.select().from(departments).where(eq(departments.id, input.departmentId)).get(),
      c.var.db.select().from(reportCategories).where(eq(reportCategories.id, input.categoryId)).get(),
      c.var.db
        .select({ id: reportDetails.id })
        .from(reportDetails)
        .where(
          and(
            eq(reportDetails.departmentId, input.departmentId),
            eq(reportDetails.categoryId, input.categoryId),
            eq(reportDetails.name, input.name),
          ),
        )
        .get(),
    ]);
    if (!department || !department.isActive) throw Errors.badRequest("사용 중인 부서를 선택하세요.");
    if (!category || category.code === "TRAVEL") throw Errors.badRequest("KPI 또는 일반 구분을 선택하세요.");
    if (duplicate) throw Errors.conflict("같은 부서와 구분에 동일한 세부내용이 있습니다.");
    const row = await c.var.db
      .insert(reportDetails)
      .values({ ...input, createdAt: Date.now(), updatedAt: Date.now() })
      .returning()
      .get();
    await writeAudit(c.var.db, {
      actorId: c.var.user!.id,
      action: "master.report_detail.create",
      targetType: "report_detail",
      targetId: row.id,
      after: row,
      ip: clientIp(c),
    });
    return c.json(row, 201);
  })

  .patch("/report-details/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const parsed = detailSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? "입력값을 확인하세요.");
    const input = parsed.data;
    const before = await c.var.db.select().from(reportDetails).where(eq(reportDetails.id, id)).get();
    if (!before) throw Errors.notFound();
    const [department, category, duplicates] = await Promise.all([
      c.var.db.select().from(departments).where(eq(departments.id, input.departmentId)).get(),
      c.var.db.select().from(reportCategories).where(eq(reportCategories.id, input.categoryId)).get(),
      c.var.db
        .select({ id: reportDetails.id })
        .from(reportDetails)
        .where(
          and(
            eq(reportDetails.departmentId, input.departmentId),
            eq(reportDetails.categoryId, input.categoryId),
            eq(reportDetails.name, input.name),
          ),
        ),
    ]);
    if (!department || !department.isActive) throw Errors.badRequest("사용 중인 부서를 선택하세요.");
    if (!category || category.code === "TRAVEL") throw Errors.badRequest("KPI 또는 일반 구분을 선택하세요.");
    if (duplicates.some((row) => row.id !== id)) {
      throw Errors.conflict("같은 부서와 구분에 동일한 세부내용이 있습니다.");
    }
    await c.var.db
      .update(reportDetails)
      .set({ ...input, updatedAt: Date.now() })
      .where(eq(reportDetails.id, id));
    const after = await c.var.db.select().from(reportDetails).where(eq(reportDetails.id, id)).get();
    await writeAudit(c.var.db, {
      actorId: c.var.user!.id,
      action: "master.report_detail.update",
      targetType: "report_detail",
      targetId: id,
      before,
      after,
      ip: clientIp(c),
    });
    return c.json(after!);
  })

  .delete("/report-details/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const before = await c.var.db.select().from(reportDetails).where(eq(reportDetails.id, id)).get();
    if (!before) throw Errors.notFound();
    const title = await c.var.db.select({ id: reportTitles.id }).from(reportTitles).where(eq(reportTitles.detailId, id)).get();
    if (title) throw Errors.conflict("연결된 보고 항목이 있어 삭제할 수 없습니다. 사용 여부를 꺼 주세요.");
    await c.var.db.delete(reportDetails).where(eq(reportDetails.id, id));
    await writeAudit(c.var.db, {
      actorId: c.var.user!.id,
      action: "master.report_detail.delete",
      targetType: "report_detail",
      targetId: id,
      before,
      ip: clientIp(c),
    });
    return c.body(null, 204);
  })

  .post("/meeting-types", async (c) => {
    const parsed = meetingTypeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? "입력값을 확인하세요.");
    const existing = await c.var.db
      .select({ name: codes.name })
      .from(codes)
      .where(eq(codes.groupCode, "MEETING_TYPE"));
    if (existing.some((row) => row.name === parsed.data.name)) {
      throw Errors.conflict("이미 사용 중인 회의 구분명입니다.");
    }
    const code = "CUSTOM_" + crypto.randomUUID().replaceAll("-", "").slice(0, 10).toUpperCase();
    const now = Date.now();
    const row = { groupCode: "MEETING_TYPE", code, ...parsed.data, createdAt: now, updatedAt: now };
    await c.var.db.insert(codes).values(row);
    await writeAudit(c.var.db, {
      actorId: c.var.user!.id,
      action: "master.meeting_type.create",
      targetType: "meeting_type",
      targetId: code,
      after: row,
      ip: clientIp(c),
    });
    return c.json(row, 201);
  })

  .patch("/meeting-types/:code", async (c) => {
    const code = c.req.param("code");
    const parsed = meetingTypeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? "입력값을 확인하세요.");
    const before = await c.var.db
      .select()
      .from(codes)
      .where(and(eq(codes.groupCode, "MEETING_TYPE"), eq(codes.code, code)))
      .get();
    if (!before) throw Errors.notFound();
    const names = await c.var.db
      .select({ code: codes.code, name: codes.name })
      .from(codes)
      .where(eq(codes.groupCode, "MEETING_TYPE"));
    if (names.some((row) => row.code !== code && row.name === parsed.data.name)) {
      throw Errors.conflict("이미 사용 중인 회의 구분명입니다.");
    }
    await c.var.db
      .update(codes)
      .set({ ...parsed.data, updatedAt: Date.now() })
      .where(and(eq(codes.groupCode, "MEETING_TYPE"), eq(codes.code, code)));
    const after = await c.var.db
      .select()
      .from(codes)
      .where(and(eq(codes.groupCode, "MEETING_TYPE"), eq(codes.code, code)))
      .get();
    await writeAudit(c.var.db, {
      actorId: c.var.user!.id,
      action: "master.meeting_type.update",
      targetType: "meeting_type",
      targetId: code,
      before,
      after,
      ip: clientIp(c),
    });
    return c.json(after!);
  })

  .delete("/meeting-types/:code", async (c) => {
    const code = c.req.param("code");
    const before = await c.var.db
      .select()
      .from(codes)
      .where(and(eq(codes.groupCode, "MEETING_TYPE"), eq(codes.code, code)))
      .get();
    if (!before) throw Errors.notFound();
    const [meeting, action] = await Promise.all([
      c.var.db.select({ id: meetings.id }).from(meetings).where(eq(meetings.typeCode, code)).get(),
      c.var.db.select({ id: actionItems.id }).from(actionItems).where(eq(actionItems.meetingTypeCode, code)).get(),
    ]);
    if (meeting || action) {
      throw Errors.conflict("연결된 회의 또는 액션아이템이 있어 삭제할 수 없습니다. 사용 여부를 꺼 주세요.");
    }
    await c.var.db
      .delete(codes)
      .where(and(eq(codes.groupCode, "MEETING_TYPE"), eq(codes.code, code)));
    await writeAudit(c.var.db, {
      actorId: c.var.user!.id,
      action: "master.meeting_type.delete",
      targetType: "meeting_type",
      targetId: code,
      before,
      ip: clientIp(c),
    });
    return c.body(null, 204);
  })

  .put("/settings", async (c) => {
    const parsed = settingsSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? "입력값을 확인하세요.");
    const before = await readSettings(c.var.db);
    const input = parsed.data;
    const values: Array<{ key: string; value: unknown }> = [
      {
        key: "report.deadline",
        value: { weekday: input.reportDeadlineWeekday, time: input.reportDeadlineTime },
      },
      {
        key: "report.reminderTime",
        value: { weekday: input.reportReminderWeekday, time: input.reportReminderTime },
      },
      { key: "action.overdueDays", value: input.actionOverdueDays },
      { key: "password.minLength", value: input.passwordMinLength },
      { key: "password.requireSpecial", value: input.passwordRequireSpecial },
      { key: "login.maxFailures", value: input.loginMaxFailures },
      { key: "login.lockMinutes", value: input.loginLockMinutes },
      { key: "session.idleHours", value: input.sessionIdleHours },
      { key: "ai.dailyLimit", value: input.aiDailyLimit },
    ];
    const now = Date.now();
    for (const item of values) {
      await c.var.db
        .insert(settings)
        .values({
          key: item.key,
          value: JSON.stringify(item.value),
          updatedAt: now,
          updatedBy: c.var.user!.id,
        })
        .onConflictDoUpdate({
          target: settings.key,
          set: {
            value: JSON.stringify(item.value),
            updatedAt: now,
            updatedBy: c.var.user!.id,
          },
        });
    }
    const after = await readSettings(c.var.db);
    await writeAudit(c.var.db, {
      actorId: c.var.user!.id,
      action: "master.settings.update",
      targetType: "settings",
      targetId: "system",
      before,
      after,
      ip: clientIp(c),
    });
    return c.json(after);
  });
