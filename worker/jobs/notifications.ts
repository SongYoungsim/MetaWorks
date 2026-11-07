import { and, eq, inArray, lt, lte, ne } from "drizzle-orm";
import { addDays, formatYearWeekSlug, getIsoWeek, reportDeadlineEpoch } from "@shared/week";
import {
  actionItems,
  aiConversations,
  aiMessageFeedback,
  aiMessages,
  aiRiskNotifications,
  aiSummaryCache,
  aiUsageEvents,
  attachments,
  departments,
  employees,
  notifications,
  reportMemberCompletions,
  weeklyReports,
} from "../db/schema";
import type { Db } from "../env";
import { loadSettings } from "../lib/settings";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

export function kstClock(epochMs: number) {
  const shifted = new Date(epochMs + KST_OFFSET_MS);
  return {
    date: shifted.toISOString().slice(0, 10),
    weekday: shifted.getUTCDay() || 7,
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
  };
}

function timeMinutes(value: string) {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

async function createDeadlineReminders(db: Db, scheduledTime: number) {
  const clock = kstClock(scheduledTime);
  const settings = await loadSettings(db, ["report.reminderTime", "report.deadline"]);
  const reminder = settings["report.reminderTime"];
  if (clock.weekday !== reminder.weekday || clock.hour * 60 + clock.minute < timeMinutes(reminder.time)) return;

  const yearWeek = getIsoWeek(clock.date).yearWeek;
  const deadline = settings["report.deadline"];
  if (scheduledTime > reportDeadlineEpoch(yearWeek, deadline.weekday, deadline.time)) return;
  const [departmentRows, employeeRows, reportRows] = await Promise.all([
    db.select({ id: departments.id, code: departments.code }).from(departments)
      .where(eq(departments.isActive, true)),
    db.select({ id: employees.id, departmentId: employees.departmentId, role: employees.role })
      .from(employees).where(eq(employees.status, "active")),
    db.select({ id: weeklyReports.id, departmentId: weeklyReports.departmentId, status: weeklyReports.status })
      .from(weeklyReports).where(eq(weeklyReports.yearWeek, yearWeek)),
  ]);
  const reportIds = reportRows.map((report) => report.id);
  const completionRows = reportIds.length ? await db.select({
    reportId: reportMemberCompletions.reportId,
    employeeId: reportMemberCompletions.employeeId,
  }).from(reportMemberCompletions).where(inArray(reportMemberCompletions.reportId, reportIds)) : [];
  const departmentMap = new Map(departmentRows.map((department) => [department.id, department]));
  const reportMap = new Map(reportRows.map((report) => [report.departmentId, report]));
  const completed = new Set(completionRows.map((row) => `${row.reportId}:${row.employeeId}`));
  const recipientIds = new Set<number>();
  for (const employee of employeeRows) {
    if (!employee.departmentId || !departmentMap.has(employee.departmentId)) continue;
    const report = reportMap.get(employee.departmentId);
    if (employee.role === "member" && (!report || !completed.has(`${report.id}:${employee.id}`))) {
      recipientIds.add(employee.id);
    }
    if (employee.role === "leader" && (!report || report.status === "draft")) {
      recipientIds.add(employee.id);
    }
  }
  const week = yearWeek % 100;
  const values = [...recipientIds].flatMap((recipientId) => {
    const employee = employeeRows.find((item) => item.id === recipientId);
    const department = employee?.departmentId ? departmentMap.get(employee.departmentId) : null;
    if (!department) return [];
    return [{
      recipientId,
      type: "N01",
      message: `${week}주차 주간업무보고 마감이 ${deadline.time}입니다.`,
      link: `/reports/${department.code}/${formatYearWeekSlug(yearWeek)}`,
      dedupeKey: `report-reminder:${yearWeek}:${recipientId}`,
    }];
  });
  if (values.length) await db.insert(notifications).values(values).onConflictDoNothing();
}

async function createOverdueActionAlerts(db: Db, scheduledTime: number) {
  const clock = kstClock(scheduledTime);
  if (clock.hour !== 9) return;
  const settings = await loadSettings(db, ["action.overdueDays"]);
  const overdueDays = settings["action.overdueDays"];
  const threshold = addDays(clock.date, -overdueDays);
  const rows = await db.select({
    departmentId: actionItems.departmentId,
    leaderId: departments.leaderId,
  }).from(actionItems).innerJoin(departments, eq(actionItems.departmentId, departments.id))
    .where(and(
      ne(actionItems.status, "done"),
      lte(actionItems.meetingDate, threshold),
      eq(departments.isActive, true),
    ));
  const counts = new Map<number, { leaderId: number; count: number }>();
  for (const row of rows) {
    if (!row.leaderId) continue;
    const current = counts.get(row.departmentId);
    counts.set(row.departmentId, { leaderId: row.leaderId, count: (current?.count ?? 0) + 1 });
  }
  const values = [...counts].map(([departmentId, value]) => ({
    recipientId: value.leaderId,
    type: "N06",
    message: `지시 후 ${overdueDays}일이 지난 미완료 액션이 ${value.count}건 있습니다.`,
    link: `/actions/tracking?departmentId=${departmentId}&period=all&hideCompleted=true`,
    dedupeKey: `action-overdue:${clock.date}:${departmentId}:${value.leaderId}`,
  }));
  if (values.length) await db.insert(notifications).values(values).onConflictDoNothing();
}

async function cleanupExpiredAiData(db: Db, scheduledTime: number, files?: R2Bucket) {
  const clock = kstClock(scheduledTime);
  if (clock.hour !== 3) return;
  const retentionCutoff = scheduledTime - 90 * 24 * 60 * 60 * 1000;
  const cacheCutoff = scheduledTime - 7 * 24 * 60 * 60 * 1000;
  const expiredConversations = await db.select({ id: aiConversations.id }).from(aiConversations)
    .where(lt(aiConversations.updatedAt, retentionCutoff));
  const conversationIds = expiredConversations.map((item) => item.id);
  if (conversationIds.length) {
    const expiredMessages = await db.select({ id: aiMessages.id }).from(aiMessages)
      .where(inArray(aiMessages.conversationId, conversationIds));
    const messageIds = expiredMessages.map((item) => item.id);
    const expiredFiles = messageIds.length ? await db.select({ id: attachments.id, r2Key: attachments.r2Key }).from(attachments)
      .where(and(eq(attachments.ownerType, "ai"), inArray(attachments.ownerId, messageIds))) : [];
    if (files) await Promise.all(expiredFiles.map((file) => files.delete(file.r2Key)));
    if (expiredFiles.length) await db.delete(attachments).where(inArray(attachments.id, expiredFiles.map((file) => file.id)));
    if (messageIds.length) await db.delete(aiMessageFeedback).where(inArray(aiMessageFeedback.messageId, messageIds));
    await db.delete(aiMessages).where(inArray(aiMessages.conversationId, conversationIds));
    await db.delete(aiConversations).where(inArray(aiConversations.id, conversationIds));
  }
  await Promise.all([
    db.delete(aiUsageEvents).where(lt(aiUsageEvents.createdAt, retentionCutoff)),
    db.delete(aiRiskNotifications).where(lt(aiRiskNotifications.sentAt, retentionCutoff)),
    db.delete(aiSummaryCache).where(lt(aiSummaryCache.generatedAt, cacheCutoff)),
  ]);
}

export async function runAutomatedNotifications(db: Db, scheduledTime: number = Date.now(), files?: R2Bucket) {
  await Promise.all([
    createDeadlineReminders(db, scheduledTime),
    createOverdueActionAlerts(db, scheduledTime),
    cleanupExpiredAiData(db, scheduledTime, files),
  ]);
}
