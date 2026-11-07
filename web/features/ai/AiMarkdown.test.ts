import { describe, expect, it } from "vitest";
import { parseMarkdownBlocks } from "./AiMarkdown";

describe("parseMarkdownBlocks", () => {
  it("제목, 목록, 표를 안전한 블록으로 나눈다", () => {
    const result = parseMarkdownBlocks("## 요약\n\n- 완료\n- 진행\n\n| 부서 | 상태 |\n|---|---|\n| 개발 | 진행 |");
    expect(result).toEqual([
      { type: "heading", level: 2, text: "요약" },
      { type: "list", ordered: false, items: ["완료", "진행"] },
      { type: "table", headers: ["부서", "상태"], rows: [["개발", "진행"]] },
    ]);
  });

  it("HTML을 해석하지 않고 일반 텍스트로 유지한다", () => {
    expect(parseMarkdownBlocks("<script>alert(1)</script>"))
      .toEqual([{ type: "paragraph", text: "<script>alert(1)</script>" }]);
  });
});
