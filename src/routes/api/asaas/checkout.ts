import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/asaas/checkout")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleCheckout } = await import("@/lib/asaas/checkout.server");
        return handleCheckout(request);
      },
    },
  },
});
