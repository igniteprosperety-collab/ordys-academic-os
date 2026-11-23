# Reconciliação das migrações — auditoria somente leitura (23/11/2026)

## Fatos verificados agora
- Ledger remoto: 20 migrações, última `20261102010000`. Fora de ordem: `20261031040000` e `20261102010000` aplicadas, mas `20261029232900..20261031030000` não.
- Pasta local `supabase/migrations/`: 46 arquivos, dos quais 26 faltam no ledger (`20261029232900` a `20261112010000`, exceto as duas acima). Você citou 31: as 5 restantes (assurance de IA #323, admin) não estão nesta cópia local e precisariam ser lidas no GitHub.
- Trigger `ordys_auto_confirm_email_trigger`: ativo. `pg_cron`/`pg_net`: ausentes. Funções de billing: ausentes. 25 tabelas públicas.
- Integridade dos dados: 7 restrições NOT VALID (grades e profiles), 0 violações; 0 sessões de foco órfãs; 0 tentativas de simulado com dificuldade inválida; padrão de dificuldade já é `'medio'`; 2 perfis.
- Divergência schema x ledger: algumas migrações de setembro estão no ledger, mas o efeito delas está incompleto (FK `plan_session_id` e `btrim/left` de `handle_new_user` ausentes, conforme leitura anterior). Antes de qualquer aplicação, comparar o SQL de cada uma com o catálogo.

## Matriz (migração, efeito, precondições, risco, ordem)
| # | Migração | Efeito | Precondições | Risco | Ordem |
|---|---|---|---|---|---|
| 1 | 20261031020000_fix_quiz_difficulty_default | Corrige o padrão de dificuldade | Nenhuma (padrão já está correto) | Baixo, sem efeito | 1 |
| 2 | 20261031050000_revoke_public_trigger_function_execution | Revoga EXECUTE de funções de trigger | anon já não executa; checar authenticated | Baixo | 2 |
| 3 | 20261029232900_delete_recovery_hash_on_account_deletion | `delete_own_data` passa a apagar o hash de recuperação | Tabela existe | Baixo | 3 |
| 4 | 20261029232950_ordys_billing_schema_status | Função informativa do billing | Nenhuma; só leitura | Baixo | 4 |
| 5 | 20261031030000_ai_content_reports | Tabela de denúncias de IA | GRANT/RLS no arquivo; a IA continua bloqueada | Médio (abre tabela nova) | 5, opcional |
| 6 | 20261029233000_remove_untracked_auto_confirm_email | Remove o auto-confirm | **SMTP/e-mail de confirmação funcionando e testado**, backup | Alto: sem SMTP, novos cadastros ficam presos | Separada, só depois do SMTP |
| 7 | 20261031010000_ordys_plus_billing_foundation | Tabelas, RLS e flags de billing (`billing_enabled=false`) | Backup, aprovação da PR #320 | Médio-alto | Bloco billing |
| 8-17 | 20261103010000 … 20261105060000 | Serialização de exclusão, guardas de webhook e de reconciliação | Dependem de 7 | Alto se fora de ordem | Bloco billing, em sequência |
| 18 | 20261111010000_ordys_bound_asaas_webhook_replay | Limite de replay de webhook | Depende de 7-17 | Médio | Bloco billing |
| 19 | 20261112010000_ordys_asaas_cron_worker | Worker agendado | `pg_cron` instalado (ausente hoje) | Alto, falha sem extensão | Último, bloqueado |
| — | 5 migrações de IA/admin do GitHub | Não auditadas nesta cópia | Ler do repositório | Indefinido | Após leitura |

Também: validar as 7 restrições NOT VALID (`VALIDATE CONSTRAINT`) é seguro agora (0 violações), como migração própria.

## Como o Lovable Cloud aplica mudanças
- Migrações: só pela ferramenta de migração do agente, uma por chamada, com o SQL idêntico ao arquivo. Fica registrada no ledger. Não há fluxo pela Supabase CLI, nem via `db push`.
- Edge Functions: o projeto só mantém as que já existem; não aceita novas. Rotas do servidor do app (`src/routes/api/...`) substituem as funções, e entram no ar ao publicar o app.
- Preview e app publicado usam o mesmo banco: toda migração vale para os dois imediatamente.

## Ações do owner antes de aplicar
1. Exportar backup (Banco de dados → Configurações → Exportar dados).
2. Aprovar as migrações 1-4 (e 5, se desejado) como primeiro lote.
3. Configurar e testar o SMTP antes da 6.
4. Billing (7-19): só após mesclar a PR #320, instalar `pg_cron` e aprovar o Sandbox. A IA e o Asaas continuam bloqueados.
5. Liberar a leitura das 5 migrações de IA/admin no GitHub.

Nada foi alterado nesta auditoria.
