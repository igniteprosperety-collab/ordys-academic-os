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

**Proibido:** copiar integralmente um repositório sobre o outro; substituir `src/integrations/*`, `src/start.ts`, `src/server.ts` ou arquivos de ambiente do Lovable com versões da origem privada; assumir que Git Sync publica migrations ou Edge Functions.

A reconciliação deve ser seletiva, com commits pequenos, diff revisado e caminho de rollback.

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
2. Teste de regressão para o cenário de erro primário seguido de falha de liberação.
3. Workflow de CI permanente com typecheck, testes, lint, build, aplicação local das migrations e pgTAP.
4. CLI Supabase fixado na versão 3.2.0 e ações de CI fixadas por SHA para evitar consultas variáveis a `latest`.
5. Notificações nativas passaram a exigir opt-in explícito no espelho público. O Google Play deve ativá-las explicitamente; o APK direto permanece desativado por padrão.

A correção equivalente de notificações está na PR Draft [#331](https://github.com/igniteprosperety-collab/ordys-academy.app/pull/331) do repositório privado. A correção equivalente do lease de exclusão e o teste estão na branch Draft da PR [#320](https://github.com/igniteprosperety-collab/ordys-academy.app/pull/320). Essas PRs não foram mescladas porque a CI privada ainda não executa etapas.

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

**Não fazer:** reset remoto, aplicar 46 migrations em lote, editar ledger por suposição, executar migrations financeiras em produção ou remover o trigger de confirmação de e-mail antes de comprovar entrega normal de Gmail com Auto-confirm desativado.

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

### Gate 5 — idade, IA e privacidade

A data de nascimento em `profiles.birth_date` é editável pelo próprio usuário; por isso, não é prova confiável de idade. O gate de 18+ que depende desse campo pode ser contornado por alteração do perfil.

Até haver um modelo de age assurance/consentimento adequado à audiência real e revisão de privacidade/ECA Digital:
- não habilitar Plus nem cobrança;
- não liberar novas capacidades que enviem dados acadêmicos à OpenAI;
- não declarar que a proteção etária está concluída;
- manter política, termos, retenção e canal de suporte como itens de aceite da V1.

Issues internas relevantes: #318 (runner privado), #322 (reconciliação de origem), #323 (age assurance), #324 (worker Asaas) e #92 (privacidade, termos e menores).

## O que pode ser concluído sem acesso do proprietário ou do Lovable

- Código isolado, testes unitários, typecheck, lint e build.
- Testes pgTAP e migrations em Supabase local descartável.
- Correções nas branches públicas ou Drafts privados, sem merge/publicação.
- Revisão estática de rotas, secrets, flags, permissões e contratos entre front-end/Edge Functions.
- Scripts e documentação de aceite para E2E e Android.

## Dependências que não podem ser simuladas

- Acesso read-only ao banco real e backup restaurável.
- Configuração/entrega real de e-mail de confirmação.
- Sessão autenticada no preview ou ambiente de homologação.
- Runner privado e execução de CI no repositório oficial.
- Secrets de release e fingerprint da chave Android.
- Instalação/atualização num aparelho físico.
- Decisão e revisão sobre idade, consentimento, privacidade e IA.

Essas dependências não foram alteradas nesta rodada. Nenhum banco remoto, secret, Edge Function, cobrança Asaas, publicação Lovable ou aparelho foi modificado.

## Regra de execução

Não repetir os gates verdes. Cada rodada seguinte deve atuar no primeiro bloqueio ainda aberto e terminar com evidência: commit, resultado de teste, comparação de schema, execução E2E ou aceite de dispositivo. Código compilado, PR mergeable, migration criada ou build configurado nunca contam como deploy ou lançamento.
