# Verificação de acesso à main oficial e próximo passo

## Acesso verificado agora (06/11 01:21 UTC, somente leitura)
- Conexão "Prosperety's GitHub API": OAuth, acesso confirmado ("has access: yes"). Ela não está vinculada ao projeto, e para ler não é preciso vincular.
- Repositório `igniteprosperety-collab/ordys-academy.app`, ref `13d353269103411fad213890c449ef5a4578569e`:
  - `README.md`: HTTP 200, blob `f15e372e84facdd0dfec3d3ec25c1fd5c0baffc4`, 2241 bytes.
  - `package.json`: HTTP 200, blob `42f3c0df12d0cfbc070d7ac69757f53b4c967e0d`, 3801 bytes.
- Não falta nenhuma autorização ou escopo.

## Situação do projeto
A importação seletiva dessa mesma versão da main já foi feita nesta sessão. Foi verificada assim:
- Typecheck sem erros e build com resultado "build OK".
- Testes: 89 de 89 passam quando rodados um arquivo por vez. Rodando todos de uma vez, 6 testes de logout e o arquivo de testes da lógica de planejamento falham; cada um passa sozinho.
- Navegador, em modo "sem conta" e com a conta existente: início, calendário, tarefas, disciplinas, estudos, simulados, desempenho e perfil abriram sem erros nem requisições falhas ao backend. Recuperação de senha e privacidade foram abertas no modo "sem conta".
- Não foram testados: cadastro, login por e-mail, login com Google e Android.

Arquivos gerados preservados: `src/integrations/*`, `src/start.ts`, `src/server.ts`, `.env`, `supabase/config.toml` e a lista de rotas gerada.

## Próximo passo proposto (o mais curto)
1. Antes de qualquer ajuste, rodar `git hash-object` nos arquivos importados de `src/` e comparar com os blobs da árvore `7b3c5338…`, para registrar a paridade. As únicas diferenças esperadas são `src/lib/native-auth.ts` (Google web pelo login gerenciado) e `src/lib/ordys-ai-access.ts` (o import aponta para `src/lib/ordys-ai-access-shared.ts`).
2. Ajustar o `vitest.config.ts` para os testes rodarem um arquivo por vez (`fileParallelism: false`), o que elimina as falhas ao rodar todos de uma vez.
3. Nas telas cujas funções do backend não estão confirmadas (assistente, recuperação de senha e exclusão de conta), mostrar uma mensagem clara de "indisponível" quando a chamada falhar, sem escrever no banco.
4. Fazer uma nova verificação das rotas no navegador. Não publicar.

## Bloqueios (fora do alcance sem autorização)
- Confirmação de e-mail real: exige a migration que remove o trigger de auto-confirmação e o envio de e-mails configurado.
- Migrations 19 a 33 e Edge Functions da main: não foram aplicadas nem implantadas.
