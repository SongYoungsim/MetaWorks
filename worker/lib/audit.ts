import { auditLogs } from "../db/schema";
import type { Db } from "../env";

export interface AuditInput {
  actorId: number | null;
  action: string;
  targetType?: string;
  targetId?: string | number;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}

/** 감사 로그 기록 (기능명세 F-COM-10). 실패해도 본 요청은 막지 않는다. */
export async function writeAudit(db: Db, input: AuditInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      actorId: input.actorId,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId === undefined ? null : String(input.targetId),
      before: input.before === undefined ? null : JSON.stringify(input.before),
      after: input.after === undefined ? null : JSON.stringify(input.after),
      ip: input.ip ?? null,
    });
  } catch (err) {
    console.error("audit log failed", err);
  }
}
