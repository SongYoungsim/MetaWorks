import type { Role, WeeklyEntryResult, WeeklyReportStatus } from "./types";

/** "13. 타이틀" 입력에서 번호를 분리한다. 번호가 없으면 서버가 자동 채번한다. */
export function splitReportTitleInput(value: string): { number: number | null; name: string } {
  const trimmed = value.trim();
  const dotIndex = trimmed.indexOf(".");
  const prefix = dotIndex > 0 ? trimmed.slice(0, dotIndex) : "";
  const isNumber = prefix.length > 0
    && [...prefix].every((character) => character >= "0" && character <= "9");
  if (isNumber) {
    const name = trimmed.slice(dotIndex + 1).trim();
    if (name) return { number: Number(prefix), name };
  }
  return { number: null, name: trimmed };
}

export function getSubmissionStatus(deadlineAt: number, now: number = Date.now()): "submitted" | "late" {
  return now > deadlineAt ? "late" : "submitted";
}

/** 최종 명세: 계속·보류뿐 아니라 결과 미입력도 계속으로 간주해 이월한다. */
export function shouldCarryWeeklyEntry(
  result: WeeklyEntryResult | null,
  endYearWeek: number | null,
  targetYearWeek: number,
  hiddenOnHold: boolean = false,
): boolean {
  const continues = result === null || result === "continue" || result === "hold";
  const remainsOpen = endYearWeek === null || endYearWeek >= targetYearWeek;
  const visible = result !== "hold" || !hiddenOnHold;
  return continues && remainsOpen && visible;
}

export interface ReportPermissionInput {
  role: Role;
  userDepartmentId: number | null;
  reportDepartmentId: number;
  status: WeeklyReportStatus | "missing";
}

export function getReportPermissions(input: ReportPermissionInput) {
  const sameDepartment = input.userDepartmentId === input.reportDepartmentId;
  const unlocked = input.status === "draft";
  return {
    readOnly: !sameDepartment || !unlocked || input.role === "executive",
    canEditOwn: sameDepartment && unlocked && (input.role === "member" || input.role === "leader"),
    canEditTeam: sameDepartment && unlocked && input.role === "leader",
    canSubmit: sameDepartment && unlocked && input.role === "leader",
    canRecall:
      sameDepartment && input.role === "leader" &&
      (input.status === "submitted" || input.status === "late"),
    canConfirm:
      input.role === "executive" &&
      (input.status === "submitted" || input.status === "late"),
    canResolveDecisions: input.role === "executive",
  };
}
