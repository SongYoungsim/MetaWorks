import { Hono } from "hono";
import { and, eq } from "drizzle-orm";
import { actionItems, actionProgress, aiConversations, aiMessages, attachments, meetings, titleWeekEntries, weeklyReports } from "../db/schema";
import type { AppEnv } from "../env";
import { writeAudit } from "../lib/audit";
import { Errors } from "../lib/errors";
import { clientIp, requireAuth } from "../middleware/session";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_FILE_BYTES = 20 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);
const EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

function parseId(value: unknown): number {
  const id = Number(value);
  if (!Number.isInteger(id) || id < 1) throw Errors.badRequest("올바르지 않은 주간 기록입니다.");
  return id;
}

export const fileRoutes = new Hono<AppEnv>()
  .use("*", requireAuth())
  .post("/progress-attachments", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    const progressId = parseId(form.get("progressId"));
    if (!(file instanceof File)) throw Errors.badRequest("첨부할 파일을 선택하세요.");
    if (file.size < 1 || file.size > MAX_FILE_BYTES) throw Errors.badRequest("파일은 20MB 이하만 첨부할 수 있습니다.");
    const row = await c.var.db.select({ progress: actionProgress, action: actionItems })
      .from(actionProgress).innerJoin(actionItems, eq(actionProgress.actionId, actionItems.id))
      .where(eq(actionProgress.id, progressId)).get();
    const user = c.var.user!;
    if (!row) throw Errors.notFound();
    if (user.departmentId !== row.action.departmentId) throw Errors.forbidden();
    const suffix = file.name.includes(".") ? "." + file.name.split(".").pop()!.replace(/[^a-z0-9]/gi, "").slice(0, 10) : "";
    const key = "file-" + crypto.randomUUID() + suffix;
    await c.env.FILES.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
      customMetadata: { fileName: file.name.slice(0, 200), uploadedBy: String(user.id) },
    });
    try {
      const inserted = await c.var.db.insert(attachments).values({
        ownerType: "progress", ownerId: progressId, r2Key: key,
        fileName: file.name.slice(0, 200), mimeType: file.type || "application/octet-stream",
        size: file.size, uploadedBy: user.id,
      }).returning({ id: attachments.id }).get();
      return c.json({ id: inserted.id, fileName: file.name, mimeType: file.type || "application/octet-stream",
        size: file.size, url: "/api/files/" + key }, 201);
    } catch (error) {
      await c.env.FILES.delete(key);
      throw error;
    }
  })
  .post("/attachments", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    const meetingId = parseId(form.get("meetingId"));
    if (!(file instanceof File)) throw Errors.badRequest("첨부할 파일을 선택하세요.");
    if (file.size < 1 || file.size > MAX_FILE_BYTES) throw Errors.badRequest("파일은 20MB 이하만 첨부할 수 있습니다.");
    const meeting = await c.var.db.select().from(meetings).where(eq(meetings.id, meetingId)).get();
    const user = c.var.user!;
    if (!meeting) throw Errors.notFound();
    if (!user.isClerk || meeting.clerkId !== user.id) throw Errors.forbidden();
    const suffix = file.name.includes(".") ? "." + file.name.split(".").pop()!.replace(/[^a-z0-9]/gi, "").slice(0, 10) : "";
    const key = "file-" + crypto.randomUUID() + suffix;
    await c.env.FILES.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type || "application/octet-stream" },
      customMetadata: { fileName: file.name.slice(0, 200), uploadedBy: String(user.id) },
    });
    try {
      const inserted = await c.var.db.insert(attachments).values({
        ownerType: "meeting", ownerId: meetingId, r2Key: key,
        fileName: file.name.slice(0, 200), mimeType: file.type || "application/octet-stream",
        size: file.size, uploadedBy: user.id,
      }).returning({ id: attachments.id, createdAt: attachments.createdAt }).get();
      await writeAudit(c.var.db, {
        actorId: user.id, action: "file.attachment_upload", targetType: "meeting",
        targetId: meetingId, after: { key, size: file.size }, ip: clientIp(c),
      });
      return c.json({ id: inserted.id, fileName: file.name, mimeType: file.type || "application/octet-stream",
        size: file.size, url: "/api/files/" + key, createdAt: inserted.createdAt }, 201);
    } catch (error) {
      await c.env.FILES.delete(key);
      throw error;
    }
  })
  .delete("/attachments/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const row = await c.var.db.select().from(attachments).where(and(
      eq(attachments.id, id), eq(attachments.ownerType, "meeting"),
    )).get();
    if (!row?.ownerId) throw Errors.notFound();
    const meeting = await c.var.db.select().from(meetings).where(eq(meetings.id, row.ownerId)).get();
    const user = c.var.user!;
    if (!meeting) throw Errors.notFound();
    if (!user.isClerk || meeting.clerkId !== user.id) throw Errors.forbidden();
    await c.env.FILES.delete(row.r2Key);
    await c.var.db.delete(attachments).where(eq(attachments.id, id));
    await writeAudit(c.var.db, {
      actorId: user.id, action: "file.attachment_delete", targetType: "meeting",
      targetId: row.ownerId, before: { key: row.r2Key, fileName: row.fileName }, ip: clientIp(c),
    });
    return c.body(null, 204);
  })
  .post("/images", async (c) => {
    const form = await c.req.formData();
    const file = form.get("file");
    const ownerType = form.get("ownerType") === "meeting" ? "meeting" : "entry";
    const ownerId = parseId(form.get("ownerId") ?? form.get("entryId"));
    if (!(file instanceof File)) throw Errors.badRequest("이미지 파일을 선택하세요.");
    if (!IMAGE_TYPES.has(file.type)) throw Errors.badRequest("PNG, JPG, GIF, WebP 이미지만 첨부할 수 있습니다.");
    if (file.size < 1 || file.size > MAX_IMAGE_BYTES) throw Errors.badRequest("이미지는 10MB 이하만 첨부할 수 있습니다.");

    const user = c.var.user!;
    let canEdit = false;
    if (ownerType === "meeting") {
      const meeting = await c.var.db.select().from(meetings).where(eq(meetings.id, ownerId)).get();
      if (!meeting) throw Errors.notFound();
      canEdit = user.isClerk && meeting.clerkId === user.id;
    } else {
      const row = await c.var.db
        .select({ entry: titleWeekEntries, report: weeklyReports })
        .from(titleWeekEntries)
        .innerJoin(weeklyReports, eq(titleWeekEntries.reportId, weeklyReports.id))
        .where(eq(titleWeekEntries.id, ownerId)).get();
      if (!row) throw Errors.notFound();
      canEdit = row.report.status === "draft" && user.departmentId === row.report.departmentId
        && (user.role === "leader" || (user.role === "member" && row.entry.ownerId === user.id));
    }
    if (!canEdit) throw Errors.forbidden();

    const key = "image-" + crypto.randomUUID() + "." + EXTENSION[file.type];
    await c.env.FILES.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: file.type },
      customMetadata: { fileName: file.name.slice(0, 200), uploadedBy: String(user.id) },
    });
    try {
      await c.var.db.insert(attachments).values({
        ownerType,
        ownerId,
        r2Key: key,
        fileName: file.name.slice(0, 200),
        mimeType: file.type,
        size: file.size,
        uploadedBy: user.id,
      });
    } catch (error) {
      await c.env.FILES.delete(key);
      throw error;
    }
    await writeAudit(c.var.db, {
      actorId: user.id, action: "file.image_upload", targetType: ownerType,
      targetId: ownerId, after: { key, mimeType: file.type, size: file.size }, ip: clientIp(c),
    });
    return c.json({ url: "/api/files/" + key, fileName: file.name }, 201);
  })
  .get("/:key", async (c) => {
    const key = c.req.param("key");
    if ((!key.startsWith("image-") && !key.startsWith("file-")) || key.includes("/") || key.includes("..")) throw Errors.notFound();
    const attachment = await c.var.db.select().from(attachments).where(eq(attachments.r2Key, key)).get();
    if (attachment?.ownerType === "ai") {
      const owner = await c.var.db.select({ employeeId: aiConversations.employeeId }).from(aiMessages)
        .innerJoin(aiConversations, eq(aiMessages.conversationId, aiConversations.id))
        .where(and(eq(aiMessages.id, attachment.ownerId!), eq(aiConversations.employeeId, c.var.user!.id))).get();
      if (!owner) throw Errors.forbidden();
    }
    const object = await c.env.FILES.get(key);
    if (!object) throw Errors.notFound();
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("ETag", object.httpEtag);
    headers.set("Cache-Control", "private, max-age=3600");
    headers.set("X-Content-Type-Options", "nosniff");
    if (key.startsWith("file-")) {
      const name = object.customMetadata?.fileName ?? "attachment";
      headers.set("Content-Disposition", "attachment; filename*=UTF-8''" + encodeURIComponent(name));
    }
    return new Response(object.body, { headers });
  });
