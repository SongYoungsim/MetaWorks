import type { ActionMeetingOption, ActionRegisterOptionsResponse, ActionWriteItem } from "@shared/types";
import { ISO_DATE_PATTERN } from "@shared/meeting";

export type ActionImportField = "meetingTypeCode" | "meetingDate" | "departmentId" | "subject" | "request";

export interface ParsedActionRow extends ActionWriteItem {
  sourceRow: number;
  errors: Partial<Record<ActionImportField, string>>;
  warning?: string;
  rawMeetingType?: string;
  rawDepartment?: string;
}

const HEADERS = ["회의구분", "일자", "부서", "주제", "주요 이슈 및 요청 사항"] as const;
const FILE_LIMIT = 5 * 1024 * 1024;
const ROW_LIMIT = 200;

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  if (typeof value === "object") {
    const item = value as { text?: unknown; result?: unknown; richText?: Array<{ text?: unknown }> };
    if (item.result !== undefined) return cellText(item.result);
    if (Array.isArray(item.richText)) return item.richText.map((part) => String(part.text ?? "")).join("").trim();
    if (item.text !== undefined) return String(item.text).trim();
  }
  return String(value).trim();
}

function safeFileName(value: string) {
  return value.replace(/[\\\\/:*?"<>|]/g, "_");
}

function saveBuffer(buffer: ArrayBuffer, fileName: string) {
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function downloadActionTemplate(options: ActionRegisterOptionsResponse, meeting: ActionMeetingOption | null) {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "MetaWorks";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("액션아이템 등록");
  sheet.columns = [
    { header: HEADERS[0], key: "type", width: 18 },
    { header: HEADERS[1], key: "date", width: 15 },
    { header: HEADERS[2], key: "department", width: 20 },
    { header: HEADERS[3], key: "subject", width: 30 },
    { header: HEADERS[4], key: "request", width: 55 },
  ];
  sheet.getRow(1).height = 25;
  sheet.getRow(1).eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18181B" } };
    cell.alignment = { vertical: "middle", horizontal: "center" };
  });
  sheet.addRow({
    type: meeting?.typeName ?? options.meetingTypes[0]?.name ?? "",
    date: meeting?.meetingDate ?? "2026-10-12",
    department: options.departments[0]?.name ?? "",
    subject: "예시 주제 (이 행을 삭제하고 작성)",
    request: "주요 이슈와 요청사항을 입력하세요.",
  });
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.autoFilter = "A1:E1";
  for (let row = 2; row <= ROW_LIMIT + 1; row += 1) {
    sheet.getCell(row, 2).numFmt = "yyyy-mm-dd";
    sheet.getCell(row, 1).dataValidation = {
      type: "list", allowBlank: Boolean(meeting), formulae: [`'부서 목록'!$A$2:$A$${Math.max(2, options.meetingTypes.length + 1)}`],
      errorTitle: "회의구분 확인", error: "목록에서 회의구분을 선택하세요.", showErrorMessage: true,
    };
    sheet.getCell(row, 3).dataValidation = {
      type: "list", allowBlank: false, formulae: [`'부서 목록'!$B$2:$B$${Math.max(2, options.departments.length + 1)}`],
      errorTitle: "부서 확인", error: "목록에서 부서를 선택하세요.", showErrorMessage: true,
    };
  }
  const reference = workbook.addWorksheet("부서 목록");
  reference.columns = [{ header: "회의구분", width: 24 }, { header: "부서", width: 24 }];
  const length = Math.max(options.meetingTypes.length, options.departments.length);
  for (let index = 0; index < length; index += 1) {
    reference.addRow([options.meetingTypes[index]?.name ?? "", options.departments[index]?.name ?? ""]);
  }
  reference.getRow(1).font = { bold: true };
  reference.views = [{ state: "frozen", ySplit: 1 }];
  const buffer = await workbook.xlsx.writeBuffer();
  const suffix = meeting ? `_${safeFileName(meeting.displayNo)}` : "";
  saveBuffer(buffer as ArrayBuffer, `액션아이템_등록양식${suffix}.xlsx`);
}

export async function parseActionExcel(
  file: File,
  options: ActionRegisterOptionsResponse,
  meeting: ActionMeetingOption | null,
): Promise<ParsedActionRow[]> {
  if (file.size > FILE_LIMIT) throw new Error("파일은 5MB 이하만 업로드할 수 있습니다.");
  if (!/[.](xlsx|xls)$/i.test(file.name)) throw new Error(".xlsx 또는 .xls 파일을 선택하세요.");
  const buffer = await file.arrayBuffer();
  let matrix: unknown[][];
  try {
    if (/[.]xls$/i.test(file.name)) {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
      const sheet = workbook.Sheets[workbook.SheetNames[0]];
      matrix = sheet ? XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: "" }) : [];
    } else {
      const ExcelJS = (await import("exceljs")).default;
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer);
      const sheet = workbook.worksheets[0];
      matrix = sheet ? Array.from({ length: sheet.rowCount }, (_, rowIndex) =>
        Array.from({ length: sheet.columnCount }, (__, columnIndex) => sheet.getCell(rowIndex + 1, columnIndex + 1).value)) : [];
    }
  } catch {
    throw new Error("파일을 읽을 수 없습니다. 손상 여부와 Excel 파일 형식을 확인하세요.");
  }
  if (!matrix.length) throw new Error("양식이 맞지 않습니다. 양식을 다시 받아 작성하세요.");
  const columns = new Map<string, number>();
  matrix[0].forEach((value, column) => columns.set(cellText(value), column));
  if (HEADERS.some((header) => !columns.has(header))) {
    throw new Error("양식이 맞지 않습니다. 양식을 다시 받아 작성하세요.");
  }
  const departmentByName = new Map(options.departments.map((department) => [department.name, department]));
  const rows: ParsedActionRow[] = [];
  for (let index = 1; index < matrix.length; index += 1) {
    const number = index + 1;
    const values = HEADERS.map((header) => cellText(matrix[index][columns.get(header)!]));
    if (values.every((value) => !value)) continue;
    if (rows.length >= ROW_LIMIT) throw new Error("한 번에 최대 200행까지 업로드할 수 있습니다.");
    const [rawType, rawDate, rawDepartment, subject, request] = values;
    const typeText = rawType || meeting?.typeName || "";
    const date = rawDate || meeting?.meetingDate || "";
    const type = options.meetingTypes.find((item) => item.name === typeText || item.code === typeText);
    const department = departmentByName.get(rawDepartment);
    const errors: ParsedActionRow["errors"] = {};
    if (!type) errors.meetingTypeCode = typeText ? "등록되지 않은 회의구분입니다." : "필수 항목입니다.";
    if (!ISO_DATE_PATTERN.test(date)) errors.meetingDate = "날짜 형식이 올바르지 않습니다. (예: 2026-10-12)";
    if (!department) errors.departmentId = rawDepartment ? "등록되지 않은 부서입니다." : "필수 항목입니다.";
    if (!subject) errors.subject = "필수 항목입니다.";
    if (!request) errors.request = "필수 항목입니다.";
    rows.push({
      sourceRow: number,
      meetingId: meeting?.id ?? null,
      meetingTypeCode: meeting?.typeCode ?? type?.code ?? typeText,
      meetingDate: meeting?.meetingDate ?? date,
      departmentId: department?.id ?? 0,
      subject,
      request,
      errors,
      rawMeetingType: typeText,
      rawDepartment,
    });
  }
  if (!rows.length) throw new Error("업로드할 데이터 행이 없습니다.");
  const seen = new Set<string>();
  for (const row of rows) {
    const key = [row.meetingTypeCode, row.meetingDate, row.departmentId || row.rawDepartment, row.subject, row.request].join("\\u0001");
    if (seen.has(key)) row.warning = "중복된 행입니다.";
    else seen.add(key);
  }
  return rows;
}
