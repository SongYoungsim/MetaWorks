import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

/**
 * 단위 테스트는 Cloudflare 개발 서버를 띄우지 않는다.
 * Worker 통합 테스트는 API 구현 단계에서 별도 프로젝트로 추가한다.
 */
export default defineConfig({
  resolve: {
    alias: {
      "@shared": fileURLToPath(new URL("./shared", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["shared/**/*.test.ts", "worker/**/*.test.ts", "web/**/*.test.ts?(x)"],
    coverage: {
      reporter: ["text", "html"],
    },
  },
});
