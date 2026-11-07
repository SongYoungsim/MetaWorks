import { describe, expect, it } from "vitest";
import { canDeleteMeeting, ISO_DATE_PATTERN, nextMeetingDisplayNo } from "./meeting";

describe("canDeleteMeeting", () => {
  const base = { clerkId: 1, userId: 1, isClerk: true, isAdmin: false, linkedActionCount: 0 };

  it("작성 중 회의록은 작성 서기만 삭제한다", () => {
    expect(canDeleteMeeting({ ...base, status: "draft" })).toBe(true);
    expect(canDeleteMeeting({ ...base, status: "draft", userId: 2 })).toBe(false);
  });

  it("등록 회의록은 관리자만 삭제한다", () => {
    expect(canDeleteMeeting({ ...base, status: "published" })).toBe(false);
    expect(canDeleteMeeting({ ...base, status: "published", isAdmin: true })).toBe(true);
  });

  it("연결 액션이 있으면 삭제하지 않는다", () => {
    expect(canDeleteMeeting({ ...base, status: "draft", linkedActionCount: 1 })).toBe(false);
    expect(canDeleteMeeting({ ...base, status: "published", isAdmin: true, linkedActionCount: 1 })).toBe(false);
  });
});

describe("ISO_DATE_PATTERN", () => {
  it("HTML 날짜 입력 형식을 허용한다", () => {
    expect(ISO_DATE_PATTERN.test("2026-10-09")).toBe(true);
  });

  it("잘못된 날짜 형식을 거부한다", () => {
    expect(ISO_DATE_PATTERN.test("2026/10/09")).toBe(false);
  });
});

describe("nextMeetingDisplayNo", () => {
  it("날짜별 첫 회의록 번호를 만든다", () => {
    expect(nextMeetingDisplayNo("2026-10-12", [])).toBe("MT-20261012-01");
  });

  it("같은 날짜의 가장 큰 순번 다음 번호를 만든다", () => {
    expect(nextMeetingDisplayNo("2026-10-12", [
      "MT-20261012-01", "MT-20261012-03", "MT-20261011-09", null,
    ])).toBe("MT-20261012-04");
  });

  it("형식이 잘못된 번호는 제외한다", () => {
    expect(nextMeetingDisplayNo("2026-10-12", ["MT-20261012-X", "OTHER-01"]))
      .toBe("MT-20261012-01");
  });
});
