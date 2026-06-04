import { defineConfig } from "vitest/config";

export default defineConfig({
  root: "frontend",
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"]
  }
});
