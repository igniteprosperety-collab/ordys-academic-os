# Auditoria de planejamento: núcleo do estudante + Asaas Sandbox

## Fatos confirmados (leitura local agora, 13/11)
- HEAD do projeto: `d9ab062`. O remoto Git é o repositório interno do Lovable (projeto 39199358…); nenhum remoto aponta para `ordys-academy.app`.
- Arquivos gerados que não podem ser sobrescritos: `src/integrations/supabase/*` (client, previewAuthStorage, auth-attacher, auth-middleware, client.server, types), `src/integrations/lovable/index.ts`, `src/start.ts`, `src/server.ts`, `.env`, `supabase/config.toml`, `src/routeTree.gen.ts`.
- `supabase/migrations/` no snapshot tem só 5 arquivos (14/08 a 03/09). O ledger do banco tem 18, segundo a sua leitura. O snapshot tem menos migrations que o banco, então não há nenhuma migration "no repo e fora do ledger" aqui.
- Não existe `supabase/functions/` no snapshot. Não há código Asaas; o único resultado da busca por "asaas" é um texto em `src/routes/perfil.tsx`.
- A documentação do Lovable diz que o Git sync só cria um repositório novo e não liga um repositório existente.

## Hipóteses (não verificadas nesta rodada)
- O conteúdo das PRs #320 e #321 não foi lido agora. O que segue vem da sua descrição: 11 migrations, worker SQL-only, handlers e testes.
- As 13 migrations do ledger que faltam no snapshot devem corresponder às 13 primeiras das 33 da main. Isso precisa ser confirmado comparando nomes e versões.
- O CI falha antes da primeira etapa, sem logs. Isso costuma vir de configuração de Actions ou da conta (cobrança, permissões, runner), não do código.

## Bloqueios concretos
1. A PR #320 não passou no CI. Aplicar 11 migrations não validadas no banco compartilhado (preview e produção usam a mesma instância) é o maior risco.
2. Ledger e migrations do snapshot divergem: aplicar as migrations 19 a 33 da main exige antes reconciliar a ordem.
3. O trigger de auto-confirmação continua ativo, então a confirmação de e-mail não é real.
4. Os secrets do Asaas Sandbox (API key e token de webhook) não existem; só o dono pode adicioná-los.
5. O pg_cron não está instalado, e o worker depende de agendamento.
6. Divergência Lovable/GitHub (#322): não há sincronização automática possível com o repo privado.

## Rota recomendada (menor risco e menor retrabalho)
O caminho suportado é importar seletivamente pelo conector GitHub, sem Git sync. Esse caminho já foi usado com sucesso para a main `13d3532`.
1. Desbloquear o CI da #320 no GitHub (Issue #318) e obter testes verdes. Nada de billing entra antes disso.
2. Ler as PRs #320/#321 pelo conector e listar os arquivos por categoria: migrations, funções, rotas/libs do frontend e testes.
3. Portar a #321 (erros de funções no frontend). Já existe o equivalente local em `src/lib/edge-function-errors.ts`; basta comparar e ajustar.
4. Reconciliar as migrations: comparar os nomes das 33 da main com os 18 do ledger e gerar a lista exata das pendentes, sem aplicar nada.
5. Aplicar as pendentes do núcleo (19 a 33, sem professor), uma por vez e com autorização, cada uma como migration nova pelo mecanismo do Lovable. A remoção do auto-confirm vai numa migration separada.
6. Billing: as 11 migrations da #320 entram como novas migrations, depois das do núcleo. Os handlers de webhook do Asaas viram rotas `src/routes/api/public/asaas/*`, que verificam o token. As chamadas ao Asaas passam por funções de servidor. O worker roda via pg_cron, ou via rota cron protegida se você preferir não instalar a extensão.
7. Homologação: secrets do Sandbox, um webhook de teste e o ciclo cobrança → pagamento → status verificado pela interface. Sem publicar.
8. Fora do escopo: recursos de professor. Colunas existentes permanecem; nenhuma remoção.

Consequências das alternativas, que não são recomendadas agora:
- Desconectar o Git e conectar de novo: cria outro repositório novo e não resolve o vínculo com o privado.
- Criar um projeto novo: perde o vínculo com o backend e os usuários atuais.
- Mudar a visibilidade do repositório: não tem efeito sobre a sincronização.

## Ações que exigem dono/administrador
- Corrigir GitHub Actions / Issue #318 (cobrança, permissões e runners da organização).
- Autorizar cada migration (núcleo, auto-confirm e billing) e a instalação do pg_cron.
- Adicionar os secrets do Asaas Sandbox e cadastrar a URL do webhook no painel Asaas.
- Configurar o envio de e-mail antes de remover o auto-confirm.
- Confirmar que existe backup do banco antes da primeira migration.
- Decidir sobre a publicação depois da homologação.
