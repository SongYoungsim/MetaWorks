/**
 * 프론트 · API 공용 타입과 코드값 라벨
 */
export type Role = "member" | "leader" | "executive";
export type EmployeeStatus = "active" | "pending" | "inactive";

export const ROLE_LABEL: Record<Role, string> = {
  member: "팀원",
  leader: "팀장",
  executive: "임원",
};

export const EMPLOYEE_STATUS_LABEL: Record<EmployeeStatus, string> = {
  active: "재직",
  pending: "첫 로그인 대기",
  inactive: "비활성",
};

/** GET /api/auth/me 응답 */
export interface SessionUser {
  id: number;
  loginId: string;
  name: string;
  role: Role;
  position: string;
  isClerk: boolean;
  isAdmin: boolean;
  status: EmployeeStatus;
  mustChangePassword: boolean;
  department: { id: number; code: string; name: string } | null;
}

/** API 오류 응답 형식 */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
    /** 로그인 실패 시 남은 시도 횟수 */
    remainingAttempts?: number;
    /** 잠금 해제까지 남은 분 */
    lockedMinutes?: number;
    fields?: Record<string, string>;
  };
}

export interface LoginRequest {
  loginId: string;
  password: string;
}

export interface ChangePasswordRequest {
  currentPassword?: string;
  newPassword: string;
}

export interface PublicSettings {
  passwordMinLength: number;
  passwordRequireSpecial: boolean;
  loginMaxFailures: number;
  loginLockMinutes: number;
}

export interface DepartmentOption {
  id: number;
  code: string;
  name: string;
  leaderId: number | null;
  isActive: boolean;
}

export interface EmployeeAdminItem {
  id: number;
  empNo: string;
  loginId: string;
  name: string;
  departmentId: number | null;
  departmentName: string | null;
  position: string;
  role: Role;
  isClerk: boolean;
  isAdmin: boolean;
  status: EmployeeStatus;
  mustChangePassword: boolean;
  lastLoginAt: number | null;
  passwordChangedAt: number | null;
}

export interface EmployeeListResponse {
  employees: EmployeeAdminItem[];
  departments: DepartmentOption[];
}

export interface EmployeeCreateRequest {
  name: string;
  loginId: string;
  empNo: string;
  departmentId: number | null;
  position: string;
  role: Role;
  isClerk: boolean;
  isAdmin: boolean;
  replaceLeader?: boolean;
}

export interface EmployeeBulkCreateItem extends EmployeeCreateRequest {
  initialPassword: string;
}

export interface EmployeeUpdateRequest {
  name: string;
  departmentId: number | null;
  position: string;
  role: Role;
  isClerk: boolean;
  isAdmin: boolean;
  status: EmployeeStatus;
  replaceLeader?: boolean;
}

export interface EmployeeCredentialResult {
  employee: EmployeeAdminItem;
  temporaryPassword: string;
}

export interface EmployeeBulkCreateRequest {
  items: EmployeeBulkCreateItem[];
}

export interface EmployeeBulkCreateResponse {
  credentials: EmployeeCredentialResult[];
}

export interface MasterEmployeeOption {
  id: number;
  name: string;
  departmentId: number | null;
  role: Role;
  status: EmployeeStatus;
}

export interface MasterDepartment {
  id: number;
  code: string;
  name: string;
  leaderId: number | null;
  leaderName: string | null;
  sortOrder: number;
  isActive: boolean;
  employeeCount: number;
  actionCount: number;
}

export interface MasterCategory {
  id: number;
  code: "KPI" | "GENERAL" | "TRAVEL";
  name: string;
  sortOrder: number;
  isSystem: boolean;
}

export interface MasterReportDetail {
  id: number;
  departmentId: number;
  categoryId: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  titleCount: number;
}

export interface MasterReportTitle {
  id: number;
  detailId: number;
  departmentCode: string;
  number: number | null;
  name: string;
  ownerName: string;
  startYearWeek: number;
  endYearWeek: number | null;
  hiddenOnHold: boolean;
  latestYearWeek: number;
  latestResult: WeeklyEntryResult | null;
  latestReportStatus: WeeklyReportStatus;
}

export interface MasterMeetingType {
  code: string;
  name: string;
  sortOrder: number;
  isActive: boolean;
  usageCount: number;
}

