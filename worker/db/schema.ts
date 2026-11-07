/**
 * 업무트래커 D1 스키마 (Drizzle ORM)
 *
 * 규칙
 * - 일시(timestamp)는 UTC epoch milliseconds(integer), 날짜는 KST 기준 'YYYY-MM-DD'(text)
 * - 주차는 ISO 주차를 정수 yearWeek(예: 202642)로 저장
 * - 본문은 편집기 JSON(text) + 검색용 평문(text)을 함께 저장
 * - 삭제 대신 is_active / status 로 보존
 */
import { sql } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

const now = sql`(unixepoch('subsec') * 1000)`;
const timestamps = {
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
};
const bool = (name: string) => integer(name, { mode: "boolean" });

/* ───────────────────────── 조직 · 사원 · 인증 ───────────────────────── */

/** 부서(팀). 주간보고 팀 = 액션 부서 */
export const departments = sqliteTable("departments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code").notNull().unique(), // T01
  name: text("name").notNull().unique(),
  leaderId: integer("leader_id"),
  sortOrder: integer("sort_order").notNull().default(0),
  isActive: bool("is_active").notNull().default(true),
  ...timestamps,
});

/** 사원 */
export const employees = sqliteTable(
  "employees",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    empNo: text("emp_no").notNull().unique(),
    loginId: text("login_id").notNull().unique(),
    name: text("name").notNull(),
    departmentId: integer("department_id").references(() => departments.id),
    position: text("position").notNull().default(""), // 직급
    role: text("role", { enum: ["member", "leader", "executive"] }).notNull().default("member"),
    isClerk: bool("is_clerk").notNull().default(false), // 회의 서기
    isAdmin: bool("is_admin").notNull().default(false), // 시스템 관리자
    status: text("status", { enum: ["active", "pending", "inactive"] }).notNull().default("pending"),
    passwordHash: text("password_hash").notNull(), // pbkdf2$<iter>$<saltB64>$<hashB64>
    mustChangePassword: bool("must_change_password").notNull().default(true),
    failedLoginCount: integer("failed_login_count").notNull().default(0),
    lockedUntil: integer("locked_until"),
    lastLoginAt: integer("last_login_at"),
    passwordChangedAt: integer("password_changed_at"),
    ...timestamps,
  },
  (t) => [index("idx_employees_department").on(t.departmentId)],
);

/** 로그인 세션. id = 토큰의 SHA-256 해시 (원문 토큰은 쿠키에만 존재) */
export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    employeeId: integer("employee_id").notNull().references(() => employees.id),
    createdAt: integer("created_at").notNull().default(now),
    lastSeenAt: integer("last_seen_at").notNull().default(now),
    expiresAt: integer("expires_at").notNull(),
    ip: text("ip"),
    userAgent: text("user_agent"),
  },
  (t) => [index("idx_sessions_employee").on(t.employeeId)],
);

/* ───────────────────────── 마스터 · 설정 ───────────────────────── */

/** 운영 설정 (key → JSON value) */
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().default(now),
  updatedBy: integer("updated_by"),
});

/** 공통코드 (MEETING_TYPE 등 관리자가 관리하는 코드) */
export const codes = sqliteTable(
  "codes",
  {
    groupCode: text("group_code").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: bool("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [primaryKey({ columns: [t.groupCode, t.code] })],
);

/** 채번 시퀀스 (AC-2026, MT-20261012 등) */
export const sequences = sqliteTable("sequences", {
  name: text("name").primaryKey(),
  value: integer("value").notNull().default(0),
});

/** 구분: KPI / 일반 / 출장 및 휴가(시스템 고정) */
export const reportCategories = sqliteTable("report_categories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  code: text("code", { enum: ["KPI", "GENERAL", "TRAVEL"] }).notNull().unique(),
  name: text("name").notNull(),
  sortOrder: integer("sort_order").notNull().default(0),
  isSystem: bool("is_system").notNull().default(false),
  ...timestamps,
});

/** 세부내용 (팀별 업무 대분류) */
export const reportDetails = sqliteTable(
  "report_details",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    departmentId: integer("department_id").notNull().references(() => departments.id),
    categoryId: integer("category_id").notNull().references(() => reportCategories.id),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: bool("is_active").notNull().default(true),
    ...timestamps,
  },
  (t) => [
    index("idx_report_details_dept").on(t.departmentId, t.categoryId, t.sortOrder),
    uniqueIndex("uq_report_details_name").on(t.departmentId, t.categoryId, t.name),
  ],
);

