import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __E2E__: "false" },
  test: { include: ["tests/unit/**/*.test.ts"] },
});
