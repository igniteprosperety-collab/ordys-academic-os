# Ordys Academy — plano acelerado de finalização da V1

**Atualização:** 20/11/2026  
**Objetivo:** liberar uma V1 utilizável sem reconstruir o que já existe, sem perder dados e sem criar uma terceira origem de código.

## Decisão executiva

A V1 será o núcleo individual do estudante. A ordem é: estabilizar a origem do código, reconciliar o banco real, provar autenticação e persistência, testar a versão de distribuição e só então publicar.

Não ampliar o escopo enquanto os fluxos centrais não forem aceitos. Não trocar framework, banco ou hospedagem. Não aplicar migrations remotas por lote. Não mesclar código de um repositório no outro sem revisão seletiva.

## Arquitetura real e fontes de código

Há duas origens diferentes; não devem ser tratadas como repositórios intercambiáveis.

| Origem | Função atual | Regra |
| --- | --- | --- |
| `igniteprosperety-collab/ordys-academic-os` | Espelho público conectado ao projeto Lovable; contém o front-end TanStack, rotas web/API, as migrations e os testes que foram validados nesta rodada | É a origem que o Lovable reconhece hoje. Preservar integração de preview, autenticação gerada e variáveis próprias. |
| `igniteprosperety-collab/ordys-academy.app` | Repositório privado oficial; contém Edge Functions Supabase, código de backend, Capacitor, configuração Android e workflows de APK direto/Google Play | É a origem privada para backend e distribuição Android. Não torná-la pública nem sobrescrevê-la com o espelho. |

O projeto Lovable continua sem créditos de edição e não está publicado. A sincronização de commits anteriormente observada não prova deploy, estado do banco ou execução de Edge Functions.

