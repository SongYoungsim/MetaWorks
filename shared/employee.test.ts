import { describe, expect, it } from "vitest";
import { isEmployeeNumber, normalizeEmployeeNumber } from "./employee";

describe("사번 형식", () => {
  it("S와 숫자 6자리만 허용한다", () => {
    expect(isEmployeeNumber("S000001")).toBe(true);
    expect(isEmployeeNumber("s123456")).toBe(true);
    expect(isEmployeeNumber("S0000")).toBe(false);
    expect(isEmployeeNumber("E000001")).toBe(false);
    expect(isEmployeeNumber("S12345A")).toBe(false);
  });

  it("공백과 소문자를 정규화한다", () => {
    expect(normalizeEmployeeNumber(" s000042 ")).toBe("S000042");
  });
});
