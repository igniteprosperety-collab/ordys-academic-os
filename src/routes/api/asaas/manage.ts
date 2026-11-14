import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/asaas/manage")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleManage } = await import("@/lib/asaas/manage.server");
        return handleManage(request);
      },
    },
  },
});
