import { describe, expect, it } from "vitest";
import { kstClock } from "./notifications";

describe("kstClock", () => {
  it("UTC 예약 시각을 KST 날짜와 ISO 요일로 변환한다", () => {
    expect(kstClock(Date.parse("2026-10-16T00:00:00Z"))).toEqual({
      date: "2026-10-16",
      weekday: 5,
      hour: 9,
      minute: 0,
    });
  });

  it("자정 경계를 다음 KST 날짜로 계산한다", () => {
    expect(kstClock(Date.parse("2026-10-18T16:00:00Z"))).toEqual({
      date: "2026-10-19",
      weekday: 1,
      hour: 1,
      minute: 0,
    });
  });
});
