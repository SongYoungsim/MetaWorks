import { describe, expect, it } from "vitest";
import { actionDisplayNumbers } from "./action";

describe("actionDisplayNumbers", () => {
  it("연도별 액션 번호를 연속 생성한다", () => {
    expect(actionDisplayNumbers(2026, 37, 3)).toEqual([
      "AC-2026-0037", "AC-2026-0038", "AC-2026-0039",
    ]);
  });

  it("잘못된 시작값과 건수를 거부한다", () => {
    expect(() => actionDisplayNumbers(2026, 0, 1)).toThrow();
    expect(() => actionDisplayNumbers(2026, 1, 201)).toThrow();
  });
});
