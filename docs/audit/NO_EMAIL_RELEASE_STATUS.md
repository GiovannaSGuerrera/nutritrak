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

Neon conectado, projeto NutriTrack `late-band-38250917`, branch production `br-super-morning-b6ga2w10`, banco neondb. Migração 0002 aplicada em transação com timeout/lock e baseline v1 exigida; versões 1 e 2 presentes. Contagens antes/depois: 11 profissionais e 6 pacientes; 12 identidades, nenhum conflito. Nenhum registro clínico excluído. Não foi criado backup externo, conforme adiamento autorizado.

Vercel equipe `nutritrak1` autorizada pelo usuário. Projeto `prj_rujUSHyfxIisfsj0F43Y5vdgpf86`: origem HTTPS, migrações automáticas desativadas, EMAIL_ENABLED=false, LEGAL_DOCUMENTS_REQUIRED=false e chave de MFA sensível configurados. DATABASE_URL usa conexão pooled do login restrito nutritrack_app somente no target production. O login não cria objetos, bancos ou papéis, não ignora RLS e não altera legacy_snapshot ou exclui storage_migrations; pode atualizar apenas revision nessa tabela. O segredo não foi impresso nem gravado no repositório.

## Publicação concluída no escopo autorizado

Código promovido à main no commit 927dc36aed545bd17e1eba6becf479cbb3f055ed após CI 45401088912 aprovado. Deploy com conexão restrita dpl_64ufV5ibN1ZMXp7UGkFRy6a7k5Fc READY e alias https://nutritrack-eta-ten.vercel.app. Smoke externo anônimo: 15/15 aprovados, incluindo health/readiness com banco, rotas privadas 401, rejeição de origem 403 e indisponibilidade explícita de e-mail/documentos 503. Evidência: evidence/production-smoke-2026-11-24.json; executor scripts/production-smoke.cjs.

Não se cadastraram contas sintéticas nem se acessaram prontuários reais para smoke em produção. Fluxos autenticados completos estão comprovados em teste isolado/CI, não em sessão real de cliente. Não houve teste de carga produtivo, restore real ou aprovação jurídica. SMTP/políticas/backups seguem adiados por escolha do responsável; riscos de perda de acesso, ausência de comprovação do endereço, recuperação e privacidade permanecem documentados. Isso permite a publicação solicitada, mas não altera a classificação INTERNAL ALPHA para PRODUCTION READY.

## Ajuste do login

Campos de autenticador/recuperação ocultos por padrão e no cadastro. Só aparecem após senha válida de conta que já exige MFA; não há sessão emitida sem segundo fator. Senha incorreta não revela a exigência. Lint/tipos/build, 2 regressões PostgreSQL de conta e 2 E2E aprovados antes da publicação deste ajuste.


## Ajuste visual de segurança e login

Formulários de senha/exclusão organizados em cartões responsivos com campos estilizados e rótulos associados. Códigos secundários aparecem apenas para contas com MFA; configuração opcional fica recolhida. Breadcrumb atualizado. Aviso de e-mail contextualizado. Login usa duas linhas inteiras para Acompanhamento nutricional, descrição revisada e sem aviso incorreto de armazenamento local. Lint/tipos/build aprovados; 4 E2E em 1440/1024/768/390px, sem overflow, sem violações Axe sérias/críticas, sem erros CSP. Capturas locais revisadas antes de publicar.

