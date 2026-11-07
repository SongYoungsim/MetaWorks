import { useEffect, useId, useState } from "react";
import type { FormEvent } from "react";
import { Eye, EyeOff, LockKeyhole, ShieldCheck } from "lucide-react";
import { useLocation, useNavigate } from "react-router";
import { ApiClientError } from "@/lib/api";
import { useAuth } from "./AuthProvider";

const REMEMBERED_LOGIN_ID = "metawork.rememberedLoginId";

interface LoginLocationState {
  from?: string;
}

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { login, settings } = useAuth();
  const loginIdId = useId();
  const passwordId = useId();
  const [loginId, setLoginId] = useState("");
  const [password, setPassword] = useState("");
  const [rememberId, setRememberId] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ loginId?: string; password?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    const remembered = localStorage.getItem(REMEMBERED_LOGIN_ID);
    if (remembered) {
      setLoginId(remembered);
      setRememberId(true);
    }
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors: { loginId?: string; password?: string } = {};
    if (!loginId.trim()) nextErrors.loginId = "아이디를 입력하세요.";
    if (!password) nextErrors.password = "비밀번호를 입력하세요.";
    setFieldErrors(nextErrors);
    setFormError(null);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    try {
      const user = await login({ loginId: loginId.trim(), password });
      if (rememberId) localStorage.setItem(REMEMBERED_LOGIN_ID, loginId.trim());
      else localStorage.removeItem(REMEMBERED_LOGIN_ID);

      const state = location.state as LoginLocationState | null;
      navigate(user.mustChangePassword ? "/change-password" : (state?.from ?? "/dashboard"), {
        replace: true,
      });
    } catch (error) {
      if (error instanceof ApiClientError) {
        if (error.code === "INVALID_CREDENTIALS") {
          setPassword("");
          setFieldErrors({ password: error.message });
        } else {
          setFormError(error.message);
        }
      } else {
        setFormError("연결이 불안정합니다. 잠시 후 다시 시도하세요.");
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <main className="auth-layout">
      <section className="auth-brand" aria-label="업무트래커 소개">
        <img className="auth-brand-logo" src="/logo-inverse.png" alt="META SYSTEMS" />
        <div className="auth-brand-copy">
          <span className="auth-private-badge">
            <ShieldCheck size={14} aria-hidden="true" />
            META SYSTEMS 사내 전용
          </span>
          <h1>매주의 업무 흐름을<br />한 곳에서 연결합니다.</h1>
          <p>주간업무보고부터 회의 지시사항과 진행 현황까지 놓치지 않고 추적하세요.</p>
        </div>
        <ul className="auth-feature-list">
          <li>주간업무보고 작성과 팀 제출</li>
          <li>회의록 기반 액션아이템 배정</li>
          <li>부서별 진행 현황과 완료 추적</li>
        </ul>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-wrap">
          <img className="auth-mobile-logo" src="/logo.png" alt="META SYSTEMS" />
          <div className="auth-heading">
            <span className="auth-kicker">업무트래커</span>
            <h2>로그인</h2>
            <p>사내 계정으로 업무 현황을 확인하세요.</p>
          </div>

          {formError && (
            <div className="callout callout-danger" role="alert">
              <LockKeyhole size={18} aria-hidden="true" />
              <span>{formError}</span>
            </div>
          )}

          <form className="auth-form" onSubmit={submit} noValidate>
            <div className="field">
              <label className="field-label" htmlFor={loginIdId}>아이디</label>
              <input
                id={loginIdId}
                className="input"
                name="loginId"
                autoComplete="username"
                value={loginId}
                onChange={(event) => {
                  setLoginId(event.target.value);
                  setFieldErrors((current) => ({ ...current, loginId: undefined }));
                }}
                aria-invalid={Boolean(fieldErrors.loginId)}
                aria-describedby={fieldErrors.loginId ? loginIdId + "-error" : undefined}
                placeholder="아이디를 입력하세요"
                autoFocus
              />
              {fieldErrors.loginId && (
                <span className="field-error" id={loginIdId + "-error"}>{fieldErrors.loginId}</span>
              )}
            </div>

            <div className="field">
              <label className="field-label" htmlFor={passwordId}>비밀번호</label>
              <div className="input-wrap">
                <input
                  id={passwordId}
                  className="input"
                  name="password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="current-password"
                  value={password}
                  onChange={(event) => {
                    setPassword(event.target.value);
                    setFieldErrors((current) => ({ ...current, password: undefined }));
                  }}
                  aria-invalid={Boolean(fieldErrors.password)}
                  aria-describedby={fieldErrors.password ? passwordId + "-error" : undefined}
                  placeholder="비밀번호를 입력하세요"
                />
                <button
                  className="input-addon"
                  type="button"
                  onClick={() => setShowPassword((current) => !current)}
                  aria-label={showPassword ? "비밀번호 숨기기" : "비밀번호 보기"}
                >
                  {showPassword ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
                </button>
              </div>
              {fieldErrors.password && (
                <span className="field-error" id={passwordId + "-error"}>{fieldErrors.password}</span>
              )}
            </div>

            <label className="checkbox auth-remember">
              <input
                type="checkbox"
                checked={rememberId}
                onChange={(event) => setRememberId(event.target.checked)}
              />
              <span>아이디 저장</span>
            </label>

            <button className="btn btn-primary btn-lg btn-block" type="submit" disabled={submitting}>
              {submitting && <span className="spinner" aria-hidden="true" />}
              {submitting ? "로그인 중…" : "로그인"}
            </button>
          </form>

          <div className="auth-help">
            <strong>비밀번호를 잊으셨나요?</strong>
            <p>비밀번호 찾기는 제공하지 않습니다. 시스템 관리자에게 초기화를 요청하세요.</p>
          </div>
          <p className="auth-policy">
            {settings.loginMaxFailures}회 연속 실패 시 {settings.loginLockMinutes}분간 로그인이 제한됩니다.
          </p>
        </div>
      </section>
    </main>
  );
}
