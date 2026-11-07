import { createMiddleware } from "hono/factory";
import { getCookie, setCookie, deleteCookie } from "hono/cookie";
import type { Context } from "hono";
import { eq } from "drizzle-orm";
import { employees, sessions } from "../db/schema";
import type { AppEnv } from "../env";
import { randomToken, sha256Hex } from "../lib/crypto";
import { Errors } from "../lib/errors";
import { loadSettings } from "../lib/settings";

export const SESSION_COOKIE = "mw_session";
const TOUCH_INTERVAL_MS = 5 * 60 * 1000; // last_seen 갱신 최소 간격 (D1 쓰기 절감)

export function clientIp(c: Context<AppEnv>): string | null {
  return c.req.header("CF-Connecting-IP") ?? null;
}

/** 세션 생성 + 쿠키 발급 */
export async function startSession(c: Context<AppEnv>, employeeId: number): Promise<void> {
  const { "session.maxDays": maxDays } = await loadSettings(c.var.db, ["session.maxDays"]);
  const token = randomToken();
  const id = await sha256Hex(token);
  const nowMs = Date.now();
  await c.var.db.insert(sessions).values({
    id,
    employeeId,
    createdAt: nowMs,
    lastSeenAt: nowMs,
    expiresAt: nowMs + maxDays * 86_400_000,
    ip: clientIp(c),
    userAgent: c.req.header("User-Agent")?.slice(0, 300) ?? null,
  });
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: maxDays * 86_400,
  });
}

export async function endSession(c: Context<AppEnv>): Promise<void> {
  if (c.var.sessionId) {
    await c.var.db.delete(sessions).where(eq(sessions.id, c.var.sessionId));
  }
  deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
}

/**
 * 모든 /api 요청에서 세션을 읽어 c.var.user 를 채운다. (인증 강제는 requireAuth)
 * 만료 조건: 절대 만료(expires_at) 또는 유휴 시간 초과, 비활성 사원.
 */
export const loadSession = createMiddleware<AppEnv>(async (c, next) => {
  c.set("user", null);
  c.set("sessionId", null);
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const id = await sha256Hex(token);
    const row = await c.var.db
      .select({ session: sessions, employee: employees })
      .from(sessions)
      .innerJoin(employees, eq(sessions.employeeId, employees.id))
      .where(eq(sessions.id, id))
      .get();
    if (row) {
      const nowMs = Date.now();
      const { "session.idleHours": idleHours } = await loadSettings(c.var.db, ["session.idleHours"]);
      const expired =
        row.session.expiresAt < nowMs ||
        nowMs - row.session.lastSeenAt > idleHours * 3_600_000 ||
        row.employee.status === "inactive";
      if (expired) {
        await c.var.db.delete(sessions).where(eq(sessions.id, id));
        deleteCookie(c, SESSION_COOKIE, { path: "/", secure: true });
      } else {
        c.set("user", row.employee);
        c.set("sessionId", id);
        if (nowMs - row.session.lastSeenAt > TOUCH_INTERVAL_MS) {
          c.executionCtx.waitUntil(
            c.var.db.update(sessions).set({ lastSeenAt: nowMs }).where(eq(sessions.id, id)).run(),
          );
        }
      }
    }
  }
  await next();
});

/** 로그인 필수. 임시 비밀번호 상태면 allowPendingPassword 인 라우트만 허용 (F-COM-09) */
export function requireAuth(options: { allowPendingPassword?: boolean } = {}) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const user = c.var.user;
    if (!user) throw Errors.unauthorized();
    if (user.mustChangePassword && !options.allowPendingPassword) {
      throw Errors.mustChangePassword();
    }
    await next();
  });
}

/** 시스템 관리자 전용 */
export const requireAdmin = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.var.user?.isAdmin) throw Errors.forbidden();
  await next();
});
