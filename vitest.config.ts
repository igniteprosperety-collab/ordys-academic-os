import { defineConfig } from "vitest/config";
import "dotenv/config";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"], testTimeout: 20000 },
});
