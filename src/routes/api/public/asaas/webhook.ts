import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/asaas/webhook")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleWebhook } = await import("@/lib/asaas/webhook.server");
        return handleWebhook(request);
      },
    },
  },
});
