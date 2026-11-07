import { describe, expect, it } from "vitest";
import { parseEmployeeCsv } from "./employeeCsv";

const departments = [{ id: 1, code: "T01", name: "경영지원팀", leaderId: null, isActive: true }];

describe("사원 CSV", () => {
  it("정상 행을 등록 요청으로 변환한다", () => {
    const [row] = parseEmployeeCsv("사번,이름,아이디,비밀번호,소속팀,직급,역할,회의서기,관리자\nS000002,홍길동,hong1,Start!123,T01,대리,팀원,Y,N", departments, []);
    expect(row?.errors).toEqual([]);
    expect(row?.request).toMatchObject({ empNo: "S000002", loginId: "HONG1", initialPassword: "Start!123", departmentId: 1, role: "member", isClerk: true, isAdmin: false });
  });

  it("중복과 잘못된 값을 행 오류로 표시한다", () => {
    const existing = [{ empNo: "S000002", loginId: "hong1" }] as never[];
    const [row] = parseEmployeeCsv("사번,이름,아이디,비밀번호,소속팀,직급,역할,회의서기,관리자\nS000002,홍길동,hong1,,없는팀,대리,팀원,?,N", departments, existing);
    expect(row?.request).toBeNull();
    expect(row?.errors.length).toBeGreaterThanOrEqual(3);
  });
});
