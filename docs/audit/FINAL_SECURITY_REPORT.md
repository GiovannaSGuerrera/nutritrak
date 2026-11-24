# Segurança final — main PostgreSQL endurecida

24/11/2026. Fontes locais,HTTP direto,PostgreSQL16 descartável e Chromium;sem pentest/host real. Baseline13itens;novo MAIN-014 encontrado/corrigido.12itens validados,incluindo CI Linux,2HIGH externos bloqueados. Nenhum CRITICAL conhecido ou API clínica anônima indevida identificado no código reauditado. Não é certificação de ausência universal de vulnerabilidade.

## Autenticação, autorização e isolamento

Duas identidades profissionais são usadas nos testes diretos GET/PATCH/DELETE/export e listas. DELETE paciente não existe:retorna404;DELETE account só exclui o titular autenticado,ignora ID externo e recusa prontuários. Portal continua limitado a paciente próprio/publicação. SQL resolve owner por sessão/email/token e filtra entidades;não carrega todos os profissionais na requisição normal. FKs compostas e CAS por registro defendem integridade. Sem RLS:runtime tem acesso às tabelas,exigindo login restrito e proteção do servidor;isso não prova IDOR.

Profissional:verify com escolha de senha,reset hash/TTL único,MFA TOTP antirreplay/recovery,senha atual,revoke e epoch. Comparação constante de hashes/códigos,hashes de sessão e TTL8h persistidos. Senhas/segredos não são DTOs. authVersion impede nova sessão de login stale sobreviver ao enableMFA/revoke;teste em duas instâncias. Sessões legadas só compatíveis na versão0. Produção exige HTTPS/origem explícita,Secure/HttpOnly/Strict e verificação para clínica. Origem/CORS não substituem credencial. Corpo1MB/5s,fila64,limites global/IP/conta e timeouts limitam abuso sem desabilitar controles.

Schema aditivo,unicidade entre tipos de identidade,triggers/índices,SQL parametrizado. Erros4xx/409/413 sem stack/dados privados;buffer não libera cookie/sucesso antes de persistir. CSRF:Origin explícita+JSON+Strict/sec-fetch-site. XSS:escape de templates/políticas textContent e CSP sem unsafe-inline. Nenhum fluxo explorável novo confirmado de SQL/command injection,SSRF ou traversal na revisão. Sem upload/billing/webhook financeiro atualmente.

## Inventário atualizado de APIs

Todas as rotas privadas exigem sessão válida;clínica profissional exige e-mail verificado em produção e ownership userId,sem papéis/equipes inexistentes. Limite global1000/IP/15min e autenticação20/IP/15min;quando há email,10/conta/rota/15min. Listas clínicas offset/limit máximo200;frontend segue páginas. Draft/publicação exigem expectedRevision. Rotas públicas necessárias não são chamadas de indevidamente expostas. Controles atuais substituem lacunas das descrições herdadas.

| Método/rota | Acesso |
|---|---|
| GET /api/appointments | Cookie profissional;ownership por userId no servidor |
| POST /api/appointments | Cookie profissional;ownership por userId no servidor |
| PATCH /api/appointments/{id} | Cookie profissional;ownership por userId no servidor |
| GET /api/assessments | Cookie profissional;ownership por userId no servidor |
| POST /api/assessments | Cookie profissional;ownership por userId no servidor |
| GET /api/dashboard | Cookie profissional;ownership por userId no servidor |
| POST /api/goals | Cookie profissional;ownership por userId no servidor |
| PATCH /api/goals/{id} | Cookie profissional;ownership por userId no servidor |
| GET /api/health | Público intencional;consulta banco;sem prontuário |
| POST /api/login | Público intencional;token válido necessário em validate/activate/complete;rate auth20/IP |
| POST /api/logout | Idempotente;revoga somente sessão apresentada |
| GET /api/me | Cookie profissional;ownership por userId no servidor |
| GET /api/meal-plans | Cookie profissional;ownership por userId no servidor |
| POST /api/meal-plans | Cookie profissional;ownership por userId no servidor |
| GET /api/meal-plans/{id} | Cookie profissional;ownership por userId no servidor |
| PUT /api/meal-plans/{id}/draft | Cookie profissional;ownership por userId no servidor |
| POST /api/meal-plans/{id}/publish | Cookie profissional;ownership por userId no servidor |
| POST /api/patient/activate | Público intencional;token válido necessário em validate/activate/complete;rate auth20/IP |
| POST /api/patient/invitations/validate | Público intencional;token válido necessário em validate/activate/complete;rate auth20/IP |
| POST /api/patient/login | Público intencional;token válido necessário em validate/activate/complete;rate auth20/IP |
| POST /api/patient/logout | Idempotente;revoga somente sessão apresentada |
| GET /api/patient/me | Cookie portal ativo e paciente próprio;publicação somente |
| POST /api/patient/password-resets/complete | Público intencional;token válido necessário em validate/activate/complete;rate auth20/IP |
| POST /api/patient/password-resets/validate | Público intencional;token válido necessário em validate/activate/complete;rate auth20/IP |
| GET /api/patients | Cookie profissional;ownership por userId no servidor |
| POST /api/patients | Cookie profissional;ownership por userId no servidor |
| GET /api/patients/{id} | Cookie profissional;ownership por userId no servidor |
| PATCH /api/patients/{id} | Cookie profissional;ownership por userId no servidor |
| POST /api/patients/{id}/invitations | Cookie profissional;ownership por userId no servidor |
| POST /api/patients/{id}/password-resets | Cookie profissional;ownership por userId no servidor |
| POST /api/register | Público intencional;token válido necessário em validate/activate/complete;rate auth20/IP |
| POST /api/auth/password-reset/request | Público,202genérico,elegibilidade verificada,rate porIP/conta |
| POST /api/auth/password-reset/complete | Público,token hash/TTL/uso único,nova senha,revoga sessões |
| POST /api/auth/verification/request | Sessão própria;envia novo link sem confirmar identidade por conta própria |
| POST /api/auth/verification/complete | Público,token válido+escolha de senha;limpa pré-MFA e revoga |
| GET /api/account/export | Sessão própria;DTO sem hashes/segredos |
| POST /api/account/mfa/setup | Sessão+senha;produção exige email verificado |
| POST /api/account/mfa/confirm | Sessão+senha+código;epoch/revogação,códigos uma vez |
| POST /api/account/mfa/disable | Sessão+senha+TOTP/recovery;epoch/revogação |
| POST /api/account/password | Sessão+senha atual+MFA quando ativo;nova senha e epoch |
| POST /api/account/sessions/revoke | Sessão+senha+MFA quando ativo;epoch/revogação global |
| POST /api/account/deletion-request | Sessão+reautenticação;pedido próprio rastreável |
| DELETE /api/account | Sessão+reautenticação;somente própria e sem prontuários |
| GET /api/patients/{id}/export | Sessão profissional+ownership;exportação auditada |
| GET /api/patient/export | Sessão portal ativa;paciente próprio e planos publicados |
| GET /api/goals | Sessão profissional+ownership;agregado paginado |
| GET /api/legal/privacy | Público intencional;texto aprovado externo com versãoSHA256 |
| GET /api/legal/terms | Público intencional;texto aprovado externo com versãoSHA256 |
| GET /api/live | Público intencional;liveness sem prontuário |
| GET /api/ready | Público intencional;readiness inicialização/banco503quando indisponível |
| GET /api/jobs/mail | Operacional;Bearer CRON_SECRET>=32,comparação constante;sem cookie de usuário |

