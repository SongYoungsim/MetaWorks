import { Hono } from "hono";
import { and, asc, count, eq, inArray, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { departments, employees, sessions } from "../db/schema";
import type { AppEnv, Db } from "../env";
import { writeAudit } from "../lib/audit";
import { generateTempPassword, hashPassword } from "../lib/crypto";
import { Errors } from "../lib/errors";
import { clientIp, requireAdmin, requireAuth } from "../middleware/session";
import { EMPLOYEE_NUMBER_MESSAGE, isEmployeeNumber, normalizeEmployeeNumber } from "@shared/employee";
import type {
  DepartmentOption,
  EmployeeAdminItem,
  EmployeeBulkCreateResponse,
  EmployeeCredentialResult,
  EmployeeListResponse,
} from "@shared/types";

const roleSchema = z.enum(["member", "leader", "executive"]);
const statusSchema = z.enum(["active", "pending", "inactive"]);

const createEmployeeSchema = z.object({
  name: z.string().trim().min(1).max(20),
  loginId: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z][A-Z0-9]{3,19}$/, "아이디는 영문으로 시작하는 영문 대문자·숫자 4~20자여야 합니다."),
  empNo: z.string().trim().min(1, "사번을 입력하세요.").transform(normalizeEmployeeNumber)
    .refine(isEmployeeNumber, EMPLOYEE_NUMBER_MESSAGE),
  departmentId: z.number().int().positive().nullable(),
  position: z.string().trim().min(1).max(30),
  role: roleSchema,
  isClerk: z.boolean(),
  isAdmin: z.boolean(),
  replaceLeader: z.boolean().optional(),
});

const updateEmployeeSchema = z.object({
  name: z.string().trim().min(1).max(20),
  departmentId: z.number().int().positive().nullable(),
  position: z.string().trim().min(1).max(30),
  role: roleSchema,
  isClerk: z.boolean(),
  isAdmin: z.boolean(),
  status: statusSchema,
  replaceLeader: z.boolean().optional(),
});
const bulkEmployeeSchema = z.object({
  items: z.array(createEmployeeSchema.omit({ replaceLeader: true }).extend({
    initialPassword: z.string().min(1, "비밀번호를 입력하세요.").max(64, "비밀번호는 64자 이하여야 합니다."),
  })).min(1).max(100),
});

const employeeSelection = {
  id: employees.id,
  empNo: employees.empNo,
  loginId: employees.loginId,
  name: employees.name,
  departmentId: employees.departmentId,
  departmentName: departments.name,
  position: employees.position,
  role: employees.role,
  isClerk: employees.isClerk,
  isAdmin: employees.isAdmin,
  status: employees.status,
  mustChangePassword: employees.mustChangePassword,
  lastLoginAt: employees.lastLoginAt,
  passwordChangedAt: employees.passwordChangedAt,
};

async function findEmployee(db: Db, id: number): Promise<EmployeeAdminItem | undefined> {
  return db
    .select(employeeSelection)
    .from(employees)
    .leftJoin(departments, eq(employees.departmentId, departments.id))
    .where(eq(employees.id, id))
    .get();
}

async function departmentOptions(db: Db): Promise<DepartmentOption[]> {
  return db
    .select({
      id: departments.id,
      code: departments.code,
      name: departments.name,
      leaderId: departments.leaderId,
      isActive: departments.isActive,
    })
    .from(departments)
    .orderBy(asc(departments.sortOrder), asc(departments.name));
}

async function validateDepartment(db: Db, departmentId: number | null, role: string) {
  if (role !== "executive" && departmentId === null) {
    throw Errors.badRequest("소속 팀을 선택하세요.", { departmentId: "소속 팀을 선택하세요." });
  }
  if (departmentId === null) return null;
  const department = await db.select().from(departments).where(eq(departments.id, departmentId)).get();
  if (!department || !department.isActive) {
    throw Errors.badRequest("사용 중인 팀을 선택하세요.", { departmentId: "사용 중인 팀을 선택하세요." });
  }
  return department;
}

