import type { MeetingDetailResponse } from "@shared/types";

type RichPart = { text: string; font?: { bold?: boolean; size?: number; color?: { argb: string } } };

const STATUS_LABEL = {
  unregistered: "미등록",
  in_progress: "진행중",
  hold: "보류",
  done: "완료",
} as const;

function bodyParts(body: string | null, fallback: string | null): RichPart[] {
  if (!body) return fallback ? [{ text: fallback }] : [];
  try {
    const root = JSON.parse(body) as { content?: unknown[] };
    const parts: RichPart[] = [];
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const item = node as {
        type?: string;
        text?: string;
        attrs?: { level?: number };
        marks?: Array<{ type?: string; attrs?: { color?: string } }>;
        content?: unknown[];
      };
      if (item.type === "text" && item.text) {
        const bold = item.marks?.some((mark) => mark.type === "bold");
        const color = item.marks?.find((mark) => mark.type === "textStyle")?.attrs?.color;
        const argb = color === "#dc2626" ? "FFDC2626" : color === "#2563eb" ? "FF2563EB" : "FF18181B";
        parts.push({ text: item.text, font: { bold, color: { argb } } });
      }
      if (item.type === "image") parts.push({ text: "[이미지 첨부]", font: { color: { argb: "FF71717A" } } });
      item.content?.forEach(visit);
      if (["heading", "paragraph", "listItem"].includes(item.type ?? "")) parts.push({ text: "\\n" });
    };
    root.content?.forEach(visit);
    while (parts.at(-1)?.text === "\\n") parts.pop();
    return parts.length ? parts : fallback ? [{ text: fallback }] : [];
  } catch {
    return fallback ? [{ text: fallback }] : [];
  }
}

function border() {
  const side = { style: "thin" as const, color: { argb: "FFD4D4D8" } };
  return { top: side, bottom: side, left: side, right: side };
}

export async function downloadMeetingExcel(meeting: MeetingDetailResponse): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "META SYSTEMS 업무트래커";
  workbook.created = new Date();

  const sheet = workbook.addWorksheet("회의록", { views: [{ state: "frozen", ySplit: 2 }] });
  sheet.columns = Array.from({ length: 6 }, () => ({ width: 22 }));
  sheet.mergeCells("A1:F1");
  sheet.getCell("A1").value = `${meeting.meetingDate} ${meeting.typeName} 회의록`;
  sheet.getCell("A1").font = { bold: true, size: 17, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18181B" } };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 32;

  const infoRows: Array<[string, string, string, string]> = [
    ["표시번호", meeting.displayNo ?? "임시저장", "상태", meeting.status === "published" ? "등록" : "작성중"],
    ["회의구분", meeting.typeName, "회의일자", meeting.meetingDate],
    ["시간 · 장소", meeting.timePlace ?? "-", "주재", meeting.chair],
    ["서기", `${meeting.clerkName}${meeting.clerkDepartmentName ? ` (${meeting.clerkDepartmentName})` : ""}`, "연결 액션", `${meeting.actionCount}건`],
  ];
  for (const values of infoRows) {
    const row = sheet.addRow([values[0], values[1], "", values[2], values[3], ""]);
    sheet.mergeCells(row.number, 2, row.number, 3);
    sheet.mergeCells(row.number, 5, row.number, 6);
    [1, 4].forEach((column) => {
      row.getCell(column).font = { bold: true, color: { argb: "FF3F3F46" } };
      row.getCell(column).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
    });
  }
  const attendeeRow = sheet.addRow(["참석자", meeting.attendees.map((person) =>
    `${person.departmentName ? person.departmentName + " · " : ""}${person.name}${person.position ? ` [${person.position}]` : ""}`).join(", ") || "-"]);
  sheet.mergeCells(attendeeRow.number, 2, attendeeRow.number, 6);
  attendeeRow.getCell(1).font = { bold: true };
  attendeeRow.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };

  const bodyHeader = sheet.addRow(["회의 본문"]);
  sheet.mergeCells(bodyHeader.number, 1, bodyHeader.number, 6);
  bodyHeader.getCell(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
  bodyHeader.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3F3F46" } };
  const bodyRow = sheet.addRow([]);
  sheet.mergeCells(bodyRow.number, 1, bodyRow.number, 6);
  const richText = bodyParts(meeting.body, meeting.bodyText);
  bodyRow.getCell(1).value = richText.length ? { richText } : "등록된 회의 본문이 없습니다.";
  bodyRow.height = Math.min(300, Math.max(90, (meeting.bodyText?.split("\\n").length ?? 3) * 18));

  const fileHeader = sheet.addRow(["첨부파일"]);
  sheet.mergeCells(fileHeader.number, 1, fileHeader.number, 6);
  fileHeader.getCell(1).font = { bold: true };
  fileHeader.getCell(1).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFF4F4F5" } };
  const fileRow = sheet.addRow([meeting.attachments.map((file) => file.fileName).join(", ") || "-"]);
  sheet.mergeCells(fileRow.number, 1, fileRow.number, 6);

  for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = border();
      cell.alignment = { vertical: "top", wrapText: true };
    });
  }

  const actions = workbook.addWorksheet("연결 액션");
  actions.columns = [
    { width: 20 }, { width: 16 }, { width: 24 }, { width: 52 },
    { width: 13 }, { width: 42 }, { width: 14 },
  ];
  const actionHeader = actions.addRow(["액션번호", "부서", "주제", "주요 이슈 및 요청 사항", "진행여부", "최근 진행내용", "완료일"]);
  actionHeader.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18181B" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });
  if (meeting.linkedActions.length) {
    for (const action of meeting.linkedActions) {
      actions.addRow([action.displayNo, action.departmentName, action.subject, action.request,
        STATUS_LABEL[action.status], action.latestProgressText ?? "-", action.completedDate ?? "-"]);
    }
  } else {
    actions.addRow(["연결된 액션아이템이 없습니다."]);
    actions.mergeCells(2, 1, 2, 7);
  }
  for (let rowNumber = 2; rowNumber <= actions.rowCount; rowNumber += 1) {
    actions.getRow(rowNumber).eachCell({ includeEmpty: true }, (cell) => {
      cell.border = border();
      cell.alignment = { vertical: "top", wrapText: true };
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(buffer)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  const safeType = meeting.typeName.replace(/[^0-9A-Za-z가-힣._-]/g, "_");
  anchor.download = `${meeting.meetingDate}_${safeType}_회의록.xlsx`;
  anchor.click();
  URL.revokeObjectURL(url);
}
