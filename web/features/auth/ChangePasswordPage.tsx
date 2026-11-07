import { useId, useMemo, useState } from "react";
import type { FormEvent } from "react";
import { Check, Circle, Eye, EyeOff, KeyRound } from "lucide-react";
import { useNavigate } from "react-router";
import { checkPasswordRules } from "@shared/password";
import { ApiClientError } from "@/lib/api";
import { useAuth } from "./AuthProvider";

type PasswordField = "currentPassword" | "newPassword" | "confirmPassword";

export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { user, settings, changePassword } = useAuth();
  const currentId = useId();
  const passwordId = useId();
  const confirmId = useId();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [visible, setVisible] = useState<Record<PasswordField, boolean>>({
    currentPassword: false,
    newPassword: false,
    confirmPassword: false,
  });
  const [errors, setErrors] = useState<Partial<Record<PasswordField | "form", string>>>({});
  const [submitting, setSubmitting] = useState(false);

  const rules = useMemo(
    () =>
      checkPasswordRules(
        newPassword,
        { loginId: user?.loginId },
        {
          minLength: settings.passwordMinLength,
          requireSpecial: settings.passwordRequireSpecial,
        },
      ),
    [newPassword, settings.passwordMinLength, settings.passwordRequireSpecial, user?.loginId],
  );
  const isFirstLogin = user?.mustChangePassword ?? false;
  const matches = newPassword.length > 0 && newPassword === confirmPassword;
  const canSubmit =
    rules.every((rule) => rule.ok) &&
    matches &&
    (isFirstLogin || currentPassword.length > 0) &&
    !submitting;

  const toggleVisibility = (field: PasswordField) => {
    setVisible((current) => ({ ...current, [field]: !current[field] }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: Partial<Record<PasswordField | "form", string>> = {};
    if (!isFirstLogin && !currentPassword) nextErrors.currentPassword = "현재 비밀번호를 입력하세요.";
    if (!rules.every((rule) => rule.ok)) nextErrors.newPassword = "비밀번호 규칙을 모두 충족하세요.";
    if (!matches) nextErrors.confirmPassword = "비밀번호가 일치하지 않습니다.";
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      await changePassword({
        currentPassword: isFirstLogin ? undefined : currentPassword,
        newPassword,
      });
      navigate("/dashboard", { replace: true });
    } catch (error) {
      if (error instanceof ApiClientError) {
        setErrors({
          form: error.message,
          currentPassword: error.details.fields?.currentPassword,
          newPassword: error.details.fields?.newPassword,
        });
      } else {
        setErrors({ form: "연결이 불안정합니다. 잠시 후 다시 시도하세요." });
      }
    } finally {
      setSubmitting(false);
    }
  };

  const passwordInput = (
    id: string,
    field: PasswordField,
    label: string,
    value: string,
    setValue: (value: string) => void,
    autoComplete: string,
  ) => (
    <div className="field">
      <label className="field-label" htmlFor={id}>{label}</label>
      <div className="input-wrap">
        <input
          id={id}
          className="input"
          type={visible[field] ? "text" : "password"}
          autoComplete={autoComplete}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
            setErrors((current) => ({ ...current, [field]: undefined, form: undefined }));
          }}
          aria-invalid={Boolean(errors[field])}
          aria-describedby={errors[field] ? id + "-error" : undefined}
        />
        <button
          className="input-addon"
          type="button"
          onClick={() => toggleVisibility(field)}
          aria-label={visible[field] ? label + " 숨기기" : label + " 보기"}
        >
          {visible[field] ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
        </button>
      </div>
      {errors[field] && <span className="field-error" id={id + "-error"}>{errors[field]}</span>}
    </div>
  );

  return (
    <main className="password-page">
      <section className="password-card" aria-labelledby="password-page-title">
        <img className="password-logo" src="/logo.png" alt="META SYSTEMS" />
        <div className="password-icon" aria-hidden="true"><KeyRound /></div>
        <span className="badge badge-warning">{isFirstLogin ? "첫 로그인" : "비밀번호 변경"}</span>
        <div className="auth-heading password-heading">
          <h1 id="password-page-title">새 비밀번호를 설정하세요</h1>
          <p>
            {isFirstLogin
              ? user?.name + "님, 임시 비밀번호로 로그인하셨습니다. 계속하려면 새 비밀번호를 정해주세요."
              : "안전한 계정 사용을 위해 새 비밀번호를 입력하세요."}
          </p>
        </div>

        {errors.form && <div className="callout callout-danger" role="alert">{errors.form}</div>}

        <form className="auth-form password-form" onSubmit={submit} noValidate>
          {!isFirstLogin &&
            passwordInput(
              currentId,
              "currentPassword",
              "현재 비밀번호",
              currentPassword,
              setCurrentPassword,
              "current-password",
            )}

          {passwordInput(
            passwordId,
            "newPassword",
            "새 비밀번호",
            newPassword,
            setNewPassword,
            "new-password",
          )}

          <ul className="password-rules" aria-label="비밀번호 규칙">
            {rules.map((rule) => (
              <li className={rule.ok ? "is-valid" : undefined} key={rule.key}>
                {rule.ok ? <Check aria-hidden="true" /> : <Circle aria-hidden="true" />}
                {rule.label}
              </li>
            ))}
          </ul>

          {passwordInput(
            confirmId,
            "confirmPassword",
            "새 비밀번호 확인",
            confirmPassword,
            setConfirmPassword,
            "new-password",
          )}

          {confirmPassword && (
            <p className={matches ? "password-match is-valid" : "password-match is-invalid"}>
              {matches ? "비밀번호가 일치합니다." : "비밀번호가 일치하지 않습니다."}
            </p>
          )}

          <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={!canSubmit}>
            {submitting && <span className="spinner" aria-hidden="true" />}
            {submitting ? "변경 중…" : "변경하고 시작하기"}
          </button>
        </form>

        <p className="password-note">
          변경 후 대시보드로 이동합니다. 비밀번호는 암호화되어 저장되며 관리자도 볼 수 없습니다.
        </p>
      </section>
    </main>
  );
}