export interface MasterSettings {
  reportDeadlineWeekday: number;
  reportDeadlineTime: string;
  reportReminderWeekday: number;
  reportReminderTime: string;
  actionOverdueDays: number;
  passwordMinLength: number;
  passwordRequireSpecial: boolean;
  loginMaxFailures: number;
  loginLockMinutes: number;
  sessionIdleHours: number;
  aiDailyLimit: number;
}

export interface MasterDataResponse {
  departments: MasterDepartment[];
  categories: MasterCategory[];
  reportDetails: MasterReportDetail[];
  reportTitles: MasterReportTitle[];
  meetingTypes: MasterMeetingType[];
  employees: MasterEmployeeOption[];
  settings: MasterSettings;
}

export type MeetingStatus = "draft" | "published";

export interface MeetingTypeOption {
  code: string;
  name: string;
}

export interface MeetingEmployeeOption {
  id: number;
  name: string;
  position: string;
  departmentId: number | null;
  departmentName: string | null;
}

export interface MeetingOptionsResponse {
  meetingTypes: MeetingTypeOption[];
  employees: MeetingEmployeeOption[];
  departments: Array<{ id: number; name: string }>;
  canCreate: boolean;
}

export interface MeetingListItem {
  id: number;
  displayNo: string | null;
  typeCode: string;
  typeName: string;
  meetingDate: string;
  timePlace: string | null;
  chair: string;
  clerkName: string;
  status: MeetingStatus;
  actionCount: number;
  updatedAt: number;
}

export interface MeetingListResponse {
  items: MeetingListItem[];
  meetingTypes: MeetingTypeOption[];
  canCreate: boolean;
}

export interface MeetingDetailResponse extends MeetingListItem {
  body: string | null;
  bodyText: string | null;
  clerkId: number;
  clerkDepartmentName: string | null;
  attendees: MeetingEmployeeOption[];
  attachments: MeetingAttachment[];
  linkedActions: MeetingLinkedAction[];
  publishedAt: number | null;
  createdAt: number;
  canEdit: boolean;
  canDelete: boolean;
  deleteBlockReason: string | null;
}

export interface MeetingLinkedAction {
  id: number;
  displayNo: string;
  departmentName: string;
  subject: string;
  request: string;
  status: "unregistered" | "in_progress" | "hold" | "done";
  latestProgressText: string | null;
  completedDate: string | null;
}

export interface MeetingAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
  createdAt: number;
}

export interface MeetingWriteRequest {
  typeCode: string;
  meetingDate: string;
  timePlace: string;
  chair: string;
  attendeeIds: number[];
  body: unknown | null;
  bodyText: string;
  intent: "draft" | "publish";
}

export type ActionStatus = "unregistered" | "in_progress" | "hold" | "done";

export interface ActionMeetingOption {
  id: number;
  displayNo: string;
  typeCode: string;
  typeName: string;
  meetingDate: string;
  timePlace: string | null;
  chair: string;
  bodyText: string | null;
}

export interface ActionRegisterOptionsResponse {
  meetings: ActionMeetingOption[];
  meetingTypes: MeetingTypeOption[];
  departments: DepartmentOption[];
  canEdit: boolean;
}

export interface ActionItemRecord {
  id: number;
  displayNo: string;
  meetingId: number | null;
  meetingTypeCode: string;
  meetingTypeName: string;
  meetingDate: string;
  departmentId: number;
  departmentName: string;
  subject: string;
  request: string;
  status: ActionStatus;
  progressCount: number;
  createdAt: number;
}

export interface ActionListResponse {
  items: ActionItemRecord[];
  canEdit: boolean;
}

export interface ActionWriteItem {
  meetingId: number | null;
  meetingTypeCode: string;
  meetingDate: string;
  departmentId: number;
  subject: string;
  request: string;
}

export interface ActionTrackingItem {
  id: number;
  displayNo: string;
  meetingId: number | null;
  meetingTypeCode: string;
  meetingTypeName: string;
  meetingDate: string;
  departmentId: number;
  departmentName: string;
  subject: string;
  request: string;
  status: ActionStatus;
  latestProgressText: string | null;
  latestProgressDate: string | null;
  completedDate: string | null;
  isCompleted: boolean;
  canUpdate: boolean;
}

export interface ActionTrackingResponse {
  items: ActionTrackingItem[];
  departments: DepartmentOption[];
  summary: {
    total: number;
    unregistered: number;
    inProgress: number;
    hold: number;
    done: number;
    latestProgressDate: string | null;
  };
}

export type ActionProgressStatus = "in_progress" | "hold" | "done" | "reopened";

