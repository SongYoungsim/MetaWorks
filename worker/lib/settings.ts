import { inArray } from "drizzle-orm";
import { settings } from "../db/schema";
import type { Db } from "../env";

/** 운영 설정 기본값 (기능명세 F-ADM-05). DB 값이 있으면 덮어쓴다. */
export const DEFAULT_SETTINGS = {
  "report.deadline": { weekday: 5, time: "18:00" },
  "report.reminderTime": { weekday: 5, time: "09:00" },
  "action.overdueDays": 14,
  "password.minLength": 8,
  "password.requireSpecial": true,
  "login.maxFailures": 5,
  "login.lockMinutes": 10,
  "session.idleHours": 8,
  "session.maxDays": 7,
  "ai.dailyLimit": 200,
} as const;

export type SettingKey = keyof typeof DEFAULT_SETTINGS;
type SettingValue<K extends SettingKey> = (typeof DEFAULT_SETTINGS)[K] extends number
  ? number
  : (typeof DEFAULT_SETTINGS)[K] extends boolean
    ? boolean
    : (typeof DEFAULT_SETTINGS)[K];

export type AppSettings = { [K in SettingKey]: SettingValue<K> };

export async function loadSettings<K extends SettingKey>(
  db: Db,
  keys: K[],
): Promise<Pick<AppSettings, K>> {
  const rows = await db.select().from(settings).where(inArray(settings.key, keys));
  const result = {} as Record<string, unknown>;
  for (const k of keys) result[k] = DEFAULT_SETTINGS[k];
  for (const row of rows) {
    try {
      result[row.key] = JSON.parse(row.value);
    } catch {
      /* 잘못된 값은 기본값 유지 */
    }
  }
  return result as Pick<AppSettings, K>;
}
