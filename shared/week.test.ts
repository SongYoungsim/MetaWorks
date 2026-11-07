import { describe, expect, it } from "vitest";
import {
  addDays,
  canOpenYearWeek,
  clipDateRange,
  formatYearWeekSlug,
  formatMdWithDay,
  getDeadlineInfo,
  getIsoWeek,
  getIsoWeekRange,
  isValidYearWeek,
  kstDateTimeToEpoch,
  mondayOfIsoWeek,
  parseYearWeekSlug,
  reportDeadlineEpoch,
  shiftYearWeek,
  weeksInIsoYear,
} from "./week";

describe("기간 주차 분할", () => {
  it("주 경계를 넘는 기간을 조회 구간에 맞게 자른다", () => {
    expect(clipDateRange("2026-10-15", "2026-10-20", "2026-10-12", "2026-10-16"))
      .toEqual({ startDate: "2026-10-15", endDate: "2026-10-16" });
    expect(clipDateRange("2026-10-15", "2026-10-20", "2026-10-19", "2026-10-23"))
      .toEqual({ startDate: "2026-10-19", endDate: "2026-10-20" });
    expect(clipDateRange("2026-10-01", "2026-10-02", "2026-10-12", "2026-10-16"))
      .toBeNull();
  });
});

describe("ISO 주차 유틸", () => {
  it("기획 기준일을 2026년 42주차로 계산한다", () => {
    expect(getIsoWeek("2026-10-12")).toEqual({ year: 2026, week: 42, yearWeek: 202642 });
    expect(mondayOfIsoWeek(2026, 42)).toBe("2026-10-12");
  });

  it("연말과 연초의 ISO 주차 경계를 처리한다", () => {
    expect(getIsoWeek("2021-01-01")).toEqual({ year: 2020, week: 53, yearWeek: 202053 });
    expect(shiftYearWeek(202053, 1)).toBe(202101);
    expect(weeksInIsoYear(2020)).toBe(53);
    expect(weeksInIsoYear(2021)).toBe(52);
  });

  it("날짜 덧셈과 한국어 요일 표시를 처리한다", () => {
    expect(addDays("2026-10-16", 3)).toBe("2026-10-19");
    expect(formatMdWithDay("2026-10-12")).toBe("10/12(월)");
  });

  it("주차 URL을 검증하고 변환한다", () => {
    expect(parseYearWeekSlug("2026-W42")).toBe(202642);
    expect(parseYearWeekSlug("2020-w53")).toBe(202053);
    expect(parseYearWeekSlug("2021-W53")).toBeNull();
    expect(parseYearWeekSlug("2026-W2")).toBeNull();
    expect(formatYearWeekSlug(202642)).toBe("2026-W42");
    expect(isValidYearWeek(202654)).toBe(false);
  });

  it("이번 주와 다음 주의 월~금 범위를 계산한다", () => {
    expect(getIsoWeekRange(202642)).toEqual({
      yearWeek: 202642,
      monday: "2026-10-12",
      friday: "2026-10-16",
      nextMonday: "2026-10-19",
      nextFriday: "2026-10-23",
    });
    expect(getIsoWeekRange(202053)).toEqual({
      yearWeek: 202053,
      monday: "2020-12-28",
      friday: "2021-01-01",
      nextMonday: "2021-01-04",
      nextFriday: "2021-01-08",
    });
  });

  it("현재 주 기준 다음 주까지만 이동을 허용한다", () => {
    expect(canOpenYearWeek(202643, "2026-10-12")).toBe(true);
    expect(canOpenYearWeek(202644, "2026-10-12")).toBe(false);
    expect(canOpenYearWeek(202641, "2026-10-12")).toBe(true);
  });

  it("KST 기준 보고 마감 시각과 D-day 상태를 계산한다", () => {
    const deadlineAt = reportDeadlineEpoch(202642, 5, "18:00");
    expect(deadlineAt).toBe(Date.UTC(2026, 9, 16, 9, 0));
    expect(kstDateTimeToEpoch("2026-10-16", "18:00")).toBe(deadlineAt);
    expect(getDeadlineInfo(deadlineAt, Date.UTC(2026, 9, 15, 3))).toMatchObject({
      state: "upcoming",
      days: 1,
    });
    expect(getDeadlineInfo(deadlineAt, Date.UTC(2026, 9, 16, 8))).toMatchObject({
      state: "today",
      days: 0,
    });
    expect(getDeadlineInfo(deadlineAt, Date.UTC(2026, 9, 16, 10))).toMatchObject({
      state: "overdue",
      days: 0,
    });
  });
});
