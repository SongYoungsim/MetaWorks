import type { DrizzleD1Database } from "drizzle-orm/d1";
import type * as schema from "./db/schema";
import type { employees } from "./db/schema";

export interface Env {
  DB: D1Database;
  FILES: R2Bucket;
  AI: Ai;
  APP_ENV: string;
}

export type Db = DrizzleD1Database<typeof schema>;
export type EmployeeRow = typeof employees.$inferSelect;

export interface Variables {
  db: Db;
  user: EmployeeRow | null;
  sessionId: string | null;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