/* ───────────────────────── 주간업무보고 ───────────────────────── */

/** 팀 주간보고 (팀 × 주차 1건) */
export const weeklyReports = sqliteTable(
  "weekly_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    departmentId: integer("department_id").notNull().references(() => departments.id),
    yearWeek: integer("year_week").notNull(), // 202642
    status: text("status", { enum: ["draft", "submitted", "late", "confirmed"] })
      .notNull()
      .default("draft"),
    submittedAt: integer("submitted_at"),
    submittedBy: integer("submitted_by"),
    confirmedAt: integer("confirmed_at"),
    confirmedBy: integer("confirmed_by"),
    ...timestamps,
  },
  (t) => [uniqueIndex("uq_weekly_reports").on(t.departmentId, t.yearWeek)],
);

/** 팀원 '내 작성 완료' 표시 */
export const reportMemberCompletions = sqliteTable(
  "report_member_completions",
  {
    reportId: integer("report_id").notNull().references(() => weeklyReports.id),
    employeeId: integer("employee_id").notNull().references(() => employees.id),
    completedAt: integer("completed_at").notNull().default(now),
  },
  (t) => [primaryKey({ columns: [t.reportId, t.employeeId] })],
);

/** 타이틀 (여러 주에 걸쳐 유지되는 업무 단위) */
export const reportTitles = sqliteTable(
  "report_titles",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    departmentId: integer("department_id").notNull().references(() => departments.id),
    detailId: integer("detail_id").notNull().references(() => reportDetails.id),
    number: integer("number"),
    name: text("name").notNull(),
    ownerId: integer("owner_id").notNull().references(() => employees.id),
    startYearWeek: integer("start_year_week").notNull(),
    endYearWeek: integer("end_year_week"), // ○완료 / X중단 시 종료 주차
    resumeYearWeek: integer("resume_year_week"), // △보류 업무가 다시 표시될 ISO 주차
    hiddenOnHold: bool("hidden_on_hold").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: integer("created_by").notNull(),
    ...timestamps,
  },
  (t) => [index("idx_report_titles_detail").on(t.detailId, t.sortOrder)],
);

/** 주간 기록 (타이틀 × 주차). 동시 편집 저장 단위, version 으로 낙관적 잠금 */
export const titleWeekEntries = sqliteTable(
  "title_week_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    titleId: integer("title_id").notNull().references(() => reportTitles.id),
    reportId: integer("report_id").notNull().references(() => weeklyReports.id),
    yearWeek: integer("year_week").notNull(),
    detailId: integer("detail_id").notNull(), // 해당 주차 기준 세부내용 (이동 이력 보존)
    ownerId: integer("owner_id").notNull(), // 해당 주차 기준 담당자
    thisWeekBody: text("this_week_body"), // 편집기 JSON
    thisWeekText: text("this_week_text"),
    performSchedule: text("perform_schedule"), // {type, dates[]}
    result: text("result", { enum: ["done", "continue", "stopped", "hold"] }),
    nextPlanBody: text("next_plan_body"),
    nextPlanText: text("next_plan_text"),
    dueSchedule: text("due_schedule"),
    carriedOver: bool("carried_over").notNull().default(false), // 지난주 차주계획에서 불러옴
    version: integer("version").notNull().default(1),
    updatedBy: integer("updated_by"),
    ...timestamps,
  },
  (t) => [
    uniqueIndex("uq_title_week").on(t.titleId, t.yearWeek),
    index("idx_entries_report").on(t.reportId),
  ],
);