async function ensureLeaderAvailable(
  db: Db,
  departmentId: number,
  employeeId: number | null,
  replaceLeader: boolean,
) {
  const department = await db.select().from(departments).where(eq(departments.id, departmentId)).get();
  if (department?.leaderId && department.leaderId !== employeeId && !replaceLeader) {
    const leader = await db
      .select({ name: employees.name })
      .from(employees)
      .where(eq(employees.id, department.leaderId))
      .get();
    throw Errors.conflict(
      "이미 팀장이 지정되어 있습니다. 기존 팀장을 팀원으로 변경할지 확인하세요.",
      { role: "현재 팀장: " + (leader?.name ?? "알 수 없음") },
    );
  }
  return department?.leaderId ?? null;
}

async function assignLeader(
  db: Db,
  departmentId: number,
  employeeId: number,
  previousLeaderId: number | null,
) {
  if (previousLeaderId && previousLeaderId !== employeeId) {
    await db
      .update(employees)
      .set({ role: "member", updatedAt: Date.now() })
      .where(eq(employees.id, previousLeaderId));
  }
  await db
    .update(departments)
    .set({ leaderId: employeeId, updatedAt: Date.now() })
    .where(eq(departments.id, departmentId));
}

function routeId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw Errors.badRequest("사원 번호가 올바르지 않습니다.");
  return id;
}

