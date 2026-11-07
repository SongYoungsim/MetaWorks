import type { DepartmentOption, EmployeeAdminItem, EmployeeBulkCreateItem, Role } from "@shared/types";
import { parseCsv } from "@shared/csv";
import { EMPLOYEE_NUMBER_MESSAGE, isEmployeeNumber, normalizeEmployeeNumber } from "@shared/employee";

export interface EmployeeImportPreview {
  sourceRow: number;
  values: string[];
  request: EmployeeBulkCreateItem | null;
  errors: string[];
}

const HEADERS = ["사번", "이름", "아이디", "비밀번호", "소속팀", "직급", "역할", "회의서기", "관리자"] as const;
const ROLE_MAP: Record<string, Role> = { "팀원": "member", "팀장": "leader", "임원": "executive", member: "member", leader: "leader", executive: "executive" };

function booleanValue(value: string) {
  const normalized = value.trim().toLowerCase();
  if (["y", "yes", "1", "true", "예"].includes(normalized)) return true;
  if (["n", "no", "0", "false", "아니오"].includes(normalized)) return false;
  return null;
}

export function parseEmployeeCsv(text: string, departments: DepartmentOption[], employees: EmployeeAdminItem[]) {
  const rows = parseCsv(text);
  if (!rows.length) throw new Error("CSV 파일에 내용이 없습니다.");
  const normalizedHeaders = rows[0]!.map((value) => value.replace(/\s+/g, ""));
  const indexes = new Map(HEADERS.map((header) => [header, normalizedHeaders.indexOf(header)]));
  const missing = HEADERS.filter((header) => (indexes.get(header) ?? -1) < 0);
  if (missing.length) throw new Error(`필수 열이 없습니다: ${missing.join(", ")}`);
  if (rows.length - 1 > 100) throw new Error("한 번에 최대 100명까지 등록할 수 있습니다.");
  const departmentMap = new Map<string, DepartmentOption>();
  for (const department of departments.filter((item) => item.isActive)) {
    departmentMap.set(department.name.trim().toLowerCase(), department);
    departmentMap.set(department.code.trim().toLowerCase(), department);
  }
  const usedEmpNos = new Set(employees.map((item) => item.empNo));
  const usedLoginIds = new Set(employees.map((item) => item.loginId.toUpperCase()));
  const fileEmpNos = new Set<string>();
  const fileLoginIds = new Set<string>();
  const fileLeaderDepartments = new Set<number>();
  return rows.slice(1).map((row, index): EmployeeImportPreview => {
    const get = (header: typeof HEADERS[number]) => row[indexes.get(header)!]?.trim() ?? "";
    const empNo = normalizeEmployeeNumber(get("사번"));
    const name = get("이름");
    const loginId = get("아이디").toUpperCase();
    const initialPassword = get("비밀번호");
    const departmentText = get("소속팀");
    const position = get("직급");
    const roleText = get("역할");
    const clerkText = get("회의서기");
    const adminText = get("관리자");
    const role = ROLE_MAP[roleText.toLowerCase()] ?? ROLE_MAP[roleText];
    const department = departmentText ? departmentMap.get(departmentText.toLowerCase()) : undefined;
    const isClerk = booleanValue(clerkText);
    const isAdmin = booleanValue(adminText);
    const errors: string[] = [];
    if (!isEmployeeNumber(empNo)) errors.push(EMPLOYEE_NUMBER_MESSAGE);
    if (!name || name.length > 20) errors.push("이름은 1~20자로 입력하세요.");
    if (!/^[A-Z][A-Z0-9]{3,19}$/.test(loginId)) errors.push("아이디는 영문 대문자·숫자 4~20자로 입력하세요.");
    if (!initialPassword || initialPassword.length > 64) errors.push("비밀번호는 1~64자로 입력하세요.");
    if (!position || position.length > 30) errors.push("직급은 1~30자로 입력하세요.");
    if (!role) errors.push("역할은 팀원, 팀장, 임원 중 하나여야 합니다.");
    if (role !== "executive" && !department) errors.push("사용 중인 소속팀 이름 또는 코드를 입력하세요.");
    if (departmentText && !department) errors.push("등록되지 않은 소속팀입니다.");
    if (isClerk === null) errors.push("회의서기는 Y 또는 N으로 입력하세요.");
    if (isAdmin === null) errors.push("관리자는 Y 또는 N으로 입력하세요.");
    if (usedEmpNos.has(empNo) || fileEmpNos.has(empNo)) errors.push("이미 사용 중이거나 파일 안에서 중복된 사번입니다.");
    if (usedLoginIds.has(loginId) || fileLoginIds.has(loginId)) errors.push("이미 사용 중이거나 파일 안에서 중복된 아이디입니다.");
    if (empNo) fileEmpNos.add(empNo);
    if (loginId) fileLoginIds.add(loginId);
    if (role === "leader" && department) {
      if (department.leaderId) errors.push(`${department.name}에는 이미 팀장이 지정되어 있습니다.`);
      if (fileLeaderDepartments.has(department.id)) errors.push("파일 안에서 같은 팀의 팀장이 중복되었습니다.");
      fileLeaderDepartments.add(department.id);
    }
    const values = [empNo, name, loginId, initialPassword ? "••••••••" : "", departmentText || "-", position, roleText, clerkText, adminText];
    return { sourceRow: index + 2, values, errors, request: errors.length || !role || isClerk === null || isAdmin === null ? null : {
      empNo, name, loginId, initialPassword, departmentId: department?.id ?? null, position, role, isClerk, isAdmin,
    } };
  });
}

export const EMPLOYEE_CSV_HEADERS = [...HEADERS];
