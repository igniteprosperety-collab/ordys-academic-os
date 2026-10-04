# Auditoria e correção final — Android e autenticação

## Objetivo
Preparar o projeto atual para empacotamento Android local seguro, sem `server.url`, preservando o app web e o modo visita.

## Implementação
- Reconstituir somente a infraestrutura Android ausente nesta cópia, com Capacitor 8.5.2, pacote `app.ordys.academy`, SDK 36 e proteções de release.
- Gerar recursos determinísticos a partir do launcher oficial: fundo adaptativo `#0A1128`, foreground sem arte substituta e fallbacks raster sem borda branca.
- Criar o callback OAuth nativo restrito a `app.ordys.academy://auth/callback`; manter o fluxo web atual fora do Android.
- Implementar o controlador nativo com navegador externo, retorno por URL, troca de código ou tokens, timeout finito, cancelamento seguro e limpeza de listeners.
- Manter o bundle Android local e bloquear referências de preview, `localhost`, código dinâmico e permissões perigosas por verificação automatizada.
- Preservar assinatura privada fora do repositório e validar APK/AAB apenas quando as ferramentas e credenciais estiverem disponíveis.

## Verificação
- Testes, lint e build web.
- Build/sync Android e testes de release disponíveis no ambiente.
- Inspeção do Manifest final, recursos do launcher, bundle empacotado, dependências e caminhos de autenticação.
- Relatório separado entre código corrigido, validações concluídas, dependências da conta Google e condição real para eliminar o aviso do Play Protect.

## Premissa explícita
A branch GitHub privada não está acessível neste ambiente e esta cópia não contém a infraestrutura Android citada. Para não fingir que ela existe, a implementação adicionará apenas a base Android mínima e endurecida exigida, sem alterar telas ou funcionalidades acadêmicas.
