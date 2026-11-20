# Ordys Academy — Plano acelerado de finalização da V1

**Atualizado:** 20/11/2026  
**Branch de referência:** `main`  
**Escopo escolhido:** V1 individual do estudante. Não ampliar o produto enquanto os fluxos essenciais não forem aceitos.

## Decisão de execução

Finalizar primeiro uma versão web/PWA confiável do espaço individual do estudante. Não iniciar reescrita de framework, não trocar Supabase e não ativar cobrança, IA Plus ou conexões professor–estudante nesta rodada.

A base atual já contém as telas e o modelo de dados individual. O trabalho restante deve se concentrar em segurança do banco real, autenticação, persistência e aceite de uso. O pacote Android será uma frente separada: a árvore atual tem manifest PWA e componentes Capacitor como dependências, mas não contém `capacitor.config.ts`, diretório Android, CLI Capacitor ou workflow de APK/AAB. Não anunciar distribuição Android até existir uma cadeia de build e assinatura verificável.

## O que entra na V1

- Criar conta, confirmar e-mail, entrar, recuperar senha e sair.
- Perfil do estudante e preferências acadêmicas.
- Disciplinas, tópicos e andamento do conteúdo.
- Tarefas e subtarefas.
- Provas, notas e frequência.
- Agenda, plano de estudos e sessões de foco.
- Revisões, metas, check-in e desempenho.
- Histórico pessoal e persistência depois de fechar e reabrir a aplicação.

## O que fica desligado ou fora desta entrega

- Ordys Plus, cobrança recorrente e criação de checkout Asaas.
- Recursos avançados de IA que dependem de entitlement pago.
- Uploads de arquivos/fotos de estudantes.
- Workspace docente, turmas, convites, entregas e devolutivas.
- Notificações nativas/Push e publicação Android até haver build, assinatura e teste em aparelho.

Esses itens podem existir no código ou em documentação, mas não podem ser apresentados como funcionalidades liberadas da V1.

## Evidência já obtida

| Item | Estado | Evidência |
| --- | --- | --- |
| TypeScript, testes unitários, lint e build | **Passou** | GitHub Actions, execução no SHA `313e6547358cf88bacff448ee5737e5f964fec18` |
| Cadeia limpa de migrations | **Passou** | 46 migrations aplicadas do zero em Supabase local descartável, SHA `0dcb5fc52bc948375cbfdb8bf72923d3a182c8a2` |
| Proteções RLS do núcleo estudantil | **Implementadas e em validação** | Teste pgTAP com dois usuários sintéticos em `supabase/tests/ordys_student_core_rls_test.sql`; workflow atualizado para executar `supabase test db` |
| Código sincronizado com o projeto Lovable | **Sincronização de commit confirmada anteriormente** | O SHA principal foi reconhecido no projeto conectado; não prova preview nem deploy |
| Banco Supabase remoto | **Não verificado** | O limite de ações gratuitas do ambiente Lovable impediu consultas read-only nesta rodada |
| Fluxos de Auth e persistência no navegador real | **Não aceitos ainda** | O preview identificado redirecionou para o login do Lovable; não foi possível executar teste autenticado |
| Distribuição Android | **Não preparada nesta árvore** | Sem configuração Capacitor, projeto Android ou workflow de APK/AAB |

## Ordem de execução — caminho crítico

### 1. Fechar a segurança do núcleo individual

Critério de saída:
- pgTAP passa no banco local descartável.
- As 22 tabelas de dados individuais têm RLS e policy para authenticated.
- anon não recebe acesso direto às tabelas privadas.
- Usuário A lê e altera somente seus dados.
- Usuário B não lê nem apaga dados de A.
- Inserções não conseguem atribuir dados a outro usuário nem referenciar disciplina/tópico de outra conta.

Não usar mocks como prova de RLS. A prova deve executar no Postgres.

### 2. Reconciliar o banco remoto sem alterar dados

Procedimento obrigatório quando o ambiente read-only estiver acessível:
1. Confirmar o ID do projeto Supabase usado pela aplicação.
2. Obter backup e verificar que há procedimento de restauração.
3. Exportar schema e ledger de migrations do projeto remoto.
4. Comparar cada uma das 46 migrations com o estado real do banco.
5. Classificar cada versão como aplicada, ausente, divergente, parcial ou não verificável.
6. Só então preparar uma migration corretiva mínima, validá-la no banco descartável e executar pelo fluxo suportado.

**Proibido:** reset remoto, aplicar as 46 migrations em lote, editar o ledger por suposição ou executar migrations de cobrança no banco de produção.

### 3. Aceitar autenticação e persistência

Testar com contas sintéticas novas, sem dados pessoais reais:
- cadastro → confirmação de e-mail → login;
- recuperação → troca de senha → novo login;
- logout → login novamente;
- criar/editar/excluir disciplina e tarefa;
- registrar nota, frequência e sessão de estudo;
- fechar e reabrir a aplicação e confirmar que tudo permanece;
- trocar entre duas contas e confirmar que os dados nunca se misturam;
- verificar estados de erro, rede lenta e sessão expirada.

### 4. Escolher o canal de entrega mais rápido

**Recomendação atual:** aceitar primeiro a versão web/PWA, porque esse é o formato efetivamente descrito pela árvore atual. Não atrasar a entrega tentando gerar um APK a partir de uma configuração Android que não existe no branch.

Android só entra no critério de lançamento quando houver:
- Capacitor configurado e compatível com o build TanStack Start;
- workflow de build reproduzível;
- chave de assinatura permanente e protegida;
- instalação/atualização testada em aparelho real.

### 5. Fechar a liberação

Publicar a V1 apenas quando:
- CI verde no SHA final;
- teste RLS positivo e negativo aprovado;
- banco remoto reconciliado e backup restaurável;
- Auth e persistência aprovados em ambiente real;
- nenhuma chave privilegiada no bundle público;
- os recursos fora do escopo continuarem desativados;
- política de privacidade e fluxo de exclusão de conta conferidos.

## O que pode avançar sem acesso do proprietário

- Revisar e corrigir código independente.
- Criar e executar testes unitários, estáticos, de tipagem e pgTAP local.
- Testar a cadeia completa de migrations em banco descartável.
- Revisar exposição de segredos, rotas, feature flags e dependências.
- Preparar workflows, documentação de aceite e scripts reproduzíveis.

## O que não deve ser simulado

- Estado do banco remoto, secrets, domínio ou deploy.
- Login em conta real e confirmação de e-mail.
- Resultado de compra ou entitlement Asaas.
- Teste em aparelho Android.
- Aceite de privacidade/jurídico para IA e dados de menores.

Esses itens exigem ambiente ou credenciais reais. Até lá, devem permanecer explicitamente como pendências, não como funcionalidades concluídas.

## Regra para evitar ciclos

Cada rodada deve terminar com um artefato verificável: commit, teste, relatório de comparação ou aceite. Não reabrir pesquisa já encerrada sem evidência nova. Não reescrever o que já passou. Corrigir somente a falha observada no SHA atual e reexecutar o gate correspondente.
