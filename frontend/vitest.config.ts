import { defineConfig } from "vitest/config";

// 測試環境：純 Node + fake-indexeddb。不使用 vitest 的 UI/API 伺服器 (--ui / --api)。
export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.ts"],
  },
});
