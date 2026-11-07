import { Hono } from "hono";
import { eq, and, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { departments, employees, sessions } from "../db/schema";
import type { AppEnv, EmployeeRow, Db } from "../env";
import { hashPassword, verifyPassword } from "../lib/crypto";
import { ApiError, Errors } from "../lib/errors";
import { loadSettings } from "../lib/settings";
import { writeAudit } from "../lib/audit";
import { clientIp, endSession, requireAuth, startSession } from "../middleware/session";
import { checkPasswordRules } from "@shared/password";
import type { PublicSettings, SessionUser } from "@shared/types";

const loginSchema = z.object({
  loginId: z.string().trim().min(1, "아이디를 입력하세요.").max(50),
  password: z.string().min(1, "비밀번호를 입력하세요.").max(200),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(1, "새 비밀번호를 입력하세요.").max(200),
});

export async function toSessionUser(db: Db, e: EmployeeRow): Promise<SessionUser> {
  const dept = e.departmentId
    ? await db
        .select({ id: departments.id, code: departments.code, name: departments.name })
        .from(departments)
        .where(eq(departments.id, e.departmentId))
        .get()
    : null;
  return {
    id: e.id,
    loginId: e.loginId,
    name: e.name,
    role: e.role,
    position: e.position,
    isClerk: e.isClerk,
    isAdmin: e.isAdmin,
    status: e.status,
    mustChangePassword: e.mustChangePassword,
    department: dept ?? null,
  };
}

export const authRoutes = new Hono<AppEnv>()
  /** 로그인 화면용 공개 설정 (안내 문구 · 비밀번호 규칙) */
  .get("/settings", async (c) => {
    const s = await loadSettings(c.var.db, [
      "password.minLength",
      "password.requireSpecial",
      "login.maxFailures",
      "login.lockMinutes",
    ]);
    return c.json<PublicSettings>({
      passwordMinLength: s["password.minLength"],
      passwordRequireSpecial: s["password.requireSpecial"],
      loginMaxFailures: s["login.maxFailures"],
      loginLockMinutes: s["login.lockMinutes"],
    });
  })

  /** F-LGN-01 · F-LGN-02 로그인 · 실패 · 잠금 */
  .post("/login", async (c) => {
    const parsed = loginSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      throw Errors.badRequest(parsed.error.issues[0]?.message ?? "입력값을 확인하세요.");
    }
    const { loginId, password } = parsed.data;
    const db = c.var.db;
    const ip = clientIp(c);
    const { "login.maxFailures": maxFailures, "login.lockMinutes": lockMinutes } =
      await loadSettings(db, ["login.maxFailures", "login.lockMinutes"]);

    const emp = await db
      .select()
      .from(employees)
      .where(sql`lower(${employees.loginId}) = ${loginId.toLowerCase()}`)
      .get();

    const invalid = (remaining?: number) =>
      new ApiError(
        401,
        "INVALID_CREDENTIALS",
        remaining === undefined
          ? "아이디 또는 비밀번호가 맞지 않습니다."
          : `아이디 또는 비밀번호가 맞지 않습니다. (남은 시도 ${remaining}회)`,
        remaining === undefined ? {} : { remainingAttempts: remaining },
      );

    if (!emp) {
      await writeAudit(db, { actorId: null, action: "auth.login_failed", targetType: "login", targetId: loginId, ip });
      throw invalid();
    }

    const nowMs = Date.now();
    if (emp.lockedUntil && emp.lockedUntil > nowMs) {
      const minutes = Math.ceil((emp.lockedUntil - nowMs) / 60_000);
      throw new ApiError(423, "LOCKED", `로그인이 제한되었습니다. ${minutes}분 후 다시 시도하세요.`, {
        lockedMinutes: minutes,
      });
    }

    if (emp.status === "inactive") {
      throw new ApiError(403, "INACTIVE", "사용이 중지된 계정입니다. 시스템 관리자에게 문의하세요.");
    }

    const ok = await verifyPassword(password, emp.passwordHash);
    if (!ok) {
      const failures = emp.failedLoginCount + 1;
      if (failures >= maxFailures) {
        await db
          .update(employees)
          .set({ failedLoginCount: 0, lockedUntil: nowMs + lockMinutes * 60_000, updatedAt: nowMs })
          .where(eq(employees.id, emp.id));
        await writeAudit(db, { actorId: emp.id, action: "auth.locked", targetType: "employee", targetId: emp.id, ip });
        throw new ApiError(
          423,
          "LOCKED",
          `로그인 시도 횟수를 초과했습니다. ${lockMinutes}분 후 다시 시도하세요.`,
          { lockedMinutes: lockMinutes },
        );
      }
      await db
        .update(employees)
        .set({ failedLoginCount: failures, updatedAt: nowMs })
        .where(eq(employees.id, emp.id));
      await writeAudit(db, { actorId: emp.id, action: "auth.login_failed", targetType: "employee", targetId: emp.id, ip });
      throw invalid(maxFailures - failures);
    }

    await db
      .update(employees)
      .set({ failedLoginCount: 0, lockedUntil: null, lastLoginAt: nowMs, updatedAt: nowMs })
      .where(eq(employees.id, emp.id));
    await startSession(c, emp.id);
    await writeAudit(db, { actorId: emp.id, action: "auth.login", targetType: "employee", targetId: emp.id, ip });

    return c.json(await toSessionUser(db, { ...emp, failedLoginCount: 0, lockedUntil: null, lastLoginAt: nowMs }));
  })

  /** F-LGN-04 로그아웃 */
  .post("/logout", async (c) => {
    await endSession(c);
    return c.json({ ok: true });
  })

  /** 현재 사용자 */
  .get("/me", requireAuth({ allowPendingPassword: true }), async (c) => {
    return c.json(await toSessionUser(c.var.db, c.var.user!));
  })

  /** F-LGN-05 비밀번호 변경 (첫 로그인 / 일반 변경) */
  .post("/change-password", requireAuth({ allowPendingPassword: true }), async (c) => {
    const parsed = changePasswordSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      throw Errors.badRequest(parsed.error.issues[0]?.message ?? "입력값을 확인하세요.");
    }
    const { currentPassword, newPassword } = parsed.data;
    const db = c.var.db;
    const user = c.var.user!;

    // 일반 변경은 현재 비밀번호 확인 필수
    if (!user.mustChangePassword) {
      if (!currentPassword || !(await verifyPassword(currentPassword, user.passwordHash))) {
        throw Errors.badRequest("현재 비밀번호가 맞지 않습니다.", { currentPassword: "현재 비밀번호가 맞지 않습니다." });
      }
    }

    const policy = await loadSettings(db, ["password.minLength", "password.requireSpecial"]);
    const sameAsCurrent = await verifyPassword(newPassword, user.passwordHash);
    const failed = checkPasswordRules(
      newPassword,
      { loginId: user.loginId, sameAsCurrent },
      { minLength: policy["password.minLength"], requireSpecial: policy["password.requireSpecial"] },
    ).filter((r) => !r.ok);
    if (failed.length > 0) {
      throw Errors.badRequest(`비밀번호 규칙을 확인하세요: ${failed.map((r) => r.label).join(", ")}`, {
        newPassword: failed[0].label,
      });
    }

    const nowMs = Date.now();
    await db
      .update(employees)
      .set({
        passwordHash: await hashPassword(newPassword),
        mustChangePassword: false,
        status: user.status === "pending" ? "active" : user.status,
        passwordChangedAt: nowMs,
        updatedAt: nowMs,
      })
      .where(eq(employees.id, user.id));

    // 다른 기기의 세션은 종료
    await db
      .delete(sessions)
      .where(and(eq(sessions.employeeId, user.id), ne(sessions.id, c.var.sessionId!)));

    await writeAudit(db, {
      actorId: user.id,
      action: "auth.password_changed",
      targetType: "employee",
      targetId: user.id,
      ip: clientIp(c),
    });

    const updated = await db.select().from(employees).where(eq(employees.id, user.id)).get();
    return c.json(await toSessionUser(db, updated!));
  });
