import type { ReactNode } from "react";

export type MarkdownBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; text: string; level: number }
  | { type: "code"; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "table"; headers: string[]; rows: string[][] };

function cells(line: string) {
  return line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
}

export function parseMarkdownBlocks(value: string): MarkdownBlock[] {
  const lines = value.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index]!;
    if (!line.trim()) { index += 1; continue; }
    if (line.trim().startsWith("```")) {
      const content: string[] = []; index += 1;
      while (index < lines.length && !lines[index]!.trim().startsWith("```")) { content.push(lines[index]!); index += 1; }
      blocks.push({ type: "code", text: content.join("\n") }); index += 1; continue;
    }
    const heading = /^(#{1,3})\s+(.+)$/.exec(line.trim());
    if (heading) { blocks.push({ type: "heading", level: heading[1]!.length, text: heading[2]! }); index += 1; continue; }
    if (line.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?---/.test(lines[index + 1]!)) {
      const headers = cells(line); const rows: string[][] = []; index += 2;
      while (index < lines.length && lines[index]!.includes("|") && lines[index]!.trim()) { rows.push(cells(lines[index]!)); index += 1; }
      blocks.push({ type: "table", headers, rows }); continue;
    }
    const listMatch = /^\s*(?:(\d+)[.)]|-|\*)\s+(.+)$/.exec(line);
    if (listMatch) {
      const ordered = Boolean(listMatch[1]); const items: string[] = [];
      while (index < lines.length) {
        const match = /^\s*(?:(\d+)[.)]|-|\*)\s+(.+)$/.exec(lines[index]!);
        if (!match || Boolean(match[1]) !== ordered) break;
        items.push(match[2]!); index += 1;
      }
      blocks.push({ type: "list", ordered, items }); continue;
    }
    const paragraph = [line.trim()]; index += 1;
    while (index < lines.length && lines[index]!.trim() && !/^(#{1,3})\s+/.test(lines[index]!.trim())
      && !/^\s*(?:(\d+)[.)]|-|\*)\s+/.test(lines[index]!) && !lines[index]!.trim().startsWith("```")
      && !(lines[index]!.includes("|") && index + 1 < lines.length && /^\s*\|?\s*:?---/.test(lines[index + 1]!))) {
      paragraph.push(lines[index]!.trim()); index += 1;
    }
    blocks.push({ type: "paragraph", text: paragraph.join("\n") });
  }
  return blocks;
}

function inline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index}>{part.slice(1, -1)}</code>;
    return part;
  });
}

export function AiMarkdown({ content }: { content: string }) {
  return <div className="ai-markdown">{parseMarkdownBlocks(content).map((block, index) => {
    if (block.type === "heading") return block.level === 1 ? <h2 key={index}>{inline(block.text)}</h2> : <h3 key={index}>{inline(block.text)}</h3>;
    if (block.type === "paragraph") return <p key={index}>{block.text.split("\n").map((line, lineIndex) => <span key={lineIndex}>{inline(line)}{lineIndex < block.text.split("\n").length - 1 && <br />}</span>)}</p>;
    if (block.type === "code") return <pre key={index}><code>{block.text}</code></pre>;
    if (block.type === "list") {
      const items = block.items.map((item, itemIndex) => <li key={itemIndex}>{inline(item)}</li>);
      return block.ordered ? <ol key={index}>{items}</ol> : <ul key={index}>{items}</ul>;
    }
    return <div className="ai-table-wrap" key={index}><table><thead><tr>{block.headers.map((header, cellIndex) => <th key={cellIndex}>{inline(header)}</th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{block.headers.map((_, cellIndex) => <td key={cellIndex}>{inline(row[cellIndex] ?? "")}</td>)}</tr>)}</tbody></table></div>;
  })}</div>;
}
