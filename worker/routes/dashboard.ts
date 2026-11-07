import { Hono } from "hono";
import { asc, eq } from "drizzle-orm";
import type { ActionStatus, DashboardResponse } from "@shared/types";
import { getIsoWeek, getIsoWeekRange, shiftYearWeek, toKstDateString } from "@shared/week";
import { actionItems, departments } from "../db/schema";
import type { AppEnv } from "../env";
import { Errors } from "../lib/errors";
import { loadSettings } from "../lib/settings";
import { requireAuth } from "../middleware/session";

const WEEK_OPTIONS = new Set([4, 8, 12, 26]);

function parseDepartment(value: string | undefined) {
  if (!value) return null;
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw Errors.badRequest("조회 부서를 확인하세요.");
  return id;
}

function elapsedDays(from: string, to: string) {
  return Math.max(0, Math.floor((Date.parse(to + "T00:00:00Z") - Date.parse(from + "T00:00:00Z")) / 86_400_000));
}

function average(values: number[]) {
  return values.length ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length * 10) / 10 : 0;
}

export const dashboardRoutes = new Hono<AppEnv>()
  .use("*", requireAuth())
  .get("/", async (c) => {
    const weeks = Number(c.req.query("weeks") ?? 8);
    if (!WEEK_OPTIONS.has(weeks)) throw Errors.badRequest("조회 기간을 확인하세요.");
    const scopeType = c.req.query("scope") === "team" ? "team" : "all";
    const requestedDepartment = parseDepartment(c.req.query("departmentId"));
    const departmentId = scopeType === "team" ? (requestedDepartment ?? c.var.user!.departmentId) : null;
    if (scopeType === "team" && !departmentId) throw Errors.badRequest("조회할 부서를 선택하세요.");

    const [departmentRows, rows, setting] = await Promise.all([
      c.var.db.select({
        id: departments.id, code: departments.code, name: departments.name,
        leaderId: departments.leaderId, isActive: departments.isActive,
        sortOrder: departments.sortOrder,
      }).from(departments).where(eq(departments.isActive, true)).orderBy(asc(departments.sortOrder), asc(departments.name)),
      c.var.db.select().from(actionItems),
      loadSettings(c.var.db, ["action.overdueDays"]),
    ]);
    const selectedDepartment = departmentId ? departmentRows.find((department) => department.id === departmentId) : null;
    if (departmentId && !selectedDepartment) throw Errors.badRequest("사용 중인 부서가 아닙니다.");
    const scoped = rows.filter((row) => !departmentId || row.departmentId === departmentId);
    const today = toKstDateString();
    const currentYearWeek = getIsoWeek(today).yearWeek;
    const currentRange = getIsoWeekRange(currentYearWeek);
    const overdueDays = setting["action.overdueDays"];
    const done = scoped.filter((row) => row.status === "done");
    const incomplete = scoped.filter((row) => row.status !== "done");
    const durations = done.flatMap((row) => row.completedDate ? [elapsedDays(row.meetingDate, row.completedDate)] : []);

    const weekNumbers = Array.from({ length: weeks }, (_, index) => shiftYearWeek(currentYearWeek, index - weeks + 1));
    const weekly = weekNumbers.map((yearWeek) => {
      const range = getIsoWeekRange(yearWeek);
      return {
        yearWeek,
        label: `${yearWeek % 100}주`,
        monday: range.monday,
        friday: range.friday,
        registered: scoped.filter((row) => row.meetingDate >= range.monday && row.meetingDate <= range.friday).length,
        completed: scoped.filter((row) => row.completedDate && row.completedDate >= range.monday && row.completedDate <= range.friday).length,
        current: yearWeek === currentYearWeek,
      };
    });

    const departmentStatus = departmentRows
      .filter((department) => !departmentId || department.id === departmentId)
      .map((department) => {
        const items = scoped.filter((row) => row.departmentId === department.id);
        const completedItems = items.filter((row) => row.status === "done");
        const completedDurations = completedItems.flatMap((row) => row.completedDate ? [elapsedDays(row.meetingDate, row.completedDate)] : []);
        return {
          id: department.id,
          name: department.name,
          total: items.length,
          unregistered: items.filter((row) => row.status === "unregistered").length,
          inProgress: items.filter((row) => row.status === "in_progress").length,
          hold: items.filter((row) => row.status === "hold").length,
          done: completedItems.length,
          completionRate: items.length ? Math.round(completedItems.length / items.length * 100) : 0,
          averageDays: average(completedDurations),
          overdue: items.filter((row) => row.status !== "done" && elapsedDays(row.meetingDate, today) >= overdueDays).length,
        };
      });
    const departmentMap = new Map(departmentRows.map((department) => [department.id, department.name]));
    const attention = incomplete.map((row) => ({
      id: row.id,
      departmentId: row.departmentId,
      departmentName: departmentMap.get(row.departmentId) ?? "부서",
      subject: row.subject,
      meetingDate: row.meetingDate,
      status: row.status as ActionStatus,
      elapsedDays: elapsedDays(row.meetingDate, today),
    })).sort((a, b) => b.elapsedDays - a.elapsedDays).slice(0, 5);

    return c.json<DashboardResponse>({
      departments: departmentRows.map(({ sortOrder: _sortOrder, ...department }) => department),
      currentYearWeek,
      week: { monday: currentRange.monday, friday: currentRange.friday },
      scope: { type: scopeType, departmentId, departmentName: selectedDepartment?.name ?? null },
      summary: {
        newActions: scoped.filter((row) => row.meetingDate >= currentRange.monday && row.meetingDate <= currentRange.friday).length,
        incomplete: incomplete.length,
        inProgress: incomplete.filter((row) => row.status === "in_progress").length,
        hold: incomplete.filter((row) => row.status === "hold").length,
        unregistered: incomplete.filter((row) => row.status === "unregistered").length,
        total: scoped.length,
        completed: done.length,
        completionRate: scoped.length ? Math.round(done.length / scoped.length * 100) : 0,
        averageDays: average(durations),
        overdue: incomplete.filter((row) => elapsedDays(row.meetingDate, today) >= overdueDays).length,
        overdueDays,
      },
      weekly,
      departmentStatus,
      attention,
    });
  });