export const employeeRoutes = new Hono<AppEnv>()
  .use("*", requireAuth(), requireAdmin)

  .get("/", async (c) => {
    const query = c.req.query("q")?.trim().toLowerCase();
    const departmentId = Number(c.req.query("departmentId") ?? 0);
    const role = c.req.query("role");
    const status = c.req.query("status");

    let rows = await c.var.db
      .select(employeeSelection)
      .from(employees)
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .orderBy(asc(departments.sortOrder), asc(employees.name));

    if (query) {
      rows = rows.filter(
        (row) =>
          row.name.toLowerCase().includes(query) ||
          row.loginId.toLowerCase().includes(query) ||
          row.empNo.toLowerCase().includes(query),
      );
    }
    if (departmentId > 0) rows = rows.filter((row) => row.departmentId === departmentId);
    if (roleSchema.safeParse(role).success) rows = rows.filter((row) => row.role === role);
    if (statusSchema.safeParse(status).success) rows = rows.filter((row) => row.status === status);

    return c.json<EmployeeListResponse>({
      employees: rows,
      departments: await departmentOptions(c.var.db),
    });
  })

  .post("/bulk", async (c) => {
    const parsed = bulkEmployeeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const row = typeof issue?.path[1] === "number" ? Number(issue.path[1]) + 2 : null;
      throw Errors.badRequest(`${row ? `CSV ${row}행: ` : ""}${issue?.message ?? "입력값을 확인하세요."}`);
    }
    const items = parsed.data.items;
    const [departmentRows, existingEmployees] = await Promise.all([
      departmentOptions(c.var.db),
      c.var.db.select({ empNo: employees.empNo, loginId: employees.loginId }).from(employees),
    ]);
    const activeDepartments = new Map(departmentRows.filter((item) => item.isActive).map((item) => [item.id, item]));
    const empNumbers = new Set<string>();
    const loginIds = new Set<string>();
    const leaderDepartments = new Set<number>();
    const existingEmpNumbers = new Set(existingEmployees.map((item) => item.empNo));
    const existingLoginIds = new Set(existingEmployees.map((item) => item.loginId.toUpperCase()));
    for (const [index, item] of items.entries()) {
      const row = index + 2;
      if (empNumbers.has(item.empNo) || existingEmpNumbers.has(item.empNo)) throw Errors.conflict(`CSV ${row}행: 이미 사용 중이거나 파일 안에서 중복된 사번입니다.`);
      if (loginIds.has(item.loginId) || existingLoginIds.has(item.loginId)) throw Errors.conflict(`CSV ${row}행: 이미 사용 중이거나 파일 안에서 중복된 아이디입니다.`);
      empNumbers.add(item.empNo); loginIds.add(item.loginId);
      if (item.role !== "executive" && (!item.departmentId || !activeDepartments.has(item.departmentId))) throw Errors.badRequest(`CSV ${row}행: 사용 중인 소속 팀을 선택하세요.`);
      if (item.departmentId && !activeDepartments.has(item.departmentId)) throw Errors.badRequest(`CSV ${row}행: 사용 중인 소속 팀을 선택하세요.`);
      if (item.role === "leader" && item.departmentId) {
        const department = activeDepartments.get(item.departmentId)!;
        if (department.leaderId) throw Errors.conflict(`CSV ${row}행: ${department.name}에는 이미 팀장이 지정되어 있습니다.`);
        if (leaderDepartments.has(item.departmentId)) throw Errors.conflict(`CSV ${row}행: 같은 팀의 팀장은 한 명만 등록할 수 있습니다.`);
        leaderDepartments.add(item.departmentId);
      }
    }
    const now = Date.now();
    const credentials = await Promise.all(items.map(async (item) => {
      const temporaryPassword = item.initialPassword;
      return { item, temporaryPassword, passwordHash: await hashPassword(temporaryPassword) };
    }));
    const statements: D1PreparedStatement[] = [];
    for (const entry of credentials) {
      const item = entry.item;
      statements.push(c.env.DB.prepare(`INSERT INTO employees
        (emp_no, login_id, name, department_id, position, role, is_clerk, is_admin, status, password_hash, must_change_password, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, 1, ?, ?)`)
        .bind(item.empNo, item.loginId, item.name, item.departmentId, item.position, item.role,
          item.isClerk ? 1 : 0, item.isAdmin ? 1 : 0, entry.passwordHash, now, now));
      if (item.role === "leader" && item.departmentId) {
        statements.push(c.env.DB.prepare(`UPDATE departments SET leader_id =
          (SELECT id FROM employees WHERE login_id = ?), updated_at = ? WHERE id = ?`)
          .bind(item.loginId, now, item.departmentId));
      }
    }
    await c.env.DB.batch(statements);
    const createdRows = await c.var.db.select(employeeSelection).from(employees)
      .leftJoin(departments, eq(employees.departmentId, departments.id))
      .where(inArray(employees.loginId, items.map((item) => item.loginId)));
    const createdMap = new Map(createdRows.map((item) => [item.loginId, item]));
    const result = credentials.map((entry) => ({ employee: createdMap.get(entry.item.loginId)!, temporaryPassword: entry.temporaryPassword }));
    await writeAudit(c.var.db, { actorId: c.var.user!.id, action: "employee.bulk_create", targetType: "employee",
      after: { count: result.length, empNos: result.map((item) => item.employee.empNo) }, ip: clientIp(c) });
    return c.json<EmployeeBulkCreateResponse>({ credentials: result }, 201);
  })

  .post("/", async (c) => {
    const parsed = createEmployeeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? "입력값을 확인하세요.");
    const input = parsed.data;
    const db = c.var.db;
    await validateDepartment(db, input.departmentId, input.role);

    const duplicateLogin = await db
      .select({ id: employees.id })
      .from(employees)
      .where(sql`upper(${employees.loginId}) = ${input.loginId}`)
      .get();
    if (duplicateLogin) {
      throw Errors.conflict("이미 사용 중인 아이디입니다.", { loginId: "이미 사용 중인 아이디입니다." });
    }

    const empNo = input.empNo;
    const duplicateEmpNo = await db
      .select({ id: employees.id })
      .from(employees)
      .where(eq(employees.empNo, empNo))
      .get();
    if (duplicateEmpNo) {
      throw Errors.conflict("이미 사용 중인 사번입니다.", { empNo: "이미 사용 중인 사번입니다." });
    }

    const previousLeaderId =
      input.role === "leader" && input.departmentId
        ? await ensureLeaderAvailable(db, input.departmentId, null, input.replaceLeader === true)
        : null;
    const temporaryPassword = generateTempPassword();
    const nowMs = Date.now();
    const inserted = await db
      .insert(employees)
      .values({
        empNo,
        loginId: input.loginId,
        name: input.name,
        departmentId: input.departmentId,
        position: input.position,
        role: input.role,
        isClerk: input.isClerk,
        isAdmin: input.isAdmin,
        status: "pending",
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        createdAt: nowMs,
        updatedAt: nowMs,
      })
      .returning({ id: employees.id })
      .get();

    if (input.role === "leader" && input.departmentId) {
      await assignLeader(db, input.departmentId, inserted.id, previousLeaderId);
    }

    const employee = await findEmployee(db, inserted.id);
    await writeAudit(db, {
      actorId: c.var.user!.id,
      action: "employee.create",
      targetType: "employee",
      targetId: inserted.id,
      after: employee,
      ip: clientIp(c),
    });
    return c.json<EmployeeCredentialResult>({ employee: employee!, temporaryPassword }, 201);
  })

  .patch("/:id", async (c) => {
    const id = routeId(c.req.param("id"));
    const parsed = updateEmployeeSchema.safeParse(await c.req.json().catch(() => ({})));
    if (!parsed.success) throw Errors.badRequest(parsed.error.issues[0]?.message ?? "입력값을 확인하세요.");
    const input = parsed.data;
    const db = c.var.db;
    const before = await findEmployee(db, id);
    if (!before) throw Errors.notFound();
    await validateDepartment(db, input.departmentId, input.role);

    const removingAdmin = before.isAdmin && (!input.isAdmin || input.status === "inactive");
    if (removingAdmin) {
      const adminCount = await db
        .select({ count: count() })
        .from(employees)
        .where(and(eq(employees.isAdmin, true), ne(employees.status, "inactive")))
        .get();
      if (Number(adminCount?.count ?? 0) <= 1) {
        throw Errors.conflict("최소 1명의 시스템 관리자가 필요합니다.", {
          isAdmin: "마지막 관리자의 권한은 해제할 수 없습니다.",
        });
      }
    }

    const previousLeaderId =
      input.role === "leader" && input.departmentId
        ? await ensureLeaderAvailable(db, input.departmentId, id, input.replaceLeader === true)
        : null;

    await db
      .update(employees)
      .set({
        name: input.name,
        departmentId: input.departmentId,
        position: input.position,
        role: input.role,
        isClerk: input.isClerk,
        isAdmin: input.isAdmin,
        status: input.status,
        updatedAt: Date.now(),
      })
      .where(eq(employees.id, id));

    if (
      before.role === "leader" &&
      before.departmentId &&
      (input.role !== "leader" || input.departmentId !== before.departmentId)
    ) {
      await db
        .update(departments)
        .set({ leaderId: null, updatedAt: Date.now() })
        .where(and(eq(departments.id, before.departmentId), eq(departments.leaderId, id)));
    }
    if (input.role === "leader" && input.departmentId) {
      await assignLeader(db, input.departmentId, id, previousLeaderId);
    }
    if (input.status === "inactive") {
      await db.delete(sessions).where(eq(sessions.employeeId, id));
    }

    const employee = await findEmployee(db, id);
    await writeAudit(db, {
      actorId: c.var.user!.id,
      action: "employee.update",
      targetType: "employee",
      targetId: id,
      before,
      after: employee,
      ip: clientIp(c),
    });
    return c.json(employee!);
  })

  .post("/:id/reset-password", async (c) => {
    const id = routeId(c.req.param("id"));
    const db = c.var.db;
    const before = await findEmployee(db, id);
    if (!before) throw Errors.notFound();

    const temporaryPassword = generateTempPassword();
    await db
      .update(employees)
      .set({
        passwordHash: await hashPassword(temporaryPassword),
        mustChangePassword: true,
        status: "pending",
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: Date.now(),
      })
      .where(eq(employees.id, id));
    await db.delete(sessions).where(eq(sessions.employeeId, id));

    const employee = await findEmployee(db, id);
    await writeAudit(db, {
      actorId: c.var.user!.id,
      action: "employee.reset_password",
      targetType: "employee",
      targetId: id,
      ip: clientIp(c),
    });
    return c.json<EmployeeCredentialResult>({ employee: employee!, temporaryPassword });
  });