export interface ActionProgressAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface ActionProgressRecord {
  id: number;
  progressDate: string;
  dueDate: string;
  status: ActionProgressStatus;
  content: string;
  authorId: number;
  authorName: string;
  createdAt: number;
  attachments: ActionProgressAttachment[];
}

export interface ActionTrackingDetailResponse {
  actionId: number;
  meetingDate: string;
  status: ActionStatus;
  canUpdate: boolean;
  history: ActionProgressRecord[];
}

export interface NotificationItem {
  id: number;
  type: string;
  message: string;
  link: string | null;
  isRead: boolean;
  createdAt: number;
}

export interface NotificationListResponse {
  items: NotificationItem[];
  unreadCount: number;
  nextCursor: number | null;
}

export interface DashboardResponse {
  departments: DepartmentOption[];
  currentYearWeek: number;
  week: { monday: string; friday: string };
  scope: { type: "all" | "team"; departmentId: number | null; departmentName: string | null };
  summary: {
    newActions: number;
    incomplete: number;
    inProgress: number;
    hold: number;
    unregistered: number;
    total: number;
    completed: number;
    completionRate: number;
    averageDays: number;
    overdue: number;
    overdueDays: number;
  };
  weekly: Array<{
    yearWeek: number;
    label: string;
    monday: string;
    friday: string;
    registered: number;
    completed: number;
    current: boolean;
  }>;
  departmentStatus: Array<{
    id: number;
    name: string;
    total: number;
    unregistered: number;
    inProgress: number;
    hold: number;
    done: number;
    completionRate: number;
    averageDays: number;
    overdue: number;
  }>;
  attention: Array<{
    id: number;
    departmentId: number;
    departmentName: string;
    subject: string;
    meetingDate: string;
    status: ActionStatus;
    elapsedDays: number;
  }>;
}

export type WeeklyReportStatus = "draft" | "submitted" | "late" | "confirmed";
export type WeeklyEntryResult = "done" | "continue" | "stopped" | "hold";
export type DecisionStatus = "pending" | "approved" | "rejected" | "held";
export type WeeklyScheduleType = "single" | "multiple" | "range" | "deadline";

export interface WeeklyScheduleInput {
  type: WeeklyScheduleType;
  dates: string[];
}

export interface WeeklyTitleCreateRequest {
  detailId: number;
  ownerId: number;
  title: string;
}

export interface WeeklyTitleUpdateRequest {
  reportId: number;
  title: string;
}

export interface WeeklyEntryUpdateRequest {
  version: number;
  thisWeekBody: unknown | null;
  thisWeekText: string | null;
  performSchedule: WeeklyScheduleInput | null;
  result: WeeklyEntryResult | null;
  hideOnHold: boolean;
  nextPlanBody: unknown | null;
  nextPlanText: string | null;
  dueSchedule: WeeklyScheduleInput | null;
}

export interface WeeklyDecision {
  id: number;
  content: string;
  desiredDate: string | null;
  status: DecisionStatus;
  comment: string | null;
  requestedAt: number;
  decidedAt: number | null;
}

export type AttendanceType = "trip" | "leave";

export interface WeeklyAttendance {
  id: number;
  employeeId: number;
  employeeName: string;
  type: AttendanceType;
  startDate: string;
  endDate: string;
  note: string | null;
  canEdit: boolean;
}

export interface AttendanceWriteRequest {
  employeeId: number;
  type: AttendanceType;
  startDate: string;
  endDate: string;
  note: string;
}

export interface WeeklyTitleManageRequest {
  reportId: number;
  ownerId: number;
  detailId: number;
  direction?: "up" | "down";
}

export interface WeeklyTitleHistoryItem {
  id: number;
  yearWeek: number;
  status: WeeklyReportStatus;
  thisWeekText: string | null;
  result: WeeklyEntryResult | null;
  nextPlanText: string | null;
  updatedAt: number;
}

export interface WeeklyTitleHistoryResponse {
  title: { id: number; number: number | null; name: string };
  items: WeeklyTitleHistoryItem[];
  canDelete: boolean;
  deleteBlockReason: string | null;
}

export interface WeeklyReportEmployee {
  id: number;
  name: string;
  position: string;
  role: Role;
  isCompleted: boolean;
}

