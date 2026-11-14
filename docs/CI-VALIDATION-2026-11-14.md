# Verificação da base estudantil do Ordys

Esta rotina valida somente o snapshot que o projeto Lovable atualmente utiliza (`f5a658cd49d17c2afcbf4b285c9632c05f463a64`) no repositório legado já público.

O workflow em `.github/workflows/ordys-student-core-free-ci.yml` executa a suíte Vitest, ESLint e build de produção em runner padrão do GitHub para repositório público.

As variáveis `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `VITE_SUPABASE_URL` e `VITE_SUPABASE_PUBLISHABLE_KEY` são explicitamente vazias no runner. Assim, `tests/data-isolation.test.ts` não ativa chamadas à Data API real. Não são fornecidos service-role keys, secrets Asaas ou credenciais de produção.

Esta validação não substitui a CI da fonte privada `ordys-academy.app`, não testa as alterações da PR #320 e não executa migrações, Edge Functions, deploy ou publicação. O objetivo é validar a base estudantil que está efetivamente ligada ao preview atual, sem alterar o banco.
