# Ordys Plus — cobrança recorrente com Asaas

## Decisão de produto

A primeira versão comercial terá dois níveis:

- **Ordys Free:** organização acadêmica manual (disciplinas, tarefas, agenda, notas, frequência, estudos e foco).
- **Ordys Plus:** recursos avançados de IA, incluindo pesquisa, simulados, configuração inteligente e transcrição de vídeos, sujeitos aos limites de uso definidos no servidor.

A assinatura terá ciclos mensal e anual. Os valores não foram definidos nesta implementação: os dois planos nascem desativados e sem preço. Não habilitar cobrança até aprovar preço, margem, custos de IA, taxas do provedor e termos comerciais. A homologação também deve confirmar os campos de associação de cliente do webhook descritos abaixo.

## Provedor e método de cobrança

Provedor: Asaas, usando Asaas Checkout hospedado, com uma sessão individual por tentativa de contratação.

Cada contratação cria um Checkout exclusivo por usuário, via `POST /v3/checkouts`, com:
- `billingTypes = ["CREDIT_CARD"]`;
- `chargeTypes = ["RECURRENT"]`;
- `subscription.cycle = MONTHLY` ou `YEARLY`;
- `externalReference` único por tentativa;
- expiração de 60 minutos;
- um item com o preço do plano;
- callbacks de sucesso, cancelamento e expiração.

O Asaas retorna um ID de Checkout exclusivo. O Ordys salva esse ID e monta a URL hospedada no formato `https://asaas.com/checkoutSession/show?id={checkoutId}`. Não usar Payment Links genéricos, pois eles podem ser reutilizados por diferentes pagadores.

A recorrência inicial é **somente por cartão de crédito**. Pix Automático não está implementado. Não divulgar Pix como forma de renovação automática nesta versão. O cliente informa os dados de pagamento diretamente na página hospedada do Asaas; o Ordys não coleta nem armazena número de cartão ou CVV.

O evento `CHECKOUT_PAID` registra o checkout concluído e associa o cliente à tentativa; `SUBSCRIPTION_CREATED` cria a assinatura local como pendente; somente `PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED` libera acesso. Se a confirmação de pagamento chegar antes da criação local da assinatura, o evento fica retido com campos mínimos e é reprocessado pelo ID exato da assinatura após o vínculo; as validações de titular, tipo, valor e idempotência são repetidas antes de liberar Plus. A URL de retorno do checkout não concede acesso.

## Falha ambígua ao criar Checkout

A criação `POST /v3/checkouts` não deve ser repetida só porque a aplicação perdeu a resposta. A tentativa local começa em `creating` e permanece bloqueada até que o resultado remoto seja reconciliado.

- Respostas HTTP `408` e desconexões do cliente/proxy registradas como `499` são ambíguas: não marcar a tentativa como `failed` e não abrir outra cobrança automaticamente.
- Falhas de transporte, `5xx` e ausência de resposta também mantêm a tentativa em `creating`.
- Para o endpoint oficial de criação de Checkout, a referência do Asaas documenta `200`, `400` e `401`; a FAQ identifica `400` como validação e `401` como autenticação. Nesta integração, somente `400` e `401` são classificados como rejeições definitivas e liberam a tentativa local para nova contratação. Qualquer outro status HTTP não documentado para esse POST não idempotente — inclusive `403`, `404`, `409`, `422` ou `429` — permanece reservado em `creating` e retorna `checkout_reconciliation_required` até que um webhook ou a conciliação manual prove se o Checkout remoto foi criado. Não ampliar a lista de rejeições sem evidência específica do contrato da API.
- Primeiro procure o Checkout por seu `externalReference` e confira o evento `CHECKOUT_CREATED`/estado no painel Asaas. O exemplo oficial do payload pode omitir `externalReference`: se a resposta da criação já forneceu o ID remoto exato, a finalização pode aceitar somente o `CHECKOUT_CREATED` recebido com esse mesmo ID (desde que não traga uma referência divergente). Se a resposta da criação também se perdeu e o Ordys não conhece o ID remoto, o evento sem `externalReference` não recupera a tentativa; ela permanece bloqueada para conciliação manual, sem nova criação.

