import { Hono } from "hono";
import { csrf } from "hono/csrf";
import { secureHeaders } from "hono/secure-headers";
import { drizzle } from "drizzle-orm/d1";
import { ZodError } from "zod";
import * as schema from "./db/schema";
import type { AppEnv } from "./env";
import { ApiError } from "./lib/errors";
import { loadSession } from "./middleware/session";
import { authRoutes } from "./routes/auth";
import { employeeRoutes } from "./routes/employees";
import { masterRoutes } from "./routes/master";
import { reportRoutes } from "./routes/reports";
import { fileRoutes } from "./routes/files";
import { meetingRoutes } from "./routes/meetings";
import { actionRoutes } from "./routes/actions";
import { notificationRoutes } from "./routes/notifications";
import { dashboardRoutes } from "./routes/dashboard";
import { aiRoutes } from "./routes/ai";
import { runAutomatedNotifications } from "./jobs/notifications";

const app = new Hono<AppEnv>().basePath("/api");

app.use("*", secureHeaders());
// 쿠키 세션 CSRF 방지: 변경 요청의 Origin 이 같은 호스트인지 검사
app.use("*", csrf());
app.use("*", async (c, next) => {
  c.set("db", drizzle(c.env.DB, { schema }));
  await next();
});
app.use("*", loadSession);

app.get("/health", (c) => c.json({ ok: true, env: c.env.APP_ENV }));
app.route("/auth", authRoutes);
app.route("/employees", employeeRoutes);
app.route("/master", masterRoutes);
app.route("/reports", reportRoutes);
app.route("/files", fileRoutes);
app.route("/meetings", meetingRoutes);
app.route("/actions", actionRoutes);
app.route("/notifications", notificationRoutes);
app.route("/dashboard", dashboardRoutes);
app.route("/ai", aiRoutes);

app.notFound((c) => c.json({ error: { code: "NOT_FOUND", message: "API 경로를 찾을 수 없습니다." } }, 404));

app.onError((err, c) => {
  if (err instanceof ApiError) {
    return c.json({ error: { code: err.code, message: err.message, ...err.extra } }, err.status);
  }
  if (err instanceof ZodError) {
    return c.json({ error: { code: "BAD_REQUEST", message: err.issues[0]?.message ?? "입력값을 확인하세요." } }, 400);
  }
  console.error(err);
  const code = crypto.randomUUID().slice(0, 8);
  return c.json(
    { error: { code: "INTERNAL", message: `일시적인 오류가 발생했습니다. (오류 코드: ${code})` } },
    500,
  );
});

export default {
  fetch: app.fetch,
  scheduled: (controller, env, ctx) => {
    ctx.waitUntil(runAutomatedNotifications(drizzle(env.DB, { schema }), controller.scheduledTime, env.FILES));
  },
} satisfies ExportedHandler<AppEnv["Bindings"]>;
