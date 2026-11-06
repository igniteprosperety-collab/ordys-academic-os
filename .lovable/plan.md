# Plano: atualizar o ORDYS a partir da main oficial antes de 08/11

## O que foi verificado (somente leitura, 06/11 01:06 UTC)
- O código deste projeto fica no repositório interno do Lovable (`origin` = git.private.lovable...), na versão `4e874bc`. Ele **não** está ligado ao `igniteprosperety-collab/ordys-academy.app`.
- O commit da main `13d3532...` **não existe** aqui.
- A API do GitHub retorna 404 para o repositório (privado e sem credencial).
- Não há conexão GitHub disponível neste workspace.
- **Conclusão: este projeto não consegue ler a main.** Nenhuma sincronização é possível no estado atual.
- Arquivos gerados que precisam ser preservados: `.env`, `src/integrations/supabase/{client.ts,client.server.ts,auth-middleware.ts,auth-attacher.ts,previewAuthStorage.ts,types.ts}`, `src/integrations/lovable/index.ts`, `supabase/config.toml`, `src/start.ts` (bearer middleware), `src/server.ts`, `vite.config.ts`.
- Dependências atuais: `@supabase/supabase-js` e `@lovable.dev/cloud-auth-js` já estão instaladas. O Capacitor não está.

## Caminhos possíveis (do menor para o maior risco)

**A. Upload da main como ZIP neste chat (recomendado, cabe no prazo)**
- O proprietário baixa a main em GitHub → Code → Download ZIP (commit 13d3532) e anexa o ZIP aqui.
- Eu inspeciono o ZIP. Copio somente `src/routes`, `src/components`, `src/lib` (incluindo `native-auth.ts`), `src/hooks`, `src/styles.css`, `public/` e `tests/`. Faço o merge de `package.json` sem sobrescrever os arquivos gerados listados acima. Também excluo `.git`, `node_modules`, `android/` e `dist`.
- Risco: médio. A main pode depender de nomes de variáveis ou de um client Supabase próprio, que eu adaptaria ao client gerado. As migrations 19 a 33 ficam pendentes: telas que usam colunas novas podem falhar até a revisão delas.

**B. Conexão GitHub API (connector)**
- O proprietário cria a conexão em https://lovable.dev/connectors/github/connect?workspace=84de99a39ad98d2f535a com acesso ao repositório privado. Eu leio os arquivos pela API e aplico a mesma cópia seletiva do caminho A.
- Risco: médio. É mais lento, com muitos arquivos e limite de requisições, mas é rastreável por commit.

**C. Git Sync**
- O Git Sync cria um repositório novo. Ele não liga um repositório existente.
- Risco: alto e lento. Exigiria mesclar a main nesse repositório novo. Não serve para o prazo.

## Sequência após a aprovação (caminho A ou B)
1. Ler a main e comparar com o snapshot atual. Listar os imports de Supabase/env e as dependências de colunas das migrations 19 a 33.
2. Copiar o código, adaptando a autenticação ao client gerado. Na web: e-mail/senha, cadastro, reenvio de confirmação e recuperação de senha, com Google mantido. O `native-auth.ts` fica intacto para o Android.
3. Rodar o build e os testes e verificar pela preview, nesta ordem: login/cadastro, calendário, tarefas, disciplinas, estudos e simulados.
4. Billing/Asaas fica desativado ou oculto, sem alterações.

## Bloqueios até 07/11
1. **Acesso à main:** sem o ZIP ou uma conexão GitHub, nada avança. Depende do proprietário.
2. **Confirmação de e-mail:** o trigger `ordys_auto_confirm_email_trigger` confirma contas automaticamente. Para o fluxo de confirmação funcionar de verdade, é preciso uma migration separada, autorizada explicitamente. O envio de e-mails também precisa estar configurado e validado.
3. **Migrations 19 a 33 não aplicadas:** se o código da main depender delas, cada uma precisa de revisão e autorização. Backup não confirmado.
4. **Publicação:** o projeto não está publicado. O proprietário precisa publicar depois de validar a preview.

## Ação concreta do proprietário agora
Anexar aqui o ZIP da main (commit 13d3532), ou criar a conexão GitHub pelo link acima. Depois disso, aprovar este plano.
