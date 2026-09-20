import { defineConfig } from "vitest/config"
import path from "node:path"

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    env: {
      SLOT_ID_HMAC_SECRET: "test-secret-at-least-16-chars-long",
      VOICE_TOOL_SECRET: "test-tool-secret",
      BUSINESS_TIMEZONE: "America/Toronto",
      BUSINESS_NAME: "Test Clinic",
    },
  },
})