/** 임원 결정 요청 */
export const decisionRequests = sqliteTable(
  "decision_requests",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    entryId: integer("entry_id").notNull().references(() => titleWeekEntries.id),
    titleId: integer("title_id").notNull().references(() => reportTitles.id),
    departmentId: integer("department_id").notNull().references(() => departments.id),
    content: text("content").notNull(),
    desiredDate: text("desired_date"),
    status: text("status", { enum: ["pending", "approved", "rejected", "held"] })
      .notNull()
      .default("pending"),
    requestedBy: integer("requested_by").notNull(),
    requestedAt: integer("requested_at").notNull().default(now),
    decidedBy: integer("decided_by"),
    decidedAt: integer("decided_at"),
    comment: text("comment"),
  },
  (t) => [index("idx_decisions_status").on(t.status)],
);

/** 출장 · 휴가 */
export const attendances = sqliteTable(
  "attendances",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull().references(() => employees.id),
    type: text("type", { enum: ["trip", "leave"] }).notNull(),
    startDate: text("start_date").notNull(),
    endDate: text("end_date").notNull(),
    note: text("note"),
    createdBy: integer("created_by").notNull(),
    ...timestamps,
  },
  (t) => [index("idx_attendances_period").on(t.startDate, t.endDate)],
);

/* ───────────────────────── 회의 · 액션 ───────────────────────── */

/** 회의록 (전사 단위) */
export const meetings = sqliteTable(
  "meetings",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    displayNo: text("display_no").unique(), // MT-20261012-01 (등록 시 채번)
    typeCode: text("type_code").notNull(), // codes.MEETING_TYPE
    meetingDate: text("meeting_date").notNull(),
    timePlace: text("time_place"),
    chair: text("chair"),
    body: text("body"),
    bodyText: text("body_text"),
    status: text("status", { enum: ["draft", "published"] }).notNull().default("draft"),
    clerkId: integer("clerk_id").notNull().references(() => employees.id),
    publishedAt: integer("published_at"),
    ...timestamps,
  },
  (t) => [index("idx_meetings_date").on(t.meetingDate)],
);

export const meetingAttendees = sqliteTable(
  "meeting_attendees",
  {
    meetingId: integer("meeting_id").notNull().references(() => meetings.id),
    employeeId: integer("employee_id").notNull().references(() => employees.id),
  },
  (t) => [primaryKey({ columns: [t.meetingId, t.employeeId] })],
);

/** 액션아이템 (지시사항) */
export const actionItems = sqliteTable(
  "action_items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    displayNo: text("display_no").notNull().unique(), // AC-2026-0037
    meetingId: integer("meeting_id").references(() => meetings.id),
    meetingTypeCode: text("meeting_type_code").notNull(),
    meetingDate: text("meeting_date").notNull(),
    departmentId: integer("department_id").notNull().references(() => departments.id),
    subject: text("subject").notNull(),
    request: text("request").notNull(),
    status: text("status", { enum: ["unregistered", "in_progress", "hold", "done"] })
      .notNull()
      .default("unregistered"),
    completedDate: text("completed_date"),
    isCompleted: bool("is_completed").notNull().default(false),
    latestProgressText: text("latest_progress_text"),
    latestProgressDate: text("latest_progress_date"),
    createdBy: integer("created_by").notNull(),
    ...timestamps,
  },
  (t) => [
    index("idx_actions_dept_status").on(t.departmentId, t.status),
    index("idx_actions_meeting_date").on(t.meetingDate),
  ],
);

/** 액션 진행 이력 */
export const actionProgress = sqliteTable(
  "action_progress",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actionId: integer("action_id").notNull().references(() => actionItems.id),
    progressDate: text("progress_date").notNull(),
    dueDate: text("due_date").notNull().default(""),
    status: text("status", { enum: ["in_progress", "hold", "done", "reopened"] }).notNull(),
    content: text("content").notNull(),
    authorId: integer("author_id").notNull().references(() => employees.id),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_progress_action").on(t.actionId)],
);

