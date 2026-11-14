import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["ports/asaas-pr320/tests/**/*.test.ts"],
    exclude: [
      "ports/asaas-pr320/tests/ordys-asaas-db-worker.integration.test.ts",
      "ports/asaas-pr320/tests/ordys-billing-webhook.integration.test.ts",
      "ports/asaas-pr320/tests/ordys-billing-security.test.ts",
    ],
    testTimeout: 20000,
  },
});
