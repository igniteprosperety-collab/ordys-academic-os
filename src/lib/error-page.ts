export function renderErrorPage(): string {
  return `<!doctype html>
<html lang="pt-BR">
  <head>
    <meta charset="utf-8" />
    <title>Não foi possível carregar</title>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <meta name="theme-color" content="#0A1128" />
    <meta name="description" content="ORDYS ACADEMY — a clareza por trás da sua rotina acadêmica." />
    <link rel="icon" href="/icon-192.png" type="image/png" />
    <style>
      :root { color-scheme: dark; }
      body {
        font: 15px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #0A1128;
        color: #F8FAFC;
        display: grid;
        place-items: center;
        min-height: 100vh;
        margin: 0;
        padding: 1.5rem;
        box-sizing: border-box;
      }
      .card {
        max-width: 28rem;
        width: 100%;
        text-align: center;
        padding: 2rem;
        box-sizing: border-box;
        border: 1px solid rgba(255,255,255,.08);
        border-radius: 1rem;
        background: rgba(255,255,255,.03);
      }
      .brand {
        font-size: .75rem;
        font-weight: 700;
        letter-spacing: .16em;
        color: #93C5FD;
        margin-bottom: .75rem;
      }
      h1 { font-size: 1.25rem; margin: 0 0 .5rem; }
      p { color: #CBD5E1; margin: 0 0 1.5rem; }
      .actions {
        display: flex;
        gap: .5rem;
        justify-content: center;
        flex-wrap: wrap;
      }
      a, button {
        padding: .625rem 1rem;
        border-radius: .5rem;
        font: inherit;
        cursor: pointer;
        text-decoration: none;
        border: 1px solid transparent;
      }
      .primary { background: #4169E1; color: #fff; }
      .secondary { background: transparent; color: #F8FAFC; border-color: rgba(255,255,255,.16); }
    </style>
  </head>
  <body>
    <main class="card">
      <div class="brand">ORDYS ACADEMY</div>
      <h1>Não foi possível carregar esta página</h1>
      <p>Ocorreu um erro inesperado. Tente novamente ou volte ao início.</p>
      <div class="actions">
        <a class="primary" href="">Tentar novamente</a>
        <a class="secondary" href="/">Voltar ao início</a>
      </div>
    </main>
  </body>
</html>`;
}
