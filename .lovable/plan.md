# Inspeção READ-ONLY — Autenticação ORDYS (produção yqljcoukgpqdoxiispyn)

Nenhuma alteração foi feita. Este documento é só um relatório; não há implementação a aprovar.

## Fatos verificados

**1) Confirmação de e-mail**
- Existe um gatilho ativo `ordys_auto_confirm_email_trigger` (estado `O` = ligado) na tabela de usuários de login.
- Ele preenche `email_confirmed_at := now()` quando vazio. Na prática, **todo cadastro é auto-confirmado** no banco, seja qual for a opção "Confirm email" do painel.
- Também ativo: `on_auth_user_created`, que cria perfil e preferências de notificação.

**2) Provedores**
- Contas existentes por provedor: só `google` (1 identidade). Nenhuma identidade `email`.
- Isso confirma que o Google já funcionou ao menos uma vez. Não prova se e-mail/senha está ligado.

**3) URLs**
- Site URL: `https://id-preview--39199358-…lovable.app` (preview, não o publicado).
- Allowlist (11): 10 endereços `*.lovable.app` / `*.lovableproject.com` do próprio projeto, incluindo `ordys-academic-os.lovable.app/**`, e `app.ordys.academy://auth/callback` (exato).
- Servidor OAuth (MCP): desligado. Não afeta login.

**4) Erros evidentes**
- O gatilho de auto-confirmação explica por que o cadastro "conclui" sem e-mail: a conta nasce confirmada. Por isso a confirmação pode não ser enviada ou pode ser inútil. Isso contradiz a exigência de confirmar o e-mail.
- Site URL no preview: links de e-mail sem redirect explícito caem no preview, não no app publicado.
- Nenhum erro na allowlist do callback Android.

## Não verificável por mim
- Interruptores do painel: e-mail/senha ligado, "Confirm email", Google ligado e credencial gerenciada ou própria, remetente/SMTP, limite de e-mails por hora. Não tenho ferramenta de leitura para isso.
- Caminho no painel: **Cloud → Users → Auth settings** (Sign In Methods → Email / Google; Email → Advanced para o limite; **Emails** para o remetente).
- Entrega real para o Gmail: nenhum teste foi feito.
