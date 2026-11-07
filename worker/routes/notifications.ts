import { Hono } from "hono";
import { and, desc, eq, lt, sql } from "drizzle-orm";
import type { NotificationListResponse } from "@shared/types";
import { notifications } from "../db/schema";
import type { AppEnv } from "../env";
import { Errors } from "../lib/errors";
import { requireAuth } from "../middleware/session";

const PAGE_SIZE = 20;
const RETENTION_MS = 90 * 86_400_000;

function parseId(value: string): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw Errors.badRequest("올바르지 않은 알림입니다.");
  return id;
}

export const notificationRoutes = new Hono<AppEnv>()
  .use("*", requireAuth())
  .get("/", async (c) => {
    const user = c.var.user!;
    const cursorText = c.req.query("cursor")?.trim();
    const cursor = cursorText ? parseId(cursorText) : null;
    const conditions = [eq(notifications.recipientId, user.id)];
    if (cursor) conditions.push(lt(notifications.id, cursor));
    const rows = await c.var.db.select({
      id: notifications.id,
      type: notifications.type,
      message: notifications.message,
      link: notifications.link,
      isRead: notifications.isRead,
      createdAt: notifications.createdAt,
    }).from(notifications).where(and(...conditions))
      .orderBy(desc(notifications.id)).limit(PAGE_SIZE + 1);
    const unread = await c.var.db.select({ count: sql<number>`count(*)` }).from(notifications)
      .where(and(eq(notifications.recipientId, user.id), eq(notifications.isRead, false))).get();
    c.executionCtx.waitUntil(
      c.var.db.delete(notifications).where(lt(notifications.createdAt, Date.now() - RETENTION_MS)).run(),
    );
    const hasMore = rows.length > PAGE_SIZE;
    const items = rows.slice(0, PAGE_SIZE);
    return c.json<NotificationListResponse>({
      items,
      unreadCount: Number(unread?.count ?? 0),
      nextCursor: hasMore ? items.at(-1)!.id : null,
    });
  })
  .patch("/:id/read", async (c) => {
    const id = parseId(c.req.param("id"));
    const result = await c.var.db.update(notifications).set({ isRead: true }).where(and(
      eq(notifications.id, id), eq(notifications.recipientId, c.var.user!.id),
    )).returning({ id: notifications.id }).get();
    if (!result) throw Errors.notFound();
    return c.json({ id });
  })
  .post("/read-all", async (c) => {
    await c.var.db.update(notifications).set({ isRead: true }).where(and(
      eq(notifications.recipientId, c.var.user!.id), eq(notifications.isRead, false),
    ));
    return c.json({ ok: true });
  });
