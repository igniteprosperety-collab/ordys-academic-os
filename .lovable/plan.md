# Plano: importação seletiva da main oficial do ORDYS

## Acesso verificado (somente leitura, 06/11 01:15 UTC)
- Conexão: "Prosperety's GitHub API" (OAuth). Está ativa e acessível, mas ainda não está vinculada ao projeto. Para ler, o vínculo não é necessário.
- Repositório `igniteprosperety-collab/ordys-academy.app`, branch `main`: HTTP 200.
- SHA lido: `13d353269103411fad213890c449ef5a4578569e`, assinatura verificada. Árvore `7b3c5338…`, lida por completo e sem truncamento.
- Arquivos de entrada lidos às 01:13 UTC, todos existem:
  - `package.json` (blob `42f3c0d`): Capacitor 8.5.2, zod 4.6.7, react-start 1.168.60.
  - `src/routes/auth.tsx` (blob `7503680`): e-mail/senha, cadastro, reenvio de confirmação, link para recuperação, Google.
  - `src/integrations/supabase/client.ts` (blob `a5751b5`): sem o armazenamento de sessão da preview do Lovable; usa `public-config.ts` com o mesmo backend `yqljcoukgpqdoxiispyn`.
- O Git Sync deste projeto continua no repositório interno do Lovable (`4e874bc`).

## Comparação
- Iguais: 109 arquivos, incluindo `vite.config.ts`.
- Diferentes: 41.
- Só na main: rotas `redefinir-senha`, `excluir-conta`, `privacidade` e `assistente`; os arquivos de `src/lib` `native-auth`, `signup-confirmation`, `password-recovery-session`, `ordys-session` e `demo-supabase`; os componentes `brand-lockup` e `ai-content-report-button`; 15 migrations, 9 Edge Functions, Capacitor e `mobile/`.
- Só aqui: `src/integrations/lovable/index.ts`, `src/lib/quiz.functions.ts` e `components/ui/avatar.tsx`.

## O que será importado (após aprovação)
1. Telas: `auth`, `index`, `agenda`, `tarefas`, `disciplinas`, `estudos`, `simulado`, `desempenho`, `perfil`, `redefinir-senha`, `privacidade` e `excluir-conta`.
2. `src/components/ordys/*`, `src/hooks/use-auth.ts`, os arquivos de `src/lib/*` usados pelas telas, `src/styles.css`, ícones em `public/` e `tests/` (exceto os testes de Android e billing).
3. Merge manual de `package.json`, `__root.tsx`, `start.ts` (mantendo o envio do token de login) e `server.ts`.

## O que será preservado (não sobrescrito)
`.env`, `supabase/config.toml`, `src/routeTree.gen.ts`, `src/integrations/lovable/index.ts` e todos os arquivos gerados em `src/integrations/supabase/` (`client.ts`, `client.server.ts`, `auth-middleware.ts`, `auth-attacher.ts`, `previewAuthStorage.ts`, `types.ts`).

## Fora desta etapa
Migrations, Edge Functions, billing/Asaas, assistente IA, `mobile/`, `capacitor.config.ts`, `vite.mobile.config.ts` e `.github/`. Nada é aplicado no banco ou no Auth, e nada é publicado.

## Adaptações necessárias
- **Google na web:** usar o login do Google pelo Lovable. A main chama o Supabase direto, o que exige credenciais próprias do Google, não verificadas. O fluxo nativo do `native-auth.ts` fica intacto para o Android.
- **Uso do backend:** os imports de `public-config.ts` passam a usar o `client.ts` gerado.
- **Telas que dependem de migrations não aplicadas:** proteger contra colunas ausentes. Cada caso será listado antes de mexer.

## Validação
Build e testes. Na preview, com sessão real, nesta ordem: login/cadastro, calendário, tarefas, disciplinas, estudos e simulados. Paro antes de publicar.

## Bloqueios conhecidos
- Confirmação de e-mail real depende de uma migration autorizada que remove a auto-confirmação e da configuração de envio de e-mails.
- Ainda preciso da decisão sobre o Google na web. O padrão proposto é o login pelo Lovable.