/* ───────────────────────── 공통 ───────────────────────── */

/** 첨부파일 (R2) */
export const attachments = sqliteTable(
  "attachments",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    ownerType: text("owner_type").notNull(), // entry | meeting | progress | ai
    ownerId: integer("owner_id"),
    r2Key: text("r2_key").notNull().unique(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    size: integer("size").notNull(),
    uploadedBy: integer("uploaded_by").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_attachments_owner").on(t.ownerType, t.ownerId)],
);

/** 시스템 내 알림 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recipientId: integer("recipient_id").notNull().references(() => employees.id),
    type: text("type").notNull(), // N01 ~ N09
    message: text("message").notNull(),
    link: text("link"),
    isRead: bool("is_read").notNull().default(false),
    dedupeKey: text("dedupe_key"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("idx_notifications_recipient").on(t.recipientId, t.isRead, t.createdAt),
    uniqueIndex("uq_notifications_dedupe").on(t.recipientId, t.dedupeKey),
  ],
);

/** 감사 로그 */
export const auditLogs = sqliteTable(
  "audit_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actorId: integer("actor_id"),
    action: text("action").notNull(), // auth.login, employee.update ...
    targetType: text("target_type"),
    targetId: text("target_id"),
    before: text("before"),
    after: text("after"),
    ip: text("ip"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("idx_audit_target").on(t.targetType, t.targetId),
    index("idx_audit_created").on(t.createdAt),
  ],
);

/** AI 대화 */
export const aiConversations = sqliteTable(
  "ai_conversations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull().references(() => employees.id),
    title: text("title").notNull(),
    ...timestamps,
  },
  (t) => [index("idx_ai_conv_employee").on(t.employeeId, t.updatedAt)],
);

export const aiMessages = sqliteTable(
  "ai_messages",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    conversationId: integer("conversation_id").notNull().references(() => aiConversations.id),
    role: text("role", { enum: ["user", "assistant"] }).notNull(),
    content: text("content").notNull(),
    sources: text("sources"), // JSON [{type, id, label, link}]
    contextText: text("context_text"), // 첨부 문서에서 추출한 후속 질문용 텍스트
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_ai_msg_conv").on(t.conversationId)],
);

export const aiMessageFeedback = sqliteTable(
  "ai_message_feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    messageId: integer("message_id").notNull().references(() => aiMessages.id),
    employeeId: integer("employee_id").notNull().references(() => employees.id),
    rating: text("rating", { enum: ["up", "down"] }).notNull(),
    ...timestamps,
  },
  (t) => [uniqueIndex("uq_ai_feedback_message_employee").on(t.messageId, t.employeeId)],
);

/** AI 호출 사용량 (채팅 · 추출 · 요약 공통 제한) */
export const aiUsageEvents = sqliteTable(
  "ai_usage_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    employeeId: integer("employee_id").notNull().references(() => employees.id),
    feature: text("feature").notNull(),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("idx_ai_usage_employee_created").on(t.employeeId, t.createdAt)],
);

export const aiSummaryCache = sqliteTable("ai_summary_cache", {
  key: text("key").primaryKey(),
  content: text("content").notNull(),
  sources: text("sources").notNull(),
  generatedAt: integer("generated_at").notNull(),
});

export const aiRiskNotifications = sqliteTable(
  "ai_risk_notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    actionId: integer("action_id").notNull().references(() => actionItems.id),
    recipientId: integer("recipient_id").notNull().references(() => employees.id),
    sentBy: integer("sent_by").notNull().references(() => employees.id),
    sentAt: integer("sent_at").notNull().default(now),
  },
  (t) => [index("idx_ai_risk_action_sent").on(t.actionId, t.sentAt)],
);
