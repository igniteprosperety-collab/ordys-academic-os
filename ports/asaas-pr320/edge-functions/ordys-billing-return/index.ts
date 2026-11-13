const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

const messages: Record<string, { title: string; body: string }> = {
  success: {
    title: "Checkout finalizado",
    body: "O Asaas está enviando a confirmação financeira ao Ordys. Volte ao aplicativo, abra Perfil → Assinatura e atualize o status. O redirecionamento, sozinho, não libera o acesso.",
  },
  cancelled: {
    title: "Checkout cancelado",
    body: "Nenhuma assinatura foi ativada por este redirecionamento. Você pode voltar ao Ordys e tentar novamente quando estiver pronto.",
  },
  expired: {
    title: "Checkout expirado",
    body: "Este checkout expirou. Volte ao Ordys para iniciar uma nova contratação.",
  },
};

Deno.serve((request) => {
  if (request.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (request.method !== "GET") {
    return new Response("Método não permitido.", {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const status = new URL(request.url).searchParams.get("status") ?? "";
  const message = messages[status] ?? {
    title: "Retorno do Ordys",
    body: "Volte ao aplicativo Ordys e consulte sua assinatura em Perfil → Assinatura.",
  };

  const html =
    '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<meta name="referrer" content="no-referrer"><title>' + message.title + ' · Ordys Academy</title>' +
    '<style>:root{color-scheme:dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#0A1128;color:#fff}' +
    'body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}' +
    'main{width:min(100%,440px);padding:28px;border:1px solid #29324a;border-radius:18px;background:#14161F}' +
    'h1{font-size:22px;line-height:1.25;margin:0 0 12px}p{font-size:14px;line-height:1.65;color:#c7ccda;margin:0}' +
    'strong{display:block;margin-top:24px;font-size:12px;letter-spacing:.08em;color:#8ea9ff}</style></head>' +
    '<body><main><strong>ORDYS ACADEMY</strong><h1>' + message.title + '</h1><p>' + message.body +
    '</p></main></body></html>';

  return new Response(html, {
    status: 200,
    headers: {
      ...corsHeaders,
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
});
