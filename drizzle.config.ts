import { defineConfig } from "drizzle-kit";

// 마이그레이션 SQL 생성 전용 (DB 접속 불필요). 적용은 wrangler d1 migrations apply 로 한다.
export default defineConfig({
  dialect: "sqlite",
  schema: "./worker/db/schema.ts",
  out: "./migrations",
});
