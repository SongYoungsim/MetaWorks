import type { WeeklyReportEntry, WeeklyReportResponse } from "@shared/types";
import { clipDateRange, formatMdWithDay, splitYearWeek } from "@shared/week";

const RESULT_SYMBOL = { done: "○", continue: "→", stopped: "X", hold: "△" } as const;

type RichPart = { text: string; font?: { bold?: boolean; color?: { argb: string } } };

function bodyParts(body: string | null, fallback: string | null): RichPart[] {
  if (!body) return fallback ? [{ text: fallback }] : [];
  try {
    const root = JSON.parse(body) as { content?: unknown[] };
    const parts: RichPart[] = [];
    const visit = (node: unknown) => {
      if (!node || typeof node !== "object") return;
      const item = node as { type?: string; text?: string; marks?: Array<{ type?: string; attrs?: { color?: string } }>; content?: unknown[] };
      if (item.type === "text" && item.text) {
        const bold = item.marks?.some((mark) => mark.type === "bold");
        const color = item.marks?.find((mark) => mark.type === "textStyle")?.attrs?.color;
        const argb = color === "#dc2626" ? "FFDC2626" : color === "#2563eb" ? "FF2563EB" : "FF18181B";
        parts.push({ text: item.text, font: { bold, color: { argb } } });
      }
      if (item.type === "image") parts.push({ text: "[이미지 첨부]" });
      item.content?.forEach(visit);
      if (["paragraph", "listItem"].includes(item.type ?? "")) parts.push({ text: "\\n" });
    };
    root.content?.forEach(visit);
    if (parts.at(-1)?.text === "\\n") parts.pop();
    return parts.length ? parts : fallback ? [{ text: fallback }] : [];
  } catch {
    return fallback ? [{ text: fallback }] : [];
  }
}

function scheduleText(value: string | null): string {
  if (!value) return "";
  try {
    const parsed = JSON.parse(value) as { dates?: unknown };
    return Array.isArray(parsed.dates)
      ? parsed.dates.filter((date): date is string => typeof date === "string").map(formatMdWithDay).join(", ")
      : "";
  } catch { return ""; }
}

function entryRichText(entry: WeeklyReportEntry, side: "this" | "next"): RichPart[] {
  const title = (entry.number === null ? "" : entry.number + ". ") + entry.title + "\\n";
  const body = side === "this"
    ? bodyParts(entry.thisWeekBody, entry.thisWeekText)
    : bodyParts(entry.nextPlanBody, entry.nextPlanText);
  const schedule = scheduleText(side === "this" ? entry.performSchedule : entry.dueSchedule);
  return [
    { text: title, font: { bold: true, color: { argb: "FF18181B" } } },
    ...body,
    ...(schedule ? [{ text: "\\n(" + schedule + ")", font: { color: { argb: "FF71717A" } } }] : []),
  ];
}

export async function downloadReportExcel(report: WeeklyReportResponse): Promise<void> {
  const ExcelJS = (await import("exceljs")).default;
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "META SYSTEMS 업무트래커";
  workbook.created = new Date();
  const sheet = workbook.addWorksheet("주간업무보고", { views: [{ state: "frozen", ySplit: 4 }] });
  sheet.columns = [
    { key: "category", width: 15 }, { key: "detail", width: 24 },
    { key: "thisWeek", width: 55 }, { key: "result", width: 10 }, { key: "nextWeek", width: 55 },
  ];
  const week = splitYearWeek(report.yearWeek);
  sheet.mergeCells("A1:E1");
  sheet.getCell("A1").value = report.department.name + " 주간업무보고";
  sheet.getCell("A1").font = { bold: true, size: 16, color: { argb: "FFFFFFFF" } };
  sheet.getCell("A1").fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF18181B" } };
  sheet.getCell("A1").alignment = { horizontal: "center", vertical: "middle" };
  sheet.getRow(1).height = 30;
  sheet.mergeCells("A2:E2");
  sheet.getCell("A2").value = week.year + "년 " + week.week + "주차 · "
    + formatMdWithDay(report.week.monday) + "–" + formatMdWithDay(report.week.friday);
  sheet.getCell("A2").alignment = { horizontal: "center" };
  sheet.addRow([]);
  const header = sheet.addRow(["구분", "세부내용", "금주실적", "결과", "차주계획"]);
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF3F3F46" } };
    cell.alignment = { horizontal: "center", vertical: "middle" };
  });

  const categoryRanges = new Map<number, { start: number; end: number }>();
  for (const detail of report.details) {
    const entries = detail.entries.length ? detail.entries : [null];
    const start = sheet.rowCount + 1;
    for (const entry of entries) {
      const row = sheet.addRow([detail.category.name, detail.name, "", entry?.result ? RESULT_SYMBOL[entry.result] : "", ""]);
      if (entry) {
        row.getCell(3).value = { richText: entryRichText(entry, "this") };
        row.getCell(5).value = { richText: entryRichText(entry, "next") };
      }
      row.height = 58;
    }
    const end = sheet.rowCount;
    if (end > start) sheet.mergeCells(start, 2, end, 2);
    const range = categoryRanges.get(detail.category.id);
    categoryRanges.set(detail.category.id, { start: range?.start ?? start, end });
  }
  for (const range of categoryRanges.values()) {
    if (range.end > range.start) sheet.mergeCells(range.start, 1, range.end, 1);
  }

  if (report.attendances.length) {
    const start = sheet.rowCount + 1;
    for (const item of report.attendances) {
      const current = clipDateRange(item.startDate, item.endDate, report.week.monday, report.week.friday);
      const next = clipDateRange(item.startDate, item.endDate, report.week.nextMonday, report.week.nextFriday);
      const label = "[" + (item.type === "trip" ? "출장" : "휴가") + "] " + item.employeeName;
      sheet.addRow(["출장 및 휴가", "근태", current ? label + " " + formatMdWithDay(current.startDate)
        + (current.startDate === current.endDate ? "" : "–" + formatMdWithDay(current.endDate)) + " " + (item.note ?? "") : "", "",
      next ? label + " " + formatMdWithDay(next.startDate)
        + (next.startDate === next.endDate ? "" : "–" + formatMdWithDay(next.endDate)) + " " + (item.note ?? "") : ""]);
    }
    if (sheet.rowCount > start) {
      sheet.mergeCells(start, 1, sheet.rowCount, 1);
      sheet.mergeCells(start, 2, sheet.rowCount, 2);
    }
  }

  for (let rowNumber = 5; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const row = sheet.getRow(rowNumber);
    row.eachCell({ includeEmpty: true }, (cell) => {
      cell.border = {
        top: { style: "thin", color: { argb: "FFD4D4D8" } }, bottom: { style: "thin", color: { argb: "FFD4D4D8" } },
        left: { style: "thin", color: { argb: "FFD4D4D8" } }, right: { style: "thin", color: { argb: "FFD4D4D8" } },
      };
      cell.alignment = { vertical: "top", wrapText: true, horizontal: cell.address.startsWith("D") ? "center" : "left" };
    });
  }
  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([new Uint8Array(buffer)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = report.department.name.replace(/[\\\\/:*?"<>|]/g, "_") + "_주간업무보고_" + report.yearWeek + ".xlsx";
  anchor.click();
  URL.revokeObjectURL(url);
}
