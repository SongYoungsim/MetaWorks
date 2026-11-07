export const EMPLOYEE_NUMBER_EXAMPLE = "S000001";
export const EMPLOYEE_NUMBER_MESSAGE = "사번은 S로 시작하는 숫자 6자리 형식이어야 합니다. (예: S000001)";
export const EMPLOYEE_NUMBER_PATTERN = /^S\d{6}$/;

export function normalizeEmployeeNumber(value: string) {
  return value.trim().toUpperCase();
}

export function isEmployeeNumber(value: string) {
  return EMPLOYEE_NUMBER_PATTERN.test(normalizeEmployeeNumber(value));
}
