# Publicação sem SMTP — estado em 2026-11-24

## Decisão do responsável

O usuário autorizou publicação em produção e adiou SMTP, documentos legais e operação de backups. Isso altera o escopo de publicação, não resolve os riscos jurídicos/de recuperação registrados na auditoria. Não houve contratação ou mudança de plano. Classificação continua INTERNAL ALPHA até comprovação operacional; publicação em domínio produtivo não equivale a PRODUCTION READY.

## Implementado e validado no código

- `EMAIL_ENABLED=false`: cadastro/login sem confirmar posse do endereço. `emailVerified` permanece false; nenhum endereço é marcado como verificado automaticamente. O isolamento continua baseado no ID da conta autenticada, nunca no e-mail declarado.
- Solicitação e conclusão de verificação/reset por e-mail retornam 503 uniforme. Não se criam tokens nem mensagens; worker não entrega a fila nesse modo. Mensagens existentes permanecem cifradas até expiração ou futura ativação autorizada.
- MFA com autenticador, senha atual, cookies seguros, origem, rate limiting e revogação continuam aplicados. `MAIL_ENCRYPTION_KEY` continua obrigatória pois também deriva a chave de MFA. Não é uma credencial SMTP.
- `LEGAL_DOCUMENTS_REQUIRED=false`: startup não exige arquivos legais. Rotas de documentos ausentes retornam 503; não há documento fictício nem declaração de conformidade. A configuração padrão continua exigindo SMTP/verificação/documentos.
- A tela de segurança informa que recuperação por e-mail está indisponível.

## Validação

- `pnpm lint`: passou.
- `pnpm typecheck`: passou.
- `pnpm build`: passou.
- `pnpm test:ci` com PostgreSQL local descartável: 31 testes aprovados, 0 falhas, 0 ignorados. Inclui modo production sem SMTP/políticas, cookies Secure/HttpOnly/SameSite, bloqueio de origem, MFA e ausência de tokens/outbox.
- `pnpm test:e2e`: 2 aprovados (1440px/390px). Aviso de variáveis de cor do Node sem impacto.
- Tentativas intermediárias: conexão local recusada por porta incorreta (5432 vs 55489), corrigida; consulta de teste usava nome incorreto auth_tokens, corrigido para professional_tokens; referência global state declarada para lint. Nenhuma regra de teste foi relaxada.

## Ambiente externo

Neon conectado, projeto NutriTrack `late-band-38250917`, branch production `br-super-morning-b6ga2w10`, banco neondb. Consulta somente de metadados confirmou storage_migrations versão 1; migração 2 ainda necessária. Sem exclusões/alterações reais executadas nesta etapa. Não é possível omitir migrações e manter compatibilidade funcional.

Vercel conectado, mas equipe `nutritrak1` retorna 403 por ausência de grant da equipe. Link de consentimento foi fornecido pelo mecanismo oficial da Vercel, válido por 10 minutos. A conexão existente deve ser autorizada para a equipe, sem reenviar tokens no chat.

## Sequência pendente

1. Aprovar acesso à equipe Vercel e confirmar projeto/conexão de banco sem imprimir segredos.
2. Validar/applicar migração aditiva 0002 em transação, checar conflitos de identidade e permissões do runtime. Não eliminar registros para solucionar conflitos.
3. Configurar APP_ORIGIN HTTPS, DB_AUTO_MIGRATE=false, EMAIL_ENABLED=false, LEGAL_DOCUMENTS_REQUIRED=false e chave privada de MFA no ambiente protegido. Preservar chave existente se já houver MFA.
4. Publicar código validado na main e acompanhar build/deploy. Conferir readiness, rotas de autenticação, headers e fluxo sem e-mail.

Nenhum deploy ou push à main foi realizado nesta etapa. SMTP/políticas/backups seguem adiados por escolha do responsável; riscos de perda de acesso, ausência de comprovação do endereço, recuperação e privacidade permanecem documentados.