Total:51 métodos/rotas canônicos. Estáticos GET/HEAD resolvem somente public;outros métodos405. Novo job operational não concede acesso a dados clínicos.

## Testes, dados e operação

28 casos Node/PG e2 E2E aprovados;linters/tipos/build e upgrade/restore locais. Outbox AESGCM com TLS/retries e seleção elegível;primeiro envio fora da fila clínica,depois do commit. Retry exige executor real configurado e entrega real ainda não foi comprovada. Não registrar destinatários/tokens/body/URL em logs. Audit com identificadores necessários e retenção90dias configurável;um usuário não expulsa eventos de outro por limite global.

Backup cifrado preserva dados e invalida links/outbox/sessões no restore em destino vazio. Não impede retenção de informações em backups/legacy_snapshot anteriores;reconciliar exclusões é procedimento obrigatório do operador. Exportações usam projeções próprias e não incluem credenciais. Exclusão automática de prontuário não implementada por decisão de retenção ainda pendente,sem declaração LGPD integral.

Scan atual de formatos de segredo e revisão de alterações sem correspondência privada conhecida;limita-se ao escopo registrado,não prova ausência em serviços/histórico externos. Se descobrir exposição,revogar/rotacionar no emissor,invalidar sessões e revisar acessos;não basta apagar arquivo. pnpm audit final zero advisories conhecidos;consulta temporal,sem garantia futura ou scan do host.

Riscos externos bloqueadores:SMTP/chaves/configuração jurídica,conta runtime/grants,pacote Vercel remoto,backup independente/alertas/restore real,homologação clínica/capacidade. Budgets1MB/registro e32MiB/profissional/páginas200 não são SLA. Legado TS ainda incremental;Axe/browser escopados. Código não foi publicado na main/produção nem configurações reais alteradas nesta execução.

CI confirmado no GitHub run45396373697,sem segredos de produção e sem deploy. Revisão do workflow:push/pull_request,contents:read,actionsSHA,checkout sem credencial persistida;nenhum pull_request_target/interpolação de texto não confiável/privilege escalation identificado.

## Estado atual da publicação — 24/11/2026

Publicado na main (código 927dc36) e na Vercel, deploy com runtime restrito dpl_64ufV5ibN1ZMXp7UGkFRy6a7k5Fc READY. Migração Neon 2 aplicada, 11 profissionais/6 pacientes preservados. SMTP, documentos e operação de backups adiados pelo responsável. 31 testes Node/PG, 2 E2E e 15 verificações HTTP externas aprovados. Consulte [NO_EMAIL_RELEASE_STATUS.md](NO_EMAIL_RELEASE_STATUS.md) e evidence/production-smoke-2026-11-24.json. As seções anteriores sobre produção intocada/pedidos de autorização são histórico anterior à publicação, não o estado atual. A nota 83,5 pertence ao pacote anterior com e-mail previsto, não foi recalculada para este modo. MAIN-002 fica BLOCKED no ambiente sem SMTP, embora MFA/senha/revogação e implementação de envio estejam testados; MAIN-008/009 continuam parciais e adiados. Estado consolidado: 11 VALIDATED, 3 BLOCKED (funcionalidades/operação/privacidade adiadas); não significa três falhas exploráveis confirmadas. Classificação INTERNAL ALPHA, sem aprovação comercial integral.
