import { describe, expect, it } from "vitest";
import { getReportPermissions, getSubmissionStatus, shouldCarryWeeklyEntry, splitReportTitleInput } from "./report";

describe("보고서 타이틀 입력", () => {
  it("앞의 숫자와 점을 번호로 분리한다", () => {
    expect(splitReportTitleInput("13. 신규 채용")).toEqual({ number: 13, name: "신규 채용" });
    expect(splitReportTitleInput("7.공시 준비")).toEqual({ number: 7, name: "공시 준비" });
  });

  it("번호가 없거나 이름이 비면 전체를 이름으로 유지한다", () => {
    expect(splitReportTitleInput("정기 업무")).toEqual({ number: null, name: "정기 업무" });
    expect(splitReportTitleInput("12.")).toEqual({ number: null, name: "12." });
  });
});

describe("주간업무보고 이월", () => {
  it("계속·보류·결과 미입력 타이틀을 이월한다", () => {
    expect(shouldCarryWeeklyEntry("continue", null, 202642)).toBe(true);
    expect(shouldCarryWeeklyEntry("hold", null, 202642)).toBe(true);
    expect(shouldCarryWeeklyEntry(null, null, 202642)).toBe(true);
  });

  it("숨기기를 선택한 보류 업무만 다음 주차에서 제외한다", () => {
    expect(shouldCarryWeeklyEntry("hold", null, 202642, true)).toBe(false);
    expect(shouldCarryWeeklyEntry("hold", null, 202642, false)).toBe(true);
  });

  it("완료·중단·이미 종료된 타이틀을 이월하지 않는다", () => {
    expect(shouldCarryWeeklyEntry("done", 202641, 202642)).toBe(false);
    expect(shouldCarryWeeklyEntry("stopped", 202641, 202642)).toBe(false);
    expect(shouldCarryWeeklyEntry("continue", 202641, 202642)).toBe(false);
  });
});

describe("주간업무보고 권한", () => {
  it("팀원은 초안 상태의 본인 팀 타이틀만 편집한다", () => {
    expect(getReportPermissions({
      role: "member", userDepartmentId: 1, reportDepartmentId: 1, status: "draft",
    })).toEqual({
      readOnly: false,
      canEditOwn: true,
      canEditTeam: false,
      canSubmit: false,
      canRecall: false,
      canConfirm: false,
      canResolveDecisions: false,
    });
  });

  it("팀장은 팀 전체 편집과 제출이 가능하다", () => {
    const permission = getReportPermissions({
      role: "leader", userDepartmentId: 1, reportDepartmentId: 1, status: "draft",
    });
    expect(permission.canEditTeam).toBe(true);
    expect(permission.canSubmit).toBe(true);
    expect(permission.canRecall).toBe(false);
  });

  it("타 팀과 제출된 보고서는 열람 전용이다", () => {
    expect(getReportPermissions({
      role: "leader", userDepartmentId: 1, reportDepartmentId: 2, status: "draft",
    }).readOnly).toBe(true);
    expect(getReportPermissions({
      role: "member", userDepartmentId: 1, reportDepartmentId: 1, status: "submitted",
    }).readOnly).toBe(true);
  });

  it("임원은 제출 또는 지연 제출 보고서를 확인할 수 있다", () => {
    expect(getReportPermissions({
      role: "executive", userDepartmentId: null, reportDepartmentId: 1, status: "submitted",
    }).canConfirm).toBe(true);
    expect(getReportPermissions({
      role: "leader", userDepartmentId: 1, reportDepartmentId: 1, status: "submitted",
    }).canRecall).toBe(true);
    expect(getReportPermissions({
      role: "executive", userDepartmentId: null, reportDepartmentId: 1, status: "draft",
    }).canResolveDecisions).toBe(true);
    expect(getReportPermissions({
      role: "executive", userDepartmentId: null, reportDepartmentId: 1, status: "draft",
    }).canConfirm).toBe(false);
  });
});

describe("보고서 제출 상태", () => {
  it("마감 시각까지는 제출, 이후에는 지연 제출로 판정한다", () => {
    expect(getSubmissionStatus(1_000, 1_000)).toBe("submitted");
    expect(getSubmissionStatus(1_000, 1_001)).toBe("late");
  });
});