export interface WeeklyReportEntry {
  id: number;
  titleId: number;
  reportId: number;
  detailId: number;
  ownerId: number;
  number: number | null;
  title: string;
  sortOrder: number;
  startYearWeek: number;
  endYearWeek: number | null;
  hiddenOnHold: boolean;
  thisWeekBody: string | null;
  thisWeekText: string | null;
  performSchedule: string | null;
  result: WeeklyEntryResult | null;
  nextPlanBody: string | null;
  nextPlanText: string | null;
  dueSchedule: string | null;
  carriedOver: boolean;
  decisionRequired: boolean;
  decision: WeeklyDecision | null;
  version: number;
  updatedAt: number;
  ownerName: string;
}

export interface WeeklyReportDetailGroup {
  id: number;
  name: string;
  sortOrder: number;
  isActive: boolean;
  category: {
    id: number;
    code: "KPI" | "GENERAL" | "TRAVEL";
    name: string;
    sortOrder: number;
  };
  entries: WeeklyReportEntry[];
}

export interface WeeklyReportSummary {
  completedMembers: number;
  totalMembers: number;
  totalTitles: number;
  continued: number;
  completed: number;
  held: number;
  stopped: number;
  newTitles: number;
  pendingDecisions: number;
}

export interface WeeklyHiddenHold {
  titleId: number;
  number: number | null;
  title: string;
  ownerId: number;
  ownerName: string;
  heldYearWeek: number;
  nextPlanText: string | null;
  canResume: boolean;
}

export interface WeeklyReportResponse {
  exists: boolean;
  report: {
    id: number;
    status: WeeklyReportStatus;
    submittedAt: number | null;
    confirmedAt: number | null;
    createdAt: number;
  } | null;
  department: { id: number; code: string; name: string };
  yearWeek: number;
  week: {
    monday: string;
    friday: string;
    nextMonday: string;
    nextFriday: string;
  };
  deadlineAt: number;
  permissions: {
    readOnly: boolean;
    canEditOwn: boolean;
    canEditTeam: boolean;
    canSubmit: boolean;
    canRecall: boolean;
    canConfirm: boolean;
    canResolveDecisions: boolean;
  };
  members: WeeklyReportEmployee[];
  details: WeeklyReportDetailGroup[];
  attendances: WeeklyAttendance[];
  hiddenHolds: WeeklyHiddenHold[];
  summary: WeeklyReportSummary;
}

export interface WeeklyReportOptionsResponse {
  departments: Array<{ id: number; code: string; name: string }>;
  currentYearWeek: number;
  maximumYearWeek: number;
}

export type AiScope = "all" | "team";
export type AiPeriod = "4" | "8" | "12" | "all";

export interface AiSource {
  type: "report" | "meeting" | "action" | "file";
  id: number;
  label: string;
  link: string;
}

export interface AiAttachment {
  id: number;
  fileName: string;
  mimeType: string;
  size: number;
  url: string;
}

export interface AiMessageItem {
  id: number;
  role: "user" | "assistant";
  content: string;
  sources: AiSource[];
  attachments: AiAttachment[];
  feedback: "up" | "down" | null;
  createdAt: number;
}

export interface AiConversationSummary {
  id: number;
  title: string;
  createdAt: number;
  updatedAt: number;
}

export interface AiConversationDetail extends AiConversationSummary {
  messages: AiMessageItem[];
}

export interface AiChatRequest {
  conversationId?: number;
  question: string;
  scope: AiScope;
  period: AiPeriod;
}

export interface AiChatResponse {
  conversation: AiConversationSummary;
  userMessage: AiMessageItem;
  assistantMessage: AiMessageItem;
}

export interface AiActionCandidate {
  departmentId: number;
  departmentName: string;
  subject: string;
  request: string;
  duplicateWarning: boolean;
}

export interface AiActionExtractionResponse {
  meetingId: number;
  candidates: AiActionCandidate[];
}

export interface AiWeeklySummaryResponse {
  content: string;
  sources: AiSource[];
  generatedAt: number;
  cached: boolean;
}

export interface AiRiskItem {
  id: number;
  departmentId: number;
  departmentName: string;
  subject: string;
  status: ActionStatus;
  meetingDate: string;
  elapsedDays: number;
  reasons: string[];
  link: string;
}

export interface AiRiskGroup {
  departmentId: number;
  departmentName: string;
  hasLeader: boolean;
  items: AiRiskItem[];
}

export interface AiRiskReviewResponse {
  total: number;
  overdueDays: number;
  canNotify: boolean;
  groups: AiRiskGroup[];
}

export interface AiRiskNotifyResponse {
  sentDepartments: number;
  sentActions: number;
  skippedActions: number;
}
