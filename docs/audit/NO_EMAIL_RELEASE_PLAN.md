# Publicação sem SMTP — 2026-11-24

Escopo autorizado: adiar SMTP, documentos legais e operação de backups. Não comprar serviços. Não afirmar prontidão comercial comprovada. Migrações continuam sendo dependência funcional, não um recurso pago dispensável.

- [x] Adicionar EMAIL_ENABLED=false explícito, mantendo padrão seguro anterior.
- [x] Não emitir tokens nem enfileirar mensagens nesse modo; endpoints de envio/conclusão retornam 503 uniforme.
- [x] Cadastro e acesso com senha funcionam sem atribuir emailVerified=true; MFA, isolamento e autorização permanecem aplicados. A posse do e-mail não fica comprovada, risco aceito no escopo solicitado.
- [x] Permitir LEGAL_DOCUMENTS_REQUIRED=false explícito; documentos ausentes retornam indisponibilidade, sem textos fictícios.
- [x] Manter origem HTTPS, chave de criptografia e esquema compatível obrigatórios.
- [x] Executar regressões, lint, tipos e build; registrar evidências.
- [x] Preparar migração Neon com acesso autorizado; publicar somente após confirmar esquema funcional. Se acesso indisponível, documentar impedimento real.
