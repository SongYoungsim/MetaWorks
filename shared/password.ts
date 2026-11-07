/**
 * 비밀번호 규칙 (기능명세 F-LGN-05). 프론트 실시간 체크와 서버 재검증에 공통 사용.
 */
export interface PasswordPolicy {
  minLength: number;
  requireSpecial: boolean;
}

export const DEFAULT_PASSWORD_POLICY: PasswordPolicy = {
  minLength: 8,
  requireSpecial: true,
};

export const PASSWORD_MAX_LENGTH = 64;

export interface PasswordRuleResult {
  key: "length" | "alnum" | "special" | "different";
  label: string;
  ok: boolean;
}

export interface PasswordContext {
  loginId?: string;
  /** 현재(임시) 비밀번호와 같은지 여부는 서버에서만 확인 가능하므로 선택값 */
  sameAsCurrent?: boolean;
}

export function checkPasswordRules(
  password: string,
  ctx: PasswordContext = {},
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): PasswordRuleResult[] {
  const loginId = ctx.loginId?.trim().toLowerCase();
  const rules: PasswordRuleResult[] = [
    {
      key: "length",
      label: `${policy.minLength}자 이상`,
      ok: password.length >= policy.minLength && password.length <= PASSWORD_MAX_LENGTH,
    },
    {
      key: "alnum",
      label: "영문과 숫자 포함",
      ok: /[A-Za-z]/.test(password) && /[0-9]/.test(password),
    },
  ];
  if (policy.requireSpecial) {
    rules.push({
      key: "special",
      label: "특수문자 포함",
      ok: /[^A-Za-z0-9\s]/.test(password),
    });
  }
  rules.push({
    key: "different",
    label: "아이디·임시 비밀번호와 다름",
    ok:
      password.length > 0 &&
      !(loginId && password.toLowerCase().includes(loginId)) &&
      ctx.sameAsCurrent !== true,
  });
  return rules;
}

export function isPasswordValid(
  password: string,
  ctx: PasswordContext = {},
  policy: PasswordPolicy = DEFAULT_PASSWORD_POLICY,
): boolean {
  return checkPasswordRules(password, ctx, policy).every((r) => r.ok);
}
