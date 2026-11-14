import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/asaas/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleStatus } = await import("@/lib/asaas/status.server");
        return handleStatus(request);
      },
    },
  },
});