Referências do contrato: [Create new Checkout](https://docs.asaas.com/reference/create-new-checkout) (respostas documentadas `200`, `400`, `401`) e [FAQ do Asaas Checkout](https://docs.asaas.com/docs/faq-do-asaas-checkout) (validação `400` e autenticação `401`).

O Asaas recomenda verificar se o Checkout original já foi criado antes de recriá-lo após falha da aplicação: https://docs.asaas.com/docs/erros-comuns-e-boas-pr%C3%A1ticas. Para registros `499`, a desconexão do cliente não comprova o resultado da operação; reconcilie antes de repetir: https://developers.cloudflare.com/support/troubleshooting/http-status-codes/4xx-client-error/error-499/.

## Proteções incluídas

- O billing começa com `billing_enabled = false`.
- Os dois planos começam com `enabled = false` e `price_cents = NULL`.
- O cliente não tem acesso direto às tabelas financeiras; RLS permanece habilitado e os privilégios são exclusivos de `service_role`.
- Checkout exige sessão Supabase válida, plano ativo e preço positivo no banco.
- A RPC de criação também bloqueia novas contratações quando existe webhook Asaas financeiro sem conciliação segura, inclusive evento associado a Checkout local já terminal. O mesmo RPC bloqueia assinaturas locais `pending`, `active`, `past_due` ou `suspended`, registros `cancelled` sem confirmação de exclusão pelo Asaas e assinaturas `cancelled` cujo `current_period_end` ainda está no futuro. O último caso preserva o acesso já pago até o fim do período, mesmo que a recorrência no Asaas tenha sido encerrada. A política atual é deliberadamente fail-closed: o bloqueio pode atingir todas as contas enquanto houver titular desconhecido, associação ambígua ou divergência permanente de identidade/valor em quarentena. Isso protege contra uma segunda recorrência ou vínculo financeiro incorreto, mas pode pausar temporariamente todas as novas vendas até a conciliação operacional. A verificação ocorre dentro da transação no banco, não depende apenas da leitura anterior feita pela Edge Function.
- A primeira contratação e os endpoints server-side de IA consultam `profiles.birth_date` e `profiles.timezone` e calculam a idade pela data civil no fuso IANA. **Limitação crítica:** ambos os campos são editáveis pelo próprio titular na tela Perfil e pela política RLS `own profile`; a trigger apenas rejeita uma data futura. Portanto, esta checagem bloqueia dados ausentes/malformados e idades declaradas abaixo de 18, mas **não comprova a idade real**: uma pessoa menor pode alterar a própria data de nascimento para aparentar 18+. O fuso também é autodeclarado, não comprova residência. A validação server-side permanece útil contra chamadas sem perfil válido, mas não pode ser tratada como age assurance. A Issue [#323](https://github.com/igniteprosperety-collab/ordys-academy.app/issues/323) é gate de lançamento para escolher e implementar uma verificação confiável, controlada no servidor, antes de oferecer cobrança ou uso de OpenAI restrito a maiores de 18. O código calcula `nextDueDate` como 24 horas após a criação do Checkout e envia `YYYY-MM-DD HH:mm:ss` sem sufixo de fuso, no formato de exemplo documentado pelo Asaas. **A interpretação de fuso desse campo não está explicitada na referência consultada e permanece um gate de Sandbox**: antes de anunciar ou ativar a cobrança, comparar o `nextDueDate` retornado na assinatura e o vencimento real da primeira cobrança com o instante esperado em `America/Sao_Paulo`. Não assumir que a conversão UTC seguida da remoção de `Z` preserva o horário local do pagador.
- O webhook exige `asaas-access-token` com 32–255 caracteres, sem espaços.
- O identificador de evento do Asaas é a chave de idempotência. O identificador da cobrança também é único, evitando renovar o período duas vezes quando o Asaas entrega `PAYMENT_CONFIRMED` e `PAYMENT_RECEIVED` para a mesma cobrança.
- Valor confirmado é comparado com o preço registrado na assinatura antes de conceder acesso. O valor recebido precisa corresponder a um número inteiro de centavos, sem arredondar frações de centavo; texto inválido, overflow, `NaN`, `Infinity` ou divergência de preço entram em quarentena e não liberam Plus.
- O cancelamento encerra a recorrência no Asaas e também remove cobranças pendentes ou vencidas vinculadas à assinatura; cobranças já pagas permanecem registradas. O acesso pago continua até `current_period_end`.
- A exclusão da conta usa `ordys_billing_core_schema_status()` para confirmar que as tabelas e guardas financeiras necessárias estão íntegras, sem depender do heartbeat do worker. Assim, a indisponibilidade do `pg_cron` bloqueia novas contratações e Plus, mas não bloqueia automaticamente a exclusão de contas sem pendências financeiras. A RPC transacional de reserva verifica os eventos não conciliados, Checkouts e assinaturas daquela conta; qualquer cobrança, reserva ou evento financeiro pendente continua bloqueando a exclusão até conciliação. A exclusão cancela primeiro os Checkouts abertos e as assinaturas no Asaas. Se o provedor não confirmar o encerramento, o endpoint interrompe a exclusão local para não abandonar cobranças recorrentes. Mesmo após a confirmação de cancelamento, a exclusão também fica bloqueada enquanto houver um evento `negative_payment_unmatched` ligado ao ID exato de uma assinatura; o histórico financeiro precisa ser conciliado antes de apagar os dados. Depois de passar por todas as verificações, a exclusão da identidade Auth desvincula o `user_id` das tentativas, assinaturas e pagamentos (`ON DELETE SET NULL`) em vez de apagar o ledger financeiro; os IDs exatos e estados mínimos permanecem para conciliar estornos/chargebacks tardios. O `user_id` da inbox durável é anonimizado antes da exclusão Auth. A retenção remanescente exige base legal, prazo e transparência aprovados antes da venda.
- O cancelamento de Checkout usa uma reivindicação atômica com `cancellation_claim_id` (UUID) além de `cancellation_requested_at`. Se o PATCH for confirmado no banco, mas sua resposta se perder, a mesma execução lê de volta seu UUID e pode enviar o único POST ao Asaas. Uma execução concorrente com outro UUID não assume a chamada.
- O cancelamento de assinatura recorrente usa `ordys_billing_subscriptions.cancellation_claim_id` (UUID) junto de `cancellation_requested_at`. Se o PATCH confirmar no banco e a resposta se perder, somente a execução cujo UUID for lido de volta pode enviar o único DELETE ao Asaas. Um UUID de outra execução nunca assume a chamada. A reivindicação prova quem reservou o envio, não que o Asaas cancelou a assinatura; somente a resposta síncrona reconciliada ou o webhook `SUBSCRIPTION_DELETED` confirma o encerramento. Depois de um resultado externo ambíguo, não repetir o DELETE automaticamente.
- Em ambos os fluxos, o UUID identifica o dono da tentativa; não confirma cancelamento no provedor. O marcador só é encerrado pela conciliação do webhook ou por confirmação síncrona validada.
- O endpoint de exclusão limita a validação Auth a 8 s (+ 3 s para leitura do JSON), consultas/atualizações de billing a 8 s, chamadas ao Asaas a 12 s e cada etapa destrutiva de exclusão a 15 s. O fluxo destrutivo tem teto de 100 s, inferior ao limite de 150 s de resposta ociosa do gateway Supabase; somado ao limite de 11 s da validação Auth e ao limite de 8 s para liberar a lease, mantém a resposta abaixo do timeout do gateway. A lease de processamento no banco dura 10 minutos e continua protegendo contra sobreposição caso o worker seja encerrado pelo runtime antes de liberar o bloqueio. Ao atingir qualquer prazo, a requisição de saída é abortada. Como o provedor ou banco pode ter concluído a operação antes da interrupção, a reserva durável e o marcador de intenção de cancelamento não são removidos; a pessoa deve verificar a conciliação antes de qualquer nova tentativa.
- Pagamento em atraso recebe uma tolerância técnica de até três dias somente quando já existe um período pago anterior (`current_period_end`). Uma primeira cobrança recusada, reprovada na análise de risco ou vencida sem pagamento anterior não recebe período de graça e nunca libera o Plus.
- Estorno agendado/em processamento, estorno concluído, estorno parcial e chargeback suspendem o acesso imediatamente, até revisão.

A tabela de eventos guarda metadados e identificadores de cobrança, não o payload bruto do webhook nem dados de cartão.

## Secrets do ambiente

Configurar somente no gerenciador de secrets do projeto Lovable Cloud / Supabase correto; nunca em `VITE_*`, código versionado ou mensagens.

Sandbox:
- `ASAAS_ENVIRONMENT=sandbox`
- `ASAAS_API_KEY`: API key gerada no ambiente Sandbox do Asaas.
- `ASAAS_WEBHOOK_TOKEN`: token aleatório forte, com 32–255 caracteres, sem espaços.

Produção:
- `ASAAS_ENVIRONMENT=production`
- `ASAAS_API_KEY`: API key independente gerada no ambiente de Produção.
- `ASAAS_WEBHOOK_TOKEN`: token independente de produção.

Não reutilizar a chave nem o token do Sandbox em Produção. Não enviar valores desses secrets pelo chat.

## Webhook Asaas

URL do endpoint:

`https://yqljcoukgpqdoxiispyn.supabase.co/functions/v1/ordys-billing-webhook`

Configurar a autenticação do webhook pelo campo `authToken`, usando exatamente o valor de `ASAAS_WEBHOOK_TOKEN`.

Selecionar os eventos abaixo e configurar `sendType = SEQUENTIALLY` para preservar a ordem do fluxo:
- `CHECKOUT_CREATED`
- `CHECKOUT_PAID`
- `CHECKOUT_CANCELED`
- `CHECKOUT_EXPIRED`
- `SUBSCRIPTION_CREATED`
- `SUBSCRIPTION_UPDATED`
- `PAYMENT_CREATED`
- `PAYMENT_CONFIRMED`
- `PAYMENT_RECEIVED`
- `PAYMENT_OVERDUE`
- `PAYMENT_REFUND_IN_PROGRESS`
- `PAYMENT_REFUNDED`
- `PAYMENT_PARTIALLY_REFUNDED`
- `PAYMENT_CHARGEBACK_REQUESTED`
- `PAYMENT_CHARGEBACK_DISPUTE`
- `PAYMENT_AWAITING_CHARGEBACK_REVERSAL`
- `PAYMENT_RECEIVED_IN_CASH_UNDONE`
- `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED`
- `PAYMENT_REPROVED_BY_RISK_ANALYSIS`
- `SUBSCRIPTION_DELETED`
- `SUBSCRIPTION_INACTIVATED`


### Pagamentos fora de assinaturas

O webhook Asaas pertence à conta e também pode receber eventos de cobranças avulsas. O campo `payment.subscription` só é enviado quando a cobrança foi gerada por uma assinatura. Por isso, o Ordys ignora eventos de pagamento sem esse campo somente quando não existe vínculo conhecido pelo ID exato do pagamento, pelo cliente Asaas ou pela `externalReference` de um Checkout Ordys. Se o cliente ou a referência apontar para um registro Ordys, mas o ID da assinatura estiver ausente, o evento fica em quarentena como `payment_subscription_unmatched`; o sistema não deduz a assinatura apenas pelo cliente e não concede acesso. Um ID de pagamento já registrado no ledger continua permitindo recuperar a assinatura exata mesmo quando um webhook posterior omite `subscription`.

### Tempo de resposta e recuperação da fila

O Asaas espera a resposta do endpoint por até **10 segundos** e considera a entrega confirmada somente quando recebe **HTTP 200**. Qualquer outro status, inclusive outros códigos `2xx`, além de falhas de conexão e timeout, entra no ciclo de retentativas. Após **15 falhas consecutivas**, a fila dessa configuração é interrompida. Os eventos novos continuam sendo gerados e os pendentes ficam armazenados por até **14 dias**; depois desse prazo, os eventos mais antigos são excluídos permanentemente.

### Contrato de recebimento e processamento assíncrono

O handler versionado em `supabase/functions/ordys-billing-webhook/index.ts` agora executa somente a recepção:
1. valida `asaas-access-token`, JSON e limites do corpo;
2. persiste a recepção idempotente pela RPC `ordys_receive_asaas_billing_webhook`, com prazo de **1,5 segundo**;
3. valida o contrato exato do recibo e devolve **HTTP 200 somente depois que a transação de recepção confirmou o registro**.

O endpoint não chama mais a RPC financeira antes de responder. Um recibo novo ou duplicado ainda em `received` retorna `queued=true`; eventos já terminais/quarentenados são reconhecidos sem reabertura. Se o banco não confirmar um recibo válido, o endpoint devolve erro não-2xx e permite a retentativa do Asaas. A confirmação HTTP não concede acesso nem altera assinatura por conta própria.

Antes de persistir o recibo, o endpoint consulta `ordys_billing_schema_status()`. Enquanto o schema estiver `partial`, `absent` ou a consulta falhar, responde **HTTP 503** e não reconhece o evento ao Asaas. Isso evita confirmar uma entrega quando não existe um worker operacional para processá-la. O Checkout também exige `schema_status = 'ready'` além de `billing_enabled = true`; o status da assinatura mantém o registro para permitir cancelamento, mas esconde a oferta e informa `hasAccess = false` enquanto a fila não estiver operacional. A função server-side `isOrdysPlusEligible()` também falha fechada antes de consultar o ledger de pagamentos. Assim, um estorno/chargeback pendente não deixa Plus liberado se o processamento automático parar. A função SQL base de elegibilidade permanece focada no estado financeiro e continua testável isoladamente; o gate operacional fica na camada server-side.

A mesma migration cria `ordys_billing_core_schema_status()`, uma leitura do status estrutural anterior ao worker. Somente o endpoint de exclusão usa essa RPC; ela permite verificar a integridade das tabelas/guardas sem exigir que o agendamento esteja vivo. A reserva transacional continua a verificar pendências reais por conta. O status operacional `ordys_billing_schema_status()` permanece obrigatório para Checkout, webhook e Plus.

A migration `20261112010000_ordys_asaas_cron_worker.sql` instala `pg_cron` e cria o RPC protegido `ordys_process_next_asaas_billing_webhook()`. Cada chamada reabre no máximo um evento dependente com `ordys_requeue_asaas_billing_webhook_retries(1)`; o agendamento recomendado é a cada `5 seconds` (limite teórico de 12 recibos/minuto antes de considerar a duração real das transações), com monitoramento de carga, idade da fila e duração das execuções; se não houver retry elegível, seleciona o recibo novo mais antigo em `received`. O processador financeiro normal aplica todas as validações de identidade, valor, titularidade e idempotência. A função processa **um único recibo por transação** e libera o lock global ao concluir. Como `cron.job_run_details` não é limpo automaticamente, o runbook agenda uma limpeza diária com retenção de sete dias. Não há rota HTTP de worker nem secret `LOVABLE_CRON_SECRET` para este caminho.

A migration instala a extensão e cria a função, mas **não agenda nem ativa um Job**. Depois de sincronizar a fonte oficial e aplicar/reconciliar as migrations pelo procedimento aprovado, configurar um Job SQL-only no Lovable Cloud / Database Jobs com:
```sql
SELECT cron.schedule(
  'ordys-asaas-webhook-worker',
  '5 seconds',
  'SELECT public.ordys_process_next_asaas_billing_webhook();'
);

-- pg_cron does not clean run history automatically. Retain one week.
SELECT cron.schedule(
  'ordys-cron-history-cleanup',
  '0 3 * * *',
  'DELETE FROM cron.job_run_details WHERE end_time < now() - INTERVAL ''7 days'';'
);
```
O banco Lovable consultado está em PostgreSQL **17.6**, portanto suporta intervalos sub-minute documentados pelo Supabase. O Job deve executar como role `postgres`; o schema-readiness gate rejeita qualquer outro usuário do Job. A prontidão só retorna `ready` quando a linha ativa em `cron.job` tem o nome/comando esperados **e a última execução registrada em `cron.job_run_details` terminou com `succeeded` nos últimos dois minutos**. Se o job falhar, ficar em execução por mais tempo ou parar, o schema volta a `partial`: Checkout, webhook e Plus falham fechados. O workflow de CLI versionado verifica a presença das migrations no ledger, mas não consulta diretamente esse RPC e recusa o projeto Lovable Cloud gerenciado; portanto, não é uma prova de prontidão para esse backend. Não configurar como chamada HTTP para API route.

Quando não houver recibos, a função retorna `queue_empty=true`. Um erro transitório do processador aborta a transação inteira, mantém o recibo recuperável e faz o Job registrar a execução como falha; a próxima execução tenta novamente. Erros financeiros permanentes permanecem em quarentena e não são reabertos pelo requeue automático. O batch de um evento por execução mantém baixo o tempo de lock e evita atrasar o ACK do webhook Asaas durante uma transação longa. O histórico da fila e dos jobs deve ser acompanhado; o agendamento consome uso do Cloud e sua frequência pode ser ajustada após medir o volume real. A tabela `cron.job_run_details` não é limpa automaticamente. Definir retenção e uma rotina controlada para remover apenas execuções antigas, preservando a janela necessária para suporte e auditoria.

A migration `20261111010000_ordys_bound_asaas_webhook_replay.sql` adiciona os índices parciais de retry e remove os seis loops recursivos de `ordys_apply_asaas_billing_event`. O RPC de requeue valida limite de 1 a 5, ordena os candidatos, usa `FOR UPDATE ... SKIP LOCKED` e só reabre códigos recuperáveis quando o pré-requisito exato existe. A associação por `externalReference` é exata; fallback por cliente é permitido apenas com uma única tentativa histórica e paga; notificações de assinatura/pagamento exigem o ID exato da assinatura; estorno/chargeback exige também o ID exato do pagamento e a mesma titularidade da assinatura.

O requeue altera apenas a inbox de `quarantined` para `received` e restaura `user_id` somente quando ele pode ser resolvido por uma tentativa ou assinatura local exata. **O registro financeiro legado permanece `failed` até que o processador execute e confirme a aplicação do evento.** Isso é intencional: os bloqueios de nova contratação e exclusão de conta permanecem ativos durante a tentativa, inclusive se o processamento falhar. O processador normal faz a transição do evento legado e o trigger sincroniza o estado final na inbox. Erros permanentes de identidade, valor ou ambiguidade nunca entram na lista de requeue automático.

**Cobertura adicionada, ainda não executada:** a integração já exercita backlog de 12 eventos, requeue concorrente e dependências de pagamento/estorno. A nova suite do worker SQL verifica processamento de um recibo exato por chamada, que o próximo recibo permanece em `received`, e que chamadas concorrentes para o mesmo recibo não duplicam o processamento. A suite de segurança exige que o RPC do worker não esteja acessível a `anon` nem a `authenticated`. A presença dos testes no repositório não equivale a aprovação; o CI privado ainda não alocou runner.

**Gate obrigatório antes de ativar o webhook ou o billing:** CI real para migration, integração, typecheck e verificador estático; prova de recuperação após falha, concorrência, backlog, quarentena e bloqueios de Checkout/exclusão; sincronizar a fonte oficial e aplicar schema pelo fluxo suportado do Lovable Cloud; só então criar o Job SQL-only, confirmar pelo menos duas execuções bem-sucedidas no histórico e validar recebimento/processamento real no Asaas Sandbox. Nenhum teste desta implementação deve ser considerado aprovado até execução efetiva.
 
**Antes de reativar uma fila interrompida:**
1. Acesse **Integrações → Webhooks → Logs de Webhooks** no Asaas e identifique o código HTTP, mensagem, horário, payload e número de tentativas.
2. Confira a URL, o token `ASAAS_WEBHOOK_TOKEN`, disponibilidade da Edge Function, logs de execução, tempo do PostgREST e locks/consultas da função `process_ordys_asaas_billing_event`.
3. Corrija a causa e valide um novo evento real de Sandbox, confirmando HTTP 200 e o registro correspondente no ledger do Ordys.
4. Só então reative a fila em **Integrações → Webhooks** (ou atualize o Webhook pela API com `interrupted: false`).
5. Confirme que a fila voltou a enviar os eventos acumulados, que as entregas retornam HTTP 200 e que reenvios com o mesmo ID continuam idempotentes.

Não reative a fila apenas para "tentar novamente": sem corrigir a causa ela pode ser interrompida outra vez, e a janela de retenção de 14 dias continua correndo. Como este webhook é obrigatoriamente sequencial, uma falha persistente pode interromper a progressão dos demais eventos daquela configuração. Não enfraqueça o parser nem responda HTTP 200 para resultado nulo/desconhecido apenas para evitar a penalização; primeiro confirme que a RPC persistiu o evento e retornou um contrato válido.

Referências oficiais:
- https://docs.asaas.com/docs/erro-read-timed-out
- https://docs.asaas.com/docs/fila-pausada
- https://docs.asaas.com/docs/como-reativar-fila-interrompida

Acompanhar os Logs de Webhooks no Asaas durante os testes. O provedor usa entrega at-least-once; reentregas com o mesmo evento não podem criar pagamento ou período duplicado. Eventos negativos atrasados (`PAYMENT_OVERDUE` ou recusa) para um ID de cobrança já registrado como `PAYMENT_CONFIRMED`/`PAYMENT_RECEIVED` são ignorados para não rebaixar uma assinatura já paga. Estornos, chargebacks e reversões que cheguem antes do vínculo local da assinatura ou antes do registro da cobrança exata ficam retidos com campos mínimos. O acesso é suspenso imediatamente, e o replay exige o ID exato da assinatura e do pagamento. Já notificações de inadimplência ou recusa (`PAYMENT_OVERDUE`, `PAYMENT_CREDIT_CARD_CAPTURE_REFUSED` e `PAYMENT_REPROVED_BY_RISK_ANALYSIS`) são aplicadas diretamente quando a assinatura já está vinculada, sem esperar uma linha no ledger: uma cobrança vencida ou recusada pode nunca gerar pagamento liquidado. Se esses avisos chegam antes de `SUBSCRIPTION_CREATED`, ficam retidos e são reaplicados após o vínculo exato da assinatura. O ID do cliente é conferido antes de qualquer alteração financeira. Assim, um estorno ou chargeback recebido antes da linha do pagamento não é descartado nem substituído por uma confirmação positiva atrasada. Reembolsos concluídos, reembolsos parciais, reembolsos em processamento e recebimentos desfeitos permanecem como estados financeiros negativos; um `PAYMENT_RECEIVED` duplicado ou atrasado não pode sobrescrevê-los. **Exceção específica:** quando o pagamento está em `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` e o Asaas posteriormente confirma `PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED`, o ledger financeiro pode voltar ao estado positivo. Mesmo nessa situação, a assinatura continua `suspended` até revisão manual e o Plus não é reativado automaticamente. 

O ledger também guarda `paid_at` separado do horário em que o Ordys processou o evento. A cada novo pagamento confirmado, `current_period_end` é recalculado a partir das cobranças ainda positivas, em ordem cronológica de liquidação. Assim, pagamentos antecipados continuam acumulando períodos, mas um webhook antigo entregue com atraso não acrescenta um mês/ano extra por causa da ordem de entrega. Quando o payload omitir `payment.subscription`, o processador recupera a assinatura somente se o `payment.id` exato já existir no ledger local; não associa cobranças a partir do customer ID por aproximação. Uma colisão de `provider_payment_id` só é tratada como duplicidade quando o pagamento existente pertence ao mesmo usuário e à mesma assinatura; qualquer divergência gera `payment_identity_mismatch` sem alterar o outro registro. O mesmo bloqueio vale para eventos negativos: se um estorno/chargeback reutilizar um ID já registrado para outro usuário ou assinatura, o evento é rejeitado antes de suspender o acesso da conta indicada no payload. Isso não cria uma pendência falsa de conciliação.

A associação de `SUBSCRIPTION_CREATED` prioriza o `externalReference` e aceita uma tentativa ativa (`creating`, `pending`, `paid` ou `linked`) quando a referência corresponde exatamente ao registro Ordys. Isso permite registrar a assinatura como pendente mesmo se o evento chegar antes de `CHECKOUT_PAID`; acesso Plus continua bloqueado até `PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED`. Se o Asaas não enviar a referência, o sistema só usa o cliente do Checkout quando existe exatamente uma tentativa histórica para aquele ID de cliente, independentemente do estado (`creating`, `pending`, `paid`, `linked`, `cancelled`, `expired` ou `failed`); essa única tentativa precisa estar em `paid`. Tentativas terminais também contam porque podem ter criado uma assinatura remota cujo webhook chegou atrasado. Se houver duas ou mais tentativas históricas para o mesmo cliente, a associação fica ambígua e não é atribuída automaticamente, mesmo quando só uma delas está paga. Isso pode exigir conciliação manual para contas que reutilizam o mesmo customer ID, mas impede que um evento antigo seja ligado ao Checkout mais recente. Esse fallback depende da entrega sequencial: `CHECKOUT_PAID` deve associar o ID do cliente/Checkout antes de `SUBSCRIPTION_CREATED`. Como o exemplo oficial do payload de Checkout não apresenta `externalReference`, **`sendType = SEQUENTIALLY` é requisito de produção, não uma preferência**. Não usar `NON_SEQUENTIALLY` nessa integração. O campo `checkout.customer` também pode ser omitido pelo Asaas. Na homologação Sandbox, confirme que o evento real `CHECKOUT_PAID` desta configuração informa o mesmo ID de cliente que aparece em `SUBSCRIPTION_CREATED.subscription.customer`. Se algum ID necessário estiver ausente, o Ordys mantém a assinatura sem vínculo e sem acesso Plus. Se os IDs divergirem, a tentativa fica em quarentena, qualquer assinatura já vinculada é suspensa e pagamentos posteriores não reativam o Plus até uma conciliação auditável. Não tente conciliar por e-mail, valor ou semelhança de nome. Faça a verificação manual dos IDs no painel Asaas antes de qualquer correção auditável. Como proteção adicional para eventos fora de ordem, se `SUBSCRIPTION_CREATED` chegar sem `externalReference` antes de `CHECKOUT_PAID`, o Ordys guarda somente os campos mínimos necessários para conciliação (sem persistir o payload bruto). Os dois eventos usam o mesmo advisory lock por ID do cliente, evitando uma corrida entre a gravação do evento pendente e a confirmação do Checkout. Quando `CHECKOUT_PAID` associa o ID do cliente a uma única tentativa, a transação reaplica o evento pendente e vincula a assinatura. Se a associação continuar ausente ou ambígua, o evento permanece sem conciliação e não libera acesso. IDs de cliente compartilhados entre contas ou eventos sem associação segura são gravados com `processing_status = failed`, não liberam acesso. Conferir o `error_code` e os Logs de Webhook do Asaas antes de qualquer conciliação manual; nunca liberar Plus manualmente sem confirmar o pagamento e o titular.

Para eventos de assinatura diferentes de `SUBSCRIPTION_CREATED`, o Ordys consulta primeiro o `provider_subscription_id` exato, que é único no banco. Assim, `SUBSCRIPTION_DELETED` e `SUBSCRIPTION_INACTIVATED` de uma assinatura já vinculada não ficam bloqueados apenas porque o mesmo cliente Asaas aparece em Checkouts de mais de uma conta. O ID exato da assinatura resolve o registro existente. Se o evento também trouxer `externalReference` que corresponda a um Checkout local, esse Checkout precisa pertencer ao mesmo usuário e, quando o vínculo existe, ser o Checkout já associado à assinatura; uma referência de outra conta é rejeitada como `subscription_checkout_mismatch`. Quando o evento informa `customer` e o registro possui `provider_customer_id`, os valores também precisam coincidir; divergência vira `subscription_customer_mismatch` e não altera o estado local. A regra de cliente único continua obrigatória para associar uma assinatura nova quando não há um registro local por ID. Quando `SUBSCRIPTION_CREATED` repetir um `provider_subscription_id` já registrado, o usuário e o `checkout_attempt_id` também precisam coincidir; divergências geram `subscription_identity_mismatch` antes do `ON CONFLICT`, sem sobrescrever o cliente nem vincular o novo Checkout.

Eventos de webhook que não puderem ser associados com segurança ficam registrados com `processing_status = failed` e um `error_code`; não liberam acesso. A suíte de integração do CI percorre a máquina SQL de webhooks em Supabase descartável, incluindo associação por referência quando `SUBSCRIPTION_CREATED` chega antes de `CHECKOUT_PAID`, confirmação de pagamento antes de `SUBSCRIPTION_CREATED` com reprocessamento, duplicidade, evento negativo atrasado, cancelamento e estorno. Isso não substitui a homologação da conta Sandbox real nem a verificação do `sendType = SEQUENTIALLY`. Uma tentativa `creating` ou `pending` não é liberada apenas porque o relógio local expirou. Para uma tentativa `pending`, o Ordys solicita `POST /v3/checkouts/{id}/cancel` e mantém o bloqueio até receber `CHECKOUT_CANCELED` ou `CHECKOUT_EXPIRED`; se o estado remoto for incerto, não cria outro Checkout. Se a resposta da criação se perder, o webhook `CHECKOUT_CREATED` pode recuperar o registro pelo `externalReference` quando esse campo vier no payload. O exemplo oficial do Asaas não o inclui; se estiver ausente, a tentativa permanece bloqueada para conciliação segura, sem abrir outra cobrança. Eventos `CHECKOUT_PAID` tardios sobre tentativas já encerradas são registrados como falha de conciliação e não concedem acesso. Um Checkout marcado como pago, mas ainda sem assinatura local conciliada, bloqueia uma segunda tentativa de cobrança mesmo após o prazo de expiração local. Isso evita cobrar duas vezes enquanto um evento está pendente de análise.

Na exclusão de conta, um Checkout ou assinatura inconclusivos mantêm a exclusão bloqueada, mas não interrompem a tentativa de cancelamento de outros Checkouts e assinaturas independentes que tenham IDs verificáveis. Cada reivindicação permanece persistida e nunca é repetida automaticamente após resposta incerta. A API retorna `checkout_cancellation_processing`, `billing_cancellation_processing` ou `billing_reconciliation_required` conforme a origem da pendência. Na conciliação, compare o ID do Checkout, o ID da assinatura, o ID do cliente Asaas, o valor, o ciclo e o titular da conta Ordys. Divergência de cliente, valor, ciclo ou forma de pagamento não pode ser corrigida concedendo acesso manualmente. Primeiro confirme o pagamento na conta Asaas e identifique a conta Ordys correta; depois faça a correção auditável no banco, sem reutilizar o evento para conceder acesso a outra pessoa.

Assinaturas suspensas por estorno ou chargeback permanecem sem acesso até revisão manual. Há uma transição específica documentada pelo Asaas: `PAYMENT_AWAITING_CHARGEBACK_REVERSAL` indica que a disputa foi revertida a favor do estabelecimento e aguarda o repasse da adquirente; depois, o Asaas pode emitir `PAYMENT_CONFIRMED` ou `PAYMENT_RECEIVED`. O Ordys registra esse estado intermediário e atualiza o ledger para o status positivo final quando ele chega, mas mantém a assinatura `suspended` e não libera Plus automaticamente. Essa exceção não se aplica a estornos, estornos parciais ou recebimentos desfeitos, que continuam protegidos contra confirmações positivas atrasadas.

O botão de cancelamento e o endpoint `ordys-billing-manage` continuam disponíveis mesmo quando `billing_enabled = false`. Desligar novas contratações nunca pode impedir o cliente de encerrar uma recorrência existente. O bloqueio global controla somente novas contratações; o cancelamento segue permitido.

## Sequência de ativação

A sequência abaixo é um roteiro condicionado. **Não executar em produção enquanto não houver backup externo verificado, autorização para a janela de implantação e acesso ao procedimento aprovado do Lovable Cloud.** O repositório registra o código e as migrations, mas não comprova que o backend remoto está pronto.

### Gates obrigatórios antes das migrations de billing

- A migration `20261029232950_ordys_billing_schema_status.sql` instala a RPC consultada pelo endpoint de exclusão de conta. Ela precisa constar no histórico remoto antes de implantar a versão atualizada de `ordys-delete-account`.
- O workflow `Deploy ORDYS Assistant` declara o input `email_confirmation_delivery_verified` com padrão `false`. Se esse valor continuar falso e a migration `20261029233000_remove_untracked_auto_confirm_email.sql` ainda não constar no histórico remoto, o preflight retira temporariamente essa migration e **todas as posteriores** do `db push`, incluindo as migrations de billing. Só liberar esse gate depois que uma conta Gmail comum receber e abrir o e-mail real de confirmação e o fluxo completo de confirmação/login for validado. Não definir o input como `true` com base apenas em inspeção de código.
- **Limite importante:** o mesmo workflow encerra deliberadamente na configuração ao detectar o projeto Lovable Cloud atual. Portanto, a retenção descrita acima não é executada automaticamente contra o backend Lovable Cloud. O procedimento autorizado do Lovable Cloud precisa preservar o mesmo bloqueio. Até haver prova externa da entrega do e-mail e confirmação de que a migration `20261029233000` foi tratada corretamente, não avançar com migrations posteriores a `20261029232950`, nem presumir que o bloqueio está ativo só porque existe no GitHub.
- O workflow `.github/workflows/deploy-ordys-assistant.yml` contém um bloqueio intencional para o projeto Lovable Cloud atual (`yqljcoukgpqdoxiispyn`): a etapa `Check deployment configuration` encerra a execução antes de alterar secrets, aplicar migrations ou publicar Edge Functions. Portanto, esse GitHub Action **não é uma rota executável de deploy para o backend atual**. Não remova nem contorne essa proteção.
- Aplique migrations e publique Edge Functions somente pelo procedimento oficialmente suportado pelo Lovable Cloud, em uma janela autorizada. A rota direta do Supabase CLI/Management API não é suportada para este backend gerenciado. Não implantar funções nem alterar secrets por uma rota alternativa.

### Ordem de migrations e implantação

1. Criar/validar a conta Asaas em nome do responsável pelo Ordys e usar inicialmente uma conta Sandbox dedicada. Não compartilhar o webhook do Ordys com cobranças de outros produtos.
2. Configurar os secrets de Sandbox no ambiente autorizado, sem inserir tokens no repositório.
3. **Reconciliar primeiro o baseline do repositório oficial.** A consulta somente de leitura ao Lovable Cloud encontrou 18 versões no ledger, até `20260927013000`. A `main` privada contém 35 migrations SQL; as 17 versões abaixo não aparecem no ledger remoto:

   - `20260927014000_focus_plan_reference_integrity.sql`
   - `20260927014500_focus_plan_ownership.sql`
   - `20260927020000_goal_integrity.sql`
   - `20260927023000_profile_full_name_limit.sql`
   - `20260927024000_harden_new_user_profile_name.sql`
   - `20260927110000_fix_profile_stage_constraint.sql`
   - `20260927120000_validate_profile_academic_ranges.sql`
   - `20260927130000_validate_grade_integrity_constraints.sql`
   - `20261029232900_delete_recovery_hash_on_account_deletion.sql`
   - `20261029232950_ordys_billing_schema_status.sql`
   - `20261029233000_remove_untracked_auto_confirm_email.sql`
   - `20261031010000_ordys_plus_billing_foundation.sql`
   - `20261031020000_fix_quiz_difficulty_default.sql`
   - `20261031030000_ai_content_reports.sql`
   - `20261031040000_harden_public_default_privileges.sql`
   - `20261031050000_revoke_public_trigger_function_execution.sql`
   - `20261102010000_revoke_excess_client_table_privileges.sql`

   **Ausência no ledger não prova ausência do objeto no banco.** A inspeção anterior encontrou estruturas equivalentes existentes fora do histórico. Para cada versão, compare tabelas, colunas, constraints, índices, triggers, funções e privilégios antes de aplicar; não use `migration repair` como substituto de prova e não reaplique DDL em bloco.

4. **Preservar o gate de confirmação de e-mail.** A migration `20261029233000_remove_untracked_auto_confirm_email.sql` remove o trigger de auto-confirmação não rastreado. Ela e todas as migrations posteriores ficam bloqueadas até um teste real demonstrar que uma conta Gmail comum recebe e abre o e-mail de confirmação e conclui cadastro/login com Auto-confirm desativado. A migration `20261029232950_ordys_billing_schema_status.sql` deve estar efetivamente aplicada antes de publicar a Edge Function atualizada de exclusão de conta. O workflow GitHub encerra deliberadamente antes de deployar este projeto Lovable Cloud; portanto, não considere que o gate do workflow executará automaticamente no backend gerenciado.

5. Depois de reconciliar as 17 versões da `main` e liberar o gate de e-mail, aplicar **as onze migrations novas da PR #320**, em ordem cronológica:

   - `20261103010000_ordys_billing_deletion_serialization.sql`
   - `20261103020000_ordys_suspended_subscription_deletion_confirmation.sql`
   - `20261103030000_guard_delete_own_data_billing_reconciliation.sql`
   - `20261105010000_ordys_guard_delete_own_data_unmatched_webhooks.sql`
   - `20261105020000_ordys_replay_unmatched_payment_created_webhooks.sql`
   - `20261105030000_ordys_guard_ambiguous_customer_webhooks.sql`
   - `20261105040000_ordys_guard_permanent_billing_mismatches.sql`
   - `20261105050000_ordys_preserve_unmatched_confirmed_payment.sql`
   - `20261105060000_ordys_block_checkout_with_unreconciled_webhooks.sql`
   - `20261111010000_ordys_bound_asaas_webhook_replay.sql`
   - `20261112010000_ordys_asaas_cron_worker.sql`

   As migrations `20261104010000`, `20261104020000`, `20261104030000` e `20261105070000` citadas em runbooks antigos **não existem na `main` atual nem fazem parte da PR #320**. Não as procure nem tente aplicá-las; pertenciam à cadeia empilhada anterior, que foi substituída pela extração mínima.
6. Antes de publicar as funções, conferir diretamente no histórico remoto todas as versões da cadeia, inclusive as migrations intermediárias. A RPC de estado do schema e as migrations de ciclo de vida têm gates adicionais para as funções que dependem delas; se faltar qualquer versão, a função dependente deve permanecer sem deploy.
7. Na mesma janela coordenada, publicar pelo fluxo suportado do Lovable Cloud as Edge Functions atualizadas. `ordys-delete-account` depende da RPC de estado do schema e das três migrations de ciclo de vida; as funções de Checkout, gerenciamento e webhook também dependem do schema de billing e dos respectivos gates de ciclo de vida. Publicar ainda status/retorno, assistente e transcrição nas versões alinhadas ao controle de acesso Plus. Não usar o GitHub Action bloqueado nem o Supabase CLI como atalho. Não ativar nenhuma flag antes de todas as funções e do app web estarem publicados e verificados.
8. Configurar o webhook Sandbox numa conta Asaas dedicada ao Ordys, com a URL e o token correspondentes, usando obrigatoriamente `sendType = SEQUENTIALLY`. Validar nos eventos reais que os IDs de cliente, Checkout e assinatura correspondem exatamente; nunca conciliar por e-mail, valor ou nome.
9. Manter `billing_enabled = false` e todos os planos com `enabled = false`. Definir preço mensal e anual em centavos somente depois de aprovar custos reais de IA, taxas do Asaas, margem e termos comerciais.
**Nota da implementação na PR #320:** a migration `20261105060000` implementa a inbox durável em duas fases: o recebimento com campos allowlisted é confirmado antes do processamento, e o estado `received` ou `quarantined` bloqueia nova contratação e exclusão de conta. O finalizador do Checkout só libera a URL após revalidar o estado sob o mesmo bloqueio transacional; se surgir evento incompatível durante a chamada ao Asaas, o link não é exposto e o cancelamento remoto é reservado uma única vez. Isso ainda é código em PR, não prova de execução: faltam CI verde, integração PostgreSQL e homologação Sandbox antes de ativar cobrança. Ver `In-flight webhook and new Checkout concurrency` em `docs/ORDYS-BILLING-LIFECYCLE.md`.
10. Homologar, no mínimo: contratação aprovada; recusa; timeout e resposta ambígua; evento duplicado e fora de ordem; renovação; atraso; recuperação; cancelamento de Checkout; cancelamento de recorrência; acesso até o fim do período pago; estorno; chargeback; conta Free sem acesso Plus; e exclusão de conta com billing inexistente, pendente e conciliado.
11. Confirmar que a resposta de pagamento, o webhook e a associação do titular são validados no backend. O redirecionamento de retorno do Checkout nunca concede Plus por si só.
12. Concluir Termos de Uso, Política de Privacidade, identificação do fornecedor, canal de suporte, renovação automática, cancelamento, reembolso e regras para menores. A contratação inicial continua limitada a pessoas com 18 anos ou mais; o uso Free por menores exige análise própria.
13. Antes da liberação, confirmar que `ORDYS_PLUS_AI_ENABLED = false` e `billing_enabled = false` continuam sendo os padrões no código e no banco.
14. Na janela de lançamento, depois de todas as funções, do quiz web e do app com as validações de assinatura implantados e testados, habilitar de forma controlada `ORDYS_PLUS_AI_ENABLED = true` em `supabase/functions/_shared/ordys-ai-access.ts`. Manter `billing_enabled = false` nesta etapa para não iniciar contratações antes da verificação final.
15. Só depois da homologação final e da confirmação de que os gates Plus estão ativos, habilitar os planos aprovados e, por último, definir `ordys_billing_settings.billing_enabled = true`. Nunca inverter essa ordem.

**Não remover o gate de confirmação de e-mail para acelerar o billing. Não habilitar cobrança com migration faltante, deploy parcial, Sandbox não homologado ou flags descoordenadas.** Se qualquer verificação falhar, manter o billing desligado e interromper a ativação.

## Público menor de idade

O perfil coleta data de nascimento autodeclarada e fuso editável; esses campos não constituem comprovação de idade nem de residência. Como o titular pode alterar `birth_date`, um menor pode se declarar maior e passar pela regra atual. Antes de liberar chamadas à OpenAI ou contratação recorrente sob uma política 18+, é necessário escolher e implementar age assurance confiável, com resultado verificado no servidor e controles de privacidade/retencão. A Issue [#323](https://github.com/igniteprosperety-collab/ordys-academy.app/issues/323) bloqueia essa liberação. Isso é separado da política para menores que usem recursos Free: Política de Privacidade, Termos e fluxo com responsáveis legais continuam gates independentes.

## Estado desta implementação

Esta branch contém o schema, funções de Asaas Checkout/status/cancelamento/webhook/retorno, bloqueio server-side de recursos Plus e painel de assinatura no Perfil. Não contém secrets, valores comerciais, integração ativa com conta Asaas ou deploy em produção.

O billing permanece desligado por padrão. Nenhum pagamento pode ser iniciado até a ativação explícita e o preenchimento seguro dos dados de ambiente.
