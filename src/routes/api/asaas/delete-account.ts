import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/asaas/delete-account")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleDeleteAccount } = await import("@/lib/asaas/delete-account.server");
        return handleDeleteAccount(request);
      },
    },
  },
});
