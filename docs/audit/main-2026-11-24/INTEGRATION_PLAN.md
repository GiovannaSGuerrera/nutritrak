# Plano de integração sobre a main atual

Goal: adaptar as correções confirmadas à arquitetura TypeScript/PostgreSQL, preservando Vercel/Neon, a UI atual e dados existentes.
Architecture: serviços tipados incrementais, consultas por profissional, transações de domínio/revisões explícitas, sessão/backup PG existentes. Sem SQLite/Python, equipes novas ou reescrita visual.
Tech stack: Node24, TypeScript, pg, frontend estático.
Spec: opção1 escolhida pelo usuário e reauditoria b759e77 em MAIN_REAUDIT_REPORT.

## Restrições e foco

Sem deploy, alteração produtiva, acesso extra, operação destrutiva ou serviço pago. Não herdar dados/testes/nota de SQLite. Requests diretos entre dois profissionais, corpo lento/abortado, duas abas publicando rascunho stale, falha SQL após validação e restore de backup antigo devem ter regressões explícitas. Todas as novas migrações em banco descartável; grants runtime separados de owner. Push na main pode disparar Vercel e precisa preservar a restrição de deploy.

## Sequência executável

1. **Fronteira HTTP e validação.** Modificar server.ts/security.ts; testes HTTP/PG de corpo parcial, byte limit, timeout, fila cheia/cancelamento, status/data/NaN/null. Ler body limitado antes de enfileirar domínio; remover promessa pendurada e garantir rollback/estado dev. Confirmar que health continua responsivo sob request incompleto. Capturar primeiro teste vermelho e depois verde.
2. **Integridade clínica.** server.ts/relational-schema.ts/postgres-store.ts + migração PG explícita: revisão por plano, exigir expectedRevision no draft/publish, CAS atômico e resposta409 para intenção stale. Frontend app.js recebe revisão e preserva metadados. Agenda revalida overlap ao reativar, inclusive duas instâncias. Testar A/B e não alterar publicação existente.
3. **Consultas e trilha.** Adicionar APIs PG tenant-scoped, paginação limitada e metas agregadas; app.js segue páginas. Substituir snapshot global gradualmente sem remover formatos legados preservados. Separar revisão por domínio para writes independentes. Audit por tempo/tenant, com retenção configurável conforme decisão do responsável. Medir antes/depois em fixture sintética idêntica, sem inventar capacidade.
4. **Conta/privacidade.** Novos módulos TS e migrações expansivas para tokens profissionais, outbox cifrado, MFA e pedidos de privacidade. Reusar contrato de sessões PG e adaptar testes de reset/verificação/TOTP/recovery. Verificação com escolha de senha evita pre-account hijack; SMTP real no runtime, stub só em testes; seleção de lote elegível evita starvation. Exportações por profissional/portal e exclusão somente sem vínculos; retenção clínica não decidida por código. Textos jurídicos/relay real são gates externos.
5. **UI/CSP/gates.** Corrigir classes/SVG e estados de erro/timeout sem unsafe-inline nem substituir layout. Criar E2E reais desktop/mobile, lint semântico e CI com PostgreSQL obrigatório (nenhum skip silencioso), actions SHA/read-only e guard de teste descartável. Typecheck estrito em módulos novos; legado gradual.
6. **Backup/migrações/reauditoria.** Ampliar backup/grants para novas tabelas; garantir restore em destino vazio invalidando todas as novas credenciais efêmeras e sem reativar exclusões. Reexecutar suíte10 atual + novas regressões, tipos/build/lint/audit/E2E e cargas controladas; atualizar tracker/evidências. Só marcar VALIDATED com comando/resultado.
7. **Publicação.** Commit revisável em branch de integração; main sem force-push/substituição. Antes de integrar, verificar mecanismo de deploy automático e obter autorização específica se a atualização publicar produção. Configuração real/grants/SMTP/alertas/políticas continuam documentados como externos até comprovação.

Documentação desta fase é baseline de auditoria; passos acima ainda não implementados na main. Não chamar o plano de correção concluída.
