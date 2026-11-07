import { describe, expect, it } from "vitest";
import type { ActionMeetingOption, ActionRegisterOptionsResponse } from "@shared/types";
import { parseActionExcel } from "./actionExcel";

const options: ActionRegisterOptionsResponse = {
  meetings: [],
  meetingTypes: [{ code: "WEEKLY", name: "주간" }],
  departments: [{ id: 10, code: "MGT", name: "경영지원팀", leaderId: 1, isActive: true }],
  canEdit: true,
};

const meeting: ActionMeetingOption = {
  id: 5,
  displayNo: "MT-2026-0005",
  typeCode: "WEEKLY",
  typeName: "주간",
  meetingDate: "2026-10-12",
  timePlace: null,
  chair: "대표이사",
  bodyText: null,
};

describe("parseActionExcel", () => {
  it("열 순서가 달라도 헤더 이름으로 읽고 연결 회의 정보를 채운다", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("등록");
    sheet.addRow(["부서", "주제", "일자", "주요 이슈 및 요청 사항", "회의구분"]);
    sheet.addRow(["경영지원팀", "계약 검토", "", "계약서 초안을 검토하세요.", ""]);
    const buffer = await workbook.xlsx.writeBuffer();
    const file = new File([new Uint8Array(buffer as ArrayBuffer)], "actions.xlsx");

    const rows = await parseActionExcel(file, options, meeting);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      meetingId: 5,
      meetingTypeCode: "WEEKLY",
      meetingDate: "2026-10-12",
      departmentId: 10,
      subject: "계약 검토",
      errors: {},
    });
  }, 20_000);

  it("구형 xls 파일을 읽고 잘못된 부서를 오류로 표시한다", async () => {
    const XLSX = await import("xlsx");
    const sheet = XLSX.utils.aoa_to_sheet([
      ["회의구분", "일자", "부서", "주제", "주요 이슈 및 요청 사항"],
      ["주간", "2026-10-12", "없는부서", "검토", "확인 요청"],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, sheet, "등록");
    const buffer = XLSX.write(workbook, { type: "array", bookType: "xls" });
    const file = new File([buffer], "actions.xls");

    const rows = await parseActionExcel(file, options, null);

    expect(rows[0].errors.departmentId).toBe("등록되지 않은 부서입니다.");
    expect(rows[0].rawDepartment).toBe("없는부서");
  }, 20_000);
});
