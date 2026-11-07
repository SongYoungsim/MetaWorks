import { describe, expect, it } from "vitest";
import { checkPasswordRules, isPasswordValid } from "./password";

describe("비밀번호 정책", () => {
  it("기본 규칙을 모두 충족하는 비밀번호를 허용한다", () => {
    expect(isPasswordValid("Meta!2026", { loginId: "songys", sameAsCurrent: false })).toBe(true);
  });

  it("길이, 영문·숫자, 특수문자 규칙을 각각 검사한다", () => {
    const failedKeys = checkPasswordRules("short", {
      loginId: "songys",
      sameAsCurrent: false,
    })
      .filter((rule) => !rule.ok)
      .map((rule) => rule.key);

    expect(failedKeys).toEqual(expect.arrayContaining(["length", "alnum", "special"]));
  });

  it("아이디가 포함되거나 현재 비밀번호와 같으면 거부한다", () => {
    expect(isPasswordValid("songys!2026", { loginId: "songys" })).toBe(false);
    expect(isPasswordValid("Meta!2026", { sameAsCurrent: true })).toBe(false);
  });

  it("특수문자 선택 정책을 지원한다", () => {
    expect(isPasswordValid("Meta2026", {}, { minLength: 8, requireSpecial: false })).toBe(true);
  });
});
