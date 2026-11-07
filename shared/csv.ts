export function parseCsv(text: string): string[][] {
  const input = text.replace(/^\uFEFF/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index]!;
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ",") { row.push(field.trim()); field = ""; }
    else if (char === "\n") {
      row.push(field.trim().replace(/\r$/, ""));
      if (row.some((value) => value !== "")) rows.push(row);
      row = []; field = "";
    } else field += char;
  }
  row.push(field.trim().replace(/\r$/, ""));
  if (row.some((value) => value !== "")) rows.push(row);
  if (quoted) throw new Error("따옴표가 닫히지 않은 CSV입니다.");
  return rows;
}

export function createCsv(rows: Array<Array<string | number>>) {
  return rows.map((row) => row.map((value) => {
    const text = String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }).join(",")).join("\r\n");
}
