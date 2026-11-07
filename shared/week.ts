/**
 * ISO 8601 주차 유틸 (월요일 시작). 모든 계산은 KST 달력 날짜 기준.
 */
const DAY_MS = 86_400_000;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/** UTC epoch → KST 달력 날짜 'YYYY-MM-DD' */
export function toKstDateString(epochMs: number = Date.now()): string {
  return new Date(epochMs + KST_OFFSET_MS).toISOString().slice(0, 10);
}

function parseDate(date: string): Date {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function format(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface IsoWeek {
  year: number;
  week: number;
  /** 202642 형태 */
  yearWeek: number;
}

export function getIsoWeek(date: string): IsoWeek {
  const d = parseDate(date);
  const dayNum = d.getUTCDay() || 7; // 월=1 … 일=7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // 같은 주의 목요일
  const year = d.getUTCFullYear();
  const yearStart = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
  return { year, week, yearWeek: year * 100 + week };
}

/** 해당 ISO 주차의 월요일 'YYYY-MM-DD' */
export function mondayOfIsoWeek(year: number, week: number): string {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const monday = new Date(jan4.getTime() - (jan4Day - 1) * DAY_MS + (week - 1) * 7 * DAY_MS);
  return format(monday);
}

export function addDays(date: string, days: number): string {
  return format(new Date(parseDate(date).getTime() + days * DAY_MS));
}

export function splitYearWeek(yearWeek: number): { year: number; week: number } {
  return { year: Math.floor(yearWeek / 100), week: yearWeek % 100 };
}

/** 해당 ISO 연도의 총 주 수(52 또는 53). */
export function weeksInIsoYear(year: number): number {
  return getIsoWeek(year + "-12-28").week;
}

export function isValidYearWeek(yearWeek: number): boolean {
  if (!Number.isInteger(yearWeek)) return false;
  const { year, week } = splitYearWeek(yearWeek);
  return year >= 1970 && year <= 9999 && week >= 1 && week <= weeksInIsoYear(year);
}

/** URL의 2026-W42 형식을 내부 정수 202642로 변환한다. */
export function parseYearWeekSlug(value: string): number | null {
  const match = /^([0-9]{4})-W([0-9]{2})$/i.exec(value.trim());
  if (!match) return null;
  const yearWeek = Number(match[1]) * 100 + Number(match[2]);
  return isValidYearWeek(yearWeek) ? yearWeek : null;
}

export function formatYearWeekSlug(yearWeek: number): string {
  if (!isValidYearWeek(yearWeek)) throw new RangeError("올바르지 않은 ISO 주차입니다.");
  const { year, week } = splitYearWeek(yearWeek);
  return year + "-W" + String(week).padStart(2, "0");
}

/** yearWeek 에 n주를 더한 yearWeek */
export function shiftYearWeek(yearWeek: number, n: number): number {
  if (!isValidYearWeek(yearWeek)) throw new RangeError("올바르지 않은 ISO 주차입니다.");
  const { year, week } = splitYearWeek(yearWeek);
  return getIsoWeek(addDays(mondayOfIsoWeek(year, week), n * 7)).yearWeek;
}

export interface IsoWeekRange {
  yearWeek: number;
  monday: string;
  friday: string;
  nextMonday: string;
  nextFriday: string;
}

/** 보고서 열 머리에 사용하는 이번 주와 다음 주의 월~금 범위. */
export function getIsoWeekRange(yearWeek: number): IsoWeekRange {
  if (!isValidYearWeek(yearWeek)) throw new RangeError("올바르지 않은 ISO 주차입니다.");
  const { year, week } = splitYearWeek(yearWeek);
  const monday = mondayOfIsoWeek(year, week);
  return {
    yearWeek,
    monday,
    friday: addDays(monday, 4),
    nextMonday: addDays(monday, 7),
    nextFriday: addDays(monday, 11),
  };
}

/** 화면에서 이동할 수 있는 최대 주차는 현재 주의 다음 주다. */
export function canOpenYearWeek(targetYearWeek: number, today: string = toKstDateString()): boolean {
  if (!isValidYearWeek(targetYearWeek)) return false;
  return targetYearWeek <= shiftYearWeek(getIsoWeek(today).yearWeek, 1);
}

function parseTime(time: string): { hour: number; minute: number } {
  const match = /^([01][0-9]|2[0-3]):([0-5][0-9])$/.exec(time);
  if (!match) throw new RangeError("시간은 HH:mm 형식이어야 합니다.");
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/** KST 달력 날짜와 시간을 UTC epoch millisecond로 변환한다. */
export function kstDateTimeToEpoch(date: string, time: string): number {
  const [year, month, day] = date.split("-").map(Number);
  const { hour, minute } = parseTime(time);
  if (!year || !month || !day || format(parseDate(date)) !== date) {
    throw new RangeError("날짜는 YYYY-MM-DD 형식이어야 합니다.");
  }
  return Date.UTC(year, month - 1, day, hour - 9, minute);
}

/** 운영 설정의 요일(월=1 … 일=7)과 시간으로 해당 주차 마감 시각을 계산한다. */
export function reportDeadlineEpoch(
  yearWeek: number,
  weekday: number,
  time: string,
): number {
  if (!Number.isInteger(weekday) || weekday < 1 || weekday > 7) {
    throw new RangeError("요일은 1~7이어야 합니다.");
  }
  const date = addDays(getIsoWeekRange(yearWeek).monday, weekday - 1);
  return kstDateTimeToEpoch(date, time);
}

export type DeadlineState = "upcoming" | "today" | "overdue";

export interface DeadlineInfo {
  state: DeadlineState;
  /** 마감일까지 남은 KST 달력 일수. 경과한 경우 음수. */
  days: number;
  deadlineAt: number;
}

export function getDeadlineInfo(deadlineAt: number, nowMs: number = Date.now()): DeadlineInfo {
  const deadlineDate = toKstDateString(deadlineAt);
  const today = toKstDateString(nowMs);
  const days = Math.round((parseDate(deadlineDate).getTime() - parseDate(today).getTime()) / DAY_MS);
  return {
    state: nowMs > deadlineAt ? "overdue" : days === 0 ? "today" : "upcoming",
    days,
    deadlineAt,
  };
}

const WEEKDAY_KO = ["일", "월", "화", "수", "목", "금", "토"];

/** '10/12(월)' */
export function formatMdWithDay(date: string): string {
  const d = parseDate(date);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY_KO[d.getUTCDay()]})`;
}

/** 기간을 표시 구간에 맞게 자른다. 겹치지 않으면 null. */
export function clipDateRange(
  startDate: string,
  endDate: string,
  windowStart: string,
  windowEnd: string,
): { startDate: string; endDate: string } | null {
  if (startDate > windowEnd || endDate < windowStart) return null;
  return {
    startDate: startDate < windowStart ? windowStart : startDate,
    endDate: endDate > windowEnd ? windowEnd : endDate,
  };
}
