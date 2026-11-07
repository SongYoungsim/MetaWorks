import { describe, expect, it } from "vitest";
import { createCsv, parseCsv } from "./csv";

describe("CSV 처리", () => {
  it("BOM, 쉼표, 줄바꿈, 이중 따옴표를 처리한다", () => {
    const text = '\uFEFF사번,이름,메모\r\nS000001,"홍,길동","첫 줄\n""둘째"" 줄"';
    expect(parseCsv(text)).toEqual([
      ["사번", "이름", "메모"],
      ["S000001", "홍,길동", '첫 줄\n"둘째" 줄'],
    ]);
  });

  it("생성한 CSV를 다시 읽을 수 있다", () => {
    const rows = [["사번", "이름"], ["S000002", "김,철수"]];
    expect(parseCsv(createCsv(rows))).toEqual(rows);
  });
});