**Distinção confirmada pela documentação oficial em 20/11/2026:** Git sync move código para a branch vinculada; commits nessa branch aparecem no projeto/preview do editor, mas o Git sync **não** implanta Edge Functions modificadas, não executa migrations adicionadas pelo Git e não publica o site. Para Edge Functions, o fluxo gerenciado documentado é solicitar o deploy no chat do projeto e conferir o resultado em **More → Database → Manage → Edge functions**; migrations exigem a operação pelo chat ou SQL Editor. Em aplicações TanStack Start, mudanças nas server functions e rotas do app vão ao ar no Publish, enquanto Edge Functions antigas continuam em serviço até serem migradas. Fontes: [Git sync — backend files in commits e Publish](https://docs.lovable.dev/integrations/git-sync-overview) e [Edge Functions — TanStack Start e deployment](https://docs.lovable.dev/features/edge-functions).

Assim, a PR #2 mesclada no `main` pode aparecer no preview apenas se `main` for a branch atualmente vinculada e sincronizada; isso ainda não foi verificado nesta sessão. A alteração não está publicada nem ativa no app.

**Bloqueio adicional de implantação confirmado em 20/11:** o workflow privado `.github/workflows/deploy-ordys-assistant.yml` rejeita explicitamente o projeto gerenciado `yqljcoukgpqdoxiispyn` no passo de configuração. Ele orienta usar o fluxo suportado do Lovable Cloud e encerra antes de vincular o projeto, executar migrations, gravar secrets ou publicar Edge Functions. Portanto, o GitHub não é atualmente um caminho independente de deploy para o backend gerenciado. Não remover esse bloqueio nem trocar o project ID como atalho. Registro: [Issue #332](https://github.com/igniteprosperety-collab/ordys-academy.app/issues/332).

**Proibido:** copiar integralmente um repositório sobre o outro; substituir `src/integrations/*`, `src/start.ts`, `src/server.ts` ou arquivos de ambiente do Lovable com versões da origem privada; assumir que Git Sync publica migrations ou Edge Functions.

A reconciliação deve ser seletiva, com commits pequenos, diff revisado e caminho de rollback.

## Auditoria estática dos contratos Edge Function — 20/11/2026

Os cinco endpoints invocados pelo espelho público foram cruzados com as funções e a configuração versionadas em `ordys-academy.app/main`. Isso confirma compatibilidade de nomes/payloads no código, não confirma que as versões estejam implantadas no projeto gerenciado.

| Função | Payload do frontend | Proteção/configuração em código | Estado funcional observado |
| --- | --- | --- | --- |
| `ordys-assistant` | Ações `ask`, `quiz`, `poll`, `cancel`, `apply-config`; sessão Supabase | `verify_jwt=true`; função também valida usuário e propriedade dos jobs | Assistência gratuita ainda chama OpenAI com gate de 18 anos baseado em `profiles.birth_date` editável; Plus continua desligado |
| `ordys-video-transcribe` | `filename`, `mimeType`, `dataUrl` | `verify_jwt=true`; valida sessão, idade e entitlement no servidor | Plus desligado; o cliente não envia transcrição e o servidor a rejeita |
| `ordys-ai-report` | `source`, `reason`, `content`, `details` | `verify_jwt=true`; valida usuário e tamanho, grava por RPC | Botão do frontend está oculto por feature flag `false`; o endpoint armazena relato, não chama OpenAI |
| `ordys-password-recovery` | `email`, `redirectTo` | `verify_jwt=false` intencional; valida formato, destino permitido e rate limit via RPC; sempre usa Auth para e-mails válidos não limitados | Fluxo público com proteção própria contra enumeração e abuso; requer configuração `ORDYS_PUBLIC_APP_URL` correta para redirect web |
| `ordys-delete-account` | Corpo vazio `{}` | `verify_jwt=true`; valida sessão do usuário, cancela/concilia billing se instalado e só então chama `delete_own_data` e Auth Admin | Contrato de exclusão depende do pareamento correto entre migrations e Edge Function; ver Gate 2 e Issue #322 |

A configuração verificada em Git define `verify_jwt=false` apenas para recuperação de senha e endpoints financeiros públicos (webhook/return), que estão fora deste conjunto V1. Não tratar a presença dessas definições no repositório como confirmação de deployment. Os nomes dos secrets e suas permissões foram revisados estaticamente; valores secretos não foram lidos nem expostos.

**Risco que permanece:** o gate de 18+ do Assistente usa data de nascimento editável pelo titular. O servidor repete a checagem, mas a fonte de idade não é verificação independente. Não declarar a questão de idade/consentimento resolvida.

## Escopo da V1

### Entra na primeira entrega

- Cadastro, confirmação de e-mail, login, recuperação de senha e logout.
- Perfil e preferências do estudante.
- Disciplinas, tópicos e progresso.
- Tarefas e subtarefas.
- Provas, notas e frequência.
- Agenda, planejamento, sessões de foco e revisões.
- Metas, check-in e desempenho.
- Persistência após fechar/reabrir e isolamento entre contas.
- Exclusão de conta sem perda parcial silenciosa ou repetição insegura.

### Fica fora da liberação inicial

- Ordys Plus, checkout, cobranças e ativação comercial Asaas.
- Recursos avançados pagos e entitlement Plus.
- Workspace docente, turmas, convites, submissões e devolutivas.
- Upload de fotos/arquivos de estudantes.
- Push/notificações Android até o perfil de distribuição e permissões estarem aceitos em aparelho.
- Recursos que enviam conteúdo acadêmico à OpenAI até que a questão de idade/consentimento tenha uma solução verificável e revisada.

A exclusão desses fluxos da V1 não autoriza apagar tabelas, colunas, relações ou dados docentes que já existem.

## Evidências técnicas obtidas em 20/11/2026

| Verificação | Resultado | Escopo exato |
| --- | --- | --- |
| TypeScript | **PASS** | `bun run typecheck` no espelho público |
| Testes unitários | **PASS** | `bun run test` |
| Lint e formatação | **PASS** | `bun run lint` |
| Build de produção | **PASS** | `bun run build` |
| Migrations | **PASS** | 46 migrations aplicadas em Supabase local, descartável, partindo de banco vazio |
| Data API anônima | **PASS** | 49/49 testes REST contra Supabase local, sem sessão de usuário |
| RLS / isolamento autenticado | **PASS** | 17/17 asserções pgTAP com dois usuários sintéticos; leitura, inserção, atualização, exclusão, identidade forjada e vínculo entre contas |
| CI completo do espelho | **PASS** | Execução [44693888138](https://github.com/igniteprosperety-collab/ordys-academic-os/actions/runs/44693888138), SHA `bb6b3edc98d4176e1d5dc66dbb87a4f9bc4a0c84a9` |
| Correção do cliente Assistente/exclusão | **PASS / MERGED** | [PR #2](https://github.com/igniteprosperety-collab/ordys-academic-os/pull/2) mesclada por squash no commit `c70601ac54a6f54452e08ecf443a92acf44ebfac`; run [44700553334](https://github.com/igniteprosperety-collab/ordys-academic-os/actions/runs/44700553334) e validação do `main` [44728950746](https://github.com/igniteprosperety-collab/ordys-academic-os/actions/runs/44728950746) concluíram sucesso nos dois jobs: typecheck, 89 testes unitários, lint, build, 46 migrations locais, 49 testes Data API e 17 pgTAP |
| Deploy das Edge Functions no projeto ativo | **BLOQUEADO** | O workflow privado recusa o projeto gerenciado; Git sync não implanta Edge Functions nem migrations. O caminho oficial é deploy pelo chat Lovable e verificação no painel; nenhuma função/migration foi implantada nesta rodada. Issue #332 |
| Notificações nativas no espelho | **PASS** | Padrão desligado; opt-in explícito; kill-switch de desativação; testes unitários |
| Arquivo de ambiente versionado | **PASS** | Os seis nomes existentes são públicos e allowlisted; novos nomes não permitidos bloqueiam a CI; `.env` é ignorado para novos arquivos locais |
| CI do repositório privado | **BLOQUEADO** | Jobs falham antes de alocar runner; Issue #318. Nenhuma etapa de teste/build foi executada nessa origem. |
| Banco Supabase remoto | **NÃO VERIFICADO** | Nenhuma migration ou escrita remota foi feita nesta rodada |
| Auth/persistência em sessão real | **NÃO ACEITO** | Preview autenticado não foi acessível; o endereço de preview redirecionou ao login do Lovable |
| APK assinado e aparelho | **NÃO ACEITO** | Workflows e configuração Android existem na origem privada, mas nenhum artefato final foi construído/instalado nesta rodada |
| Publicação | **NÃO FEITA** | O projeto Lovable permanece não publicado |

Execução completa de CI aprovada: https://github.com/igniteprosperety-collab/ordys-academic-os/actions/runs/44693888138

O teste de banco mais recente terminou com:
- 46 migrations aplicadas sem erro em base descartável;
- `tests/data-isolation.test.ts`: 49 testes contra a Data API local;
- `supabase/tests/ordys_student_core_rls_test.sql`: 17 testes pgTAP;
- `Result: PASS` para pgTAP;
- stack local parada ao final.
  
O teste HTTP usa somente a URL local e a chave anônima da instância descartável. Nenhuma URL, chave ou dado do projeto remoto é utilizado.

Isso prova que a cadeia SQL é executável em uma base limpa e que as regras testadas isolam as duas identidades sintéticas. **Não prova** que o schema remoto corresponda à cadeia atual nem que todas as tabelas/fluxos estejam corretos em produção.

## Correções entregues nesta rodada

1. Tratamento do bloqueio temporário na exclusão de conta: erro original de conciliação/cancelamento é preservado se a tentativa de liberar o lease falhar.
2. Correção do cliente do Assistente: remoção do fallback web para `/api/ordys-assistant`, rota que não existe na árvore pública; chamadas mantidas na Edge Function autenticada e mensagens HTTP específicas preservadas.
3. A tela de exclusão passou a preservar a mensagem específica retornada pela Edge Function, sem perder os estados de exclusão inconclusiva ou parcial.
4. Teste de regressão para o cenário de erro primário seguido de falha de liberação.
5. Workflow de CI permanente com typecheck, testes, lint, build, aplicação local das migrations e pgTAP.
6. CLI Supabase fixado na versão 3.2.0 e ações de CI fixadas por SHA para evitar consultas variáveis a `latest`.
7. Notificações nativas passaram a exigir opt-in explícito no espelho público. O Google Play deve ativá-las explicitamente; o APK direto permanece desativado por padrão.

A correção do cliente web do Assistente/exclusão foi mesclada na origem pública pela [PR #2](https://github.com/igniteprosperety-collab/ordys-academic-os/pull/2), commit `c70601ac54a6f54452e08ecf443a92acf44ebfac`. Isso altera apenas o espelho público; não publica o app nem implanta Edge Functions. A correção equivalente de notificações está na PR Draft [#331](https://github.com/igniteprosperety-collab/ordys-academy.app/pull/331) do repositório privado. A correção equivalente do lease de exclusão e o teste estão na branch Draft da PR [#320](https://github.com/igniteprosperety-collab/ordys-academy.app/pull/320). Essas PRs privadas não foram mescladas porque a CI privada ainda não executa etapas.

## Caminho crítico — sem repetir trabalho aprovado

### Gate 1 — fechar a origem oficial

- Obter um mecanismo suportado para reconciliar o espelho Lovable com a origem privada.
- Manter o projeto conectado ao espelho enquanto não houver plano testado de troca/rollback.
- Portar apenas mudanças aprovadas, preservando os arquivos gerados pelo Lovable.
- Confirmar que as Edge Functions, rotas web e versão de front-end correspondem ao mesmo contrato.

Critério de saída: um commit de referência documentado para front-end, backend, migrations e configuração Android; nenhuma origem sendo tratada como substituta integral da outra.

### Gate 2 — reconciliar o banco remoto, sem alterar dados

Procedimento:
1. Confirmar o ID do projeto Supabase realmente usado pelo runtime.
2. Capturar backup/export e verificar como restaurá-lo.
3. Obter o ledger remoto atual e exportar o schema real.
4. Comparar objetos, funções, constraints, triggers, políticas, grants e migrations com a cadeia versionada.
5. Classificar cada versão/objeto como aplicado, ausente, idêntico sem registro, divergente, parcial ou não verificável.
6. Preparar somente a menor correção necessária, testar em banco descartável e usar o mecanismo suportado pelo ambiente.

Um snapshot interno de 13/11/2026 registrava 18 migrations no ledger remoto contra 35 arquivos na origem privada daquela data. Esse número é histórico, não um retrato confirmado de 20/11; precisa ser lido novamente antes de qualquer decisão.

**Comparação estática das origens Git em 20/11/2026 (não é leitura do banco remoto):** o espelho público tem 46 migrations; a origem privada tem 35. Todos os 35 caminhos compartilhados têm conteúdo idêntico por blob SHA, não há migrations exclusivas da origem privada e não há arquivos com o mesmo nome e conteúdo divergente. As 11 migrations exclusivas do espelho público são de billing/Asaas:
- `20261103010000` a `20261103030000` (serialização de exclusão, confirmação de suspensão e proteção da exclusão de dados);
- `20261105010000` a `20261105060000` (reconciliação, replay e bloqueio de eventos de billing);
- `20261111010000` e `20261112010000` (replay de webhook e worker Asaas).

Como billing/Asaas está fora do escopo da V1, não portar automaticamente essas 11 migrations à origem privada nem apagá-las do espelho. O ledger e o schema remoto continuam **não verificados**.

**Incompatibilidade de contrato descoberta na revisão detalhada:** quatro dessas migrations redefinem `public.delete_own_data()` e acrescentam guardas de billing/reconciliação:
- `20261103030000_guard_delete_own_data_billing_reconciliation.sql`
- `20261105010000_ordys_guard_delete_own_data_unmatched_webhooks.sql`
- `20261105060000_ordys_block_checkout_with_unreconciled_webhooks.sql`
- `20261112010000_ordys_asaas_cron_worker.sql`

Quando os objetos de billing existem, as versões posteriores exigem uma reserva/processing lease válido para a exclusão e incluem verificações de eventos não reconciliados. A Edge Function em `main` do repositório privado ainda usa `supabase/functions/_shared/ordys-delete-account-billing.ts` antigo: consulta o status e cancela checkouts/assinaturas, mas não chama `ordys_reserve_account_deletion`, `ordys_claim_account_deletion_processing`, `ordys_release_account_deletion_processing` nem `ordys_has_unreconciled_billing_events`. Assim, aplicar essas migrations em um banco com billing e manter a Edge Function privada atual pode fazer `delete_own_data()` rejeitar a exclusão por ausência do lease.

A implementação privada que contém a sequência reserva → claim → cancelamento/reconciliação → liberação está apenas na branch da PR Draft [#320](https://github.com/igniteprosperety-collab/ordys-academy.app/pull/320), cuja CI privada ainda não executa. Isso não prova o estado do banco remoto, que continua sem leitura/ledger verificado. A divergência foi registrada também na [Issue #322](https://github.com/igniteprosperety-collab/ordys-academy.app/issues/322).

**Gate obrigatório:** não aplicar essas migrations ao remoto nem implantar a Edge Function antiga sem antes reconciliar schema/ledger e alinhar a versão de backend ao contrato SQL; testar exclusão de conta, checkout concorrente, webhooks pendentes e retentativas em ambiente descartável.

**Não fazer:** reset remoto, aplicar 46 migrations em lote, editar ledger por suposição, executar migrations financeiras em produção ou remover o trigger de confirmação de e-mail antes de comprovar entrega normal de Gmail com Auto-confirm desativado.

### Gate 2B — Auth e entrega real de e-mail

A origem privada possui uma proteção explícita para não remover o mecanismo temporário de auto-confirmação antes de a entrega normal do Supabase Auth ser comprovada.

- A migration `20261029233000_remove_untracked_auto_confirm_email.sql` remove o trigger não versionado `ordys_auto_confirm_email_trigger` e a função `public.ordys_auto_confirm_email()`. Depois dela, novas contas dependem da confirmação real do endereço.
- O workflow privado exige a confirmação manual `email_confirmation_delivery_verified=true`. Enquanto essa confirmação não for dada e a migration ainda não estiver no ledger remoto, ele retira do lote **essa migration e todas as posteriores**, preservando a ordem das versões.
- O workflow também exige a declaração manual `production_backup_verified=true` depois de exportar um backup completo para fora do Lovable, abri-lo ou validar sua integridade e armazená-lo fora da plataforma.
- Antes de deploy, o verificador lê a configuração Auth real (sem imprimir segredos) e falha se: signup ou email auth estiverem desligados; Auto-confirm estiver ligado; senha mínima for menor que 8; HIBP/leaked-password protection ou secure email-change estiverem desligados; Google OAuth estiver sem Client ID/Secret; callback nativo Android ou callbacks web exatos estiverem ausentes; Site URL não corresponder à origem oficial; SMTP customizado estiver parcialmente preenchido/inválido.
- SMTP customizado totalmente ausente gera aviso, não aprovação da entrega: a própria auditoria exige testar cadastro e recuperação com um Gmail comum, fora da equipe, antes do release. Sem origem web oficial configurada, recuperação no browser permanece fail-closed; o deep-link Android continua disponível.
- A query `scripts/queries/auth-trigger-readiness.sql` detecta o trigger/função por nome ou por referência a `email_confirmed_at`, sem ler linhas de `auth.users`, tokens ou credenciais. Os testes `tests/auth-trigger-readiness.test.ts` e `tests/supabase-auth-config.test.ts` cobrem o escopo da query e os critérios da auditoria.

**Estado atual:** os guardrails e testes existem no código privado, mas nenhum Gmail externo foi validado nesta rodada, nenhum backup remoto foi exportado/verificado por esta sessão e o deploy do Lovable Cloud continua indisponível pelo fluxo GitHub. Portanto, não aprovar a remoção do trigger, não destravar a migration `20261029233000` e não marcar Auth de produção como aceita.

### Gate 3 — autenticação e persistência ponta a ponta

Usar contas sintéticas:
- cadastro → e-mail de confirmação → login;
- recuperação → nova senha → login;
- logout → login;
- criar/editar/excluir disciplinas, tarefas, provas e registros acadêmicos;
- fechar/reabrir e confirmar persistência;
- alternar entre duas contas e comprovar que nenhuma vê ou altera dados da outra;
- validar expiração de sessão, falha de rede e recuperação.

O pgTAP atual é uma base forte para isolamento, mas não substitui E2E com o Auth e o front-end reais.

### Gate 4 — distribuição correta

O repositório privado já possui `capacitor.config.ts`, geração do Android e workflows separados:
- APK de instalação direta;
- cliente Google Play.

Não recriar esse pipeline no espelho público. Antes do release privado:
- resolver CI/runner privado;
- validar configuração de signing e fingerprint;
- gerar artefato a partir de SHA aprovado;
- conferir hash e permissões;
- instalar e atualizar em aparelho Android real com Play Protect ativo;
- concluir o roteiro `docs/ANDROID-DEVICE-ACCEPTANCE.md`.

Notificações: o APK direto deve permanecer sem as permissões de notificação. O Google Play só habilita notificações por opt-in explícito e após aceite do manifesto.

**Auditoria estática dos workflows Android em 20/11/2026:**

- `capacitor.config.ts` usa `appId=app.ordys.academy`, bundle estático local em `mobile-dist/client` e não define `server.url`; o APK não depende de abrir o preview Lovable como servidor remoto.
- `Build ORDYS Android Direct Install Release` é manual, exige os cinco secrets de assinatura (keystore Base64, senha do keystore, alias, senha da chave e fingerprint SHA-256 esperado), rejeita certificado debug/teste, valida assinatura v2/v3, package, target SDK 36, label, deep link, launcher, permissões e hash, e publica somente APK + SHA-256 (retenção de 14 dias).
- `Build ORDYS Android` é manual e define `versionCode`/ `versionName` antes de gerar APK e AAB; o AAB compila novamente o cliente com notificações disponíveis para opt-in, mantém permissões de lembretes e remove permissões de alarmes exatos. APK e AAB são verificados contra o mesmo fingerprint esperado.
- O manifesto do APK direto remove `POST_NOTIFICATIONS`, `RECEIVE_BOOT_COMPLETED`, `WAKE_LOCK`, `SCHEDULE_EXACT_ALARM` e `USE_EXACT_ALARM`; o AAB Google Play mantém as três permissões de notificações e remove os dois tipos de alarmes exatos.
- Os dois workflows são código versionado apenas. Nenhum foi executado com runner privado nesta rodada, nenhum APK/AAB foi gerado e nenhuma chave de assinatura foi lida.

**Bloqueio adicional encontrado no APK direto:** o workflow de instalação direta chama `npx cap add android` e `assembleRelease`, mas não define `versionCode` nem `versionName`. O template oficial do Capacitor 8.5.2 usado pelo projeto define por padrão `versionCode 1` e `versionName "1.0"`. Ao contrário do workflow Google Play, o direto não injeta um número crescente; portanto, uma atualização posterior do mesmo pacote, assinada pela mesma chave, pode ser rejeitada pelo Android por não ter versionCode superior. Issue [#333](https://github.com/igniteprosperety-collab/ordys-academy.app/issues/333) registra a correção necessária: definir versão crescente no workflow, acrescentar regressão estática e validar os valores no APK final.

**Conclusão do Gate 4:** manter o APK direto bloqueado até corrigir o versionCode, restaurar CI privada, configurar/validar a assinatura permanente, gerar o APK com SHA aprovado e executar instalação + atualização sobre versão anterior em aparelho real com Play Protect ativo. O AAB da Play também requer as mesmas verificações de assinatura, build e aceite, além da validação específica de permissões e revisão da ficha/conta de desenvolvedor.

### Gate 5 — idade, IA e privacidade

A data de nascimento em `profiles.birth_date` é editável pelo próprio usuário; por isso, não é prova confiável de idade. O gate de 18+ que depende desse campo pode ser contornado por alteração do perfil.

Até haver um modelo de age assurance/consentimento adequado à audiência real e revisão de privacidade/ECA Digital:
- não habilitar Plus nem cobrança;
- não liberar novas capacidades que enviem dados acadêmicos à OpenAI;
- não declarar que a proteção etária está concluída;
- manter política, termos, retenção e canal de suporte como itens de aceite da V1.

Issues internas relevantes: #318 (runner privado), #322 (reconciliação de origem), #323 (age assurance), #324 (worker Asaas), #332 (deploy bloqueado pelo projeto Lovable Cloud) e #92 (privacidade, termos e menores).

## O que pode ser concluído sem acesso do proprietário ou do Lovable

- Código isolado, testes unitários, typecheck, lint e build.
- Revisão estática dos contratos de chamadas Edge Function e identificação dos endpoints de backend necessários à V1.
- Testes pgTAP e migrations em Supabase local descartável.
- Correções nas branches públicas ou Drafts privados, sem merge/publicação.
- Revisão estática de rotas, secrets, flags, permissões e contratos entre front-end/Edge Functions.
- Scripts e documentação de aceite para E2E e Android.

## Dependências que não podem ser simuladas

- Acesso read-only ao banco real e backup restaurável.
- Configuração/entrega real de e-mail de confirmação.
- Sessão autenticada no preview ou ambiente de homologação.
- Runner privado e execução de CI no repositório oficial.
- Acesso ao fluxo suportado Lovable Cloud para implantar e verificar migrations/Edge Functions; o workflow Supabase CLI do repositório privado recusa o project ID gerenciado.
- Secrets de release e fingerprint da chave Android.
- Instalação/atualização num aparelho físico.
- Decisão e revisão sobre idade, consentimento, privacidade e IA.

Essas dependências não foram alteradas nesta rodada. Nenhum banco remoto, secret, Edge Function, cobrança Asaas, publicação Lovable ou aparelho foi modificado.

## Regra de execução

Não repetir os gates verdes. Cada rodada seguinte deve atuar no primeiro bloqueio ainda aberto e terminar com evidência: commit, resultado de teste, comparação de schema, execução E2E ou aceite de dispositivo. Código compilado, PR mergeable, migration criada ou build configurado nunca contam como deploy ou lançamento.
