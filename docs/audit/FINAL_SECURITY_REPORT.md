# Reauditoria final de segurança

24/11/2026. Fontes atuais, HTTP local Node, PostgreSQL sintético Python, Chromium e dependências travadas. Sem pentest externo/host de produção. Nenhum CRITICAL confirmado; dois HIGH externos AUD-009/010 abertos.20/23 achados iniciais validados,1 implementado sem gate remoto,2 bloqueados. Dois novos defeitos corrigidos. Tracker contém evidências por item.

## Controles e comprovação

Testes diretos comprovam dois usuários/tenants sem leitura/alteração/exclusão cruzadas, papéis administrativos sem notas clínicas, atribuições/membership, portal arquivado e exportações isoladas. Não dependem das restrições da UI. Sessões têm hash/TTL/revogação persistente; produção usa cookies Secure/HttpOnly/SameSite Strict. Verificação profissional/reset único concorrente/MFA/recovery/antirreplay e senha atual testados. Nenhuma rota clínica anônima indevida identificada. Rotas públicas de ativação/reset/invites exigem token/capacidade válida; health/políticas são públicas intencionalmente. Clínica mantém flag original desativada no perfil produtivo.

Mutações produção exigem Origin explícita allowlist e JSON; CORS não substitui autorização. Corpo1MB, fila64, limiter persistente IP/conta/fluxos e timeouts. Headers/CSP, logs operacionais estruturados sem corpo/URL/PII e erros genéricos. Auditoria clínica mantém identificadores necessários com retenção default90dias a confirmar. SQL parametrizado, DTO allowlist, UUID/enum/medidas/datas/tamanhos, rollback em erro, revisão obrigatória, reset único e conflito de agenda. SQLite sem RLS: proteção por escopo/constraints; JSON semântico parcialmente validado na aplicação. Python com filtros/constraints/locks; grants reais não validados.

Não há upload/billing/webhook financeiro ou destino HTTP arbitrário controlado pelo cliente. Sem fluxo explorável novo confirmado de injection/XSS/SSRF/path traversal no código revisto; isso não é garantia universal. UI escapa dados e políticas usam textContent.

## Inventário Node atualizado

Todas as rotas privadas exigem sessão válida. Domínio clínico exige e-mail verificado em produção, membership ativo, capacidade e ownership/atribuição. Limite global em todas as APIs e limites adicionais sensíveis. Listas clínicas offset/limit máximo200; consumidores atualizados. DTOs nunca incluem hash/salt/segredo MFA. Draft e publish exigem expectedRevision:428 ausente,409 stale.

| Método e rota | Acesso |
|---|---|
| POST /api/register | Público intencional; cria identidade própria |
| POST /api/login | Público intencional |
| POST /api/logout | Público idempotente, afeta somente sessão apresentada |
| GET /api/me | Prof; P também W da sessão |
| GET /api/workspaces/legacy-preview | Prof; P exige W |
| POST /api/workspaces/select | Prof + membership do destino; papel compatível |
| GET /api/clinicians | Prof+W+G/patients.assign |
| GET /api/dashboard | Prof+W; clínico vê atribuições; N também A conforme capacidades |
| GET /api/patients | Prof+W; N A ou C; P admin ou clínico atribuído |
| POST /api/patients | Prof+W; patients.manage/create; dados clínicos exigem C |
| GET /api/patients/{id} | Prof+W; A administrativo ou C |
| PATCH /api/patients/{id} | Prof+W; N demographics patients.manage, clinical C; P manager ou C |
| PUT /api/patients/{id}/assignments | Prof+W+G/patients.assign |
| PATCH /api/patients/{id}/portal-access | Prof+W+C |
| POST /api/patients/{id}/invitations | Prof+W+C |
| POST /api/patients/{id}/password-resets | Prof+W+C |
| POST /api/patient/invitations/validate | Público intencional, exige token válido |
| POST /api/patient/activate | Público intencional, token + e-mail vinculado |
| POST /api/patient/login | Público intencional |
| GET /api/patient/me | Portal; vínculo do paciente/estado ativo |
| POST /api/patient/logout | Público idempotente, só sessão apresentada |
| POST /api/patient/password-resets/validate | Público intencional, token válido |
| POST /api/patient/password-resets/complete | Público intencional, token válido |
| GET /api/assessments | Prof+W+C |
| POST /api/assessments | Prof+W+C |
| GET /api/appointments | Prof+W; A agenda ou C atribuído |
| POST /api/appointments | Prof+W; N A agenda ou C, notas só C; P exige C |
| PATCH /api/appointments/{id} | Prof+W; N agenda A ou C; P C |
| POST /api/goals | Prof+W+C |
| PATCH /api/goals/{id} | Prof+W+C |
| GET /api/meal-plans | Prof+W+C |
| POST /api/meal-plans | Prof+W+C |
| GET /api/meal-plans/{id} | Prof+W+C |
| PUT /api/meal-plans/{id}/draft | Prof+W+C |
| POST /api/meal-plans/{id}/publish | Prof+W+C |
| POST /api/workspaces/migrate-personal | Prof; somente legado próprio |
| GET /api/workspaces | Prof |
| POST /api/workspaces | Prof; O do contexto quando já possui workspace conforme regra |
| POST /api/workspace-invitations/accept | Prof, e-mail da identidade deve corresponder ao convite |
| GET /api/workspaces/{w}/members | Prof+membership W+members.manage |
| GET /api/workspaces/{w}/invitations | Prof+membership W+members.manage |
| DELETE /api/workspaces/{w}/invitations/{id} | Prof+membership W+members.manage |
| PATCH /api/workspaces/{w} | Prof+membership W+workspace.manage |
| GET /api/workspaces/{w}/roles | Prof+membership W+members.manage |
| POST /api/workspaces/{w}/invitations | Prof+membership W+members.manage; só O concede operations_admin |
| PATCH /api/workspaces/{w}/members/{id} | Prof+membership W+members.manage; restrições owner/operations |
| DELETE /api/workspaces/{w}/members/{id} | Prof+membership W+members.manage; só O remove O |
| POST /api/auth/password-reset/request | Público;202 genérico, apenas contas verificadas elegíveis |
| POST /api/auth/password-reset/complete | Público;token hash/TTL/uso único + nova senha |
| POST /api/auth/verification/request | Sessão;identidade própria |
| POST /api/auth/verification/complete | Público;token válido + escolha de senha |
| GET /api/account/export | Sessão;conta própria, DTO seguro |
| POST /api/account/mfa/setup | Sessão+senha;produção exige e-mail verificado |
| POST /api/account/mfa/confirm | Sessão+código;revoga sessões |
| POST /api/account/mfa/disable | Sessão+senha+TOTP/recovery |
| POST /api/account/password | Sessão+senha atual+MFA quando habilitado |
| POST /api/account/sessions/revoke | Sessão;revoga todas as sessões próprias |
| POST /api/account/deletion-request | Sessão;pedido próprio rastreável |
| DELETE /api/account | Sessão+reautenticação;bloqueia vínculos clínicos |
| GET /api/patients/{id}/export | Sessão+workspace+clínico atribuído;auditoria |
| GET /api/patient/export | Portal ativo próprio;somente planos publicados |
| GET /api/legal/privacy | Público intencional;texto aprovado externo |
| GET /api/legal/terms | Público intencional;texto aprovado externo |
| GET /api/goals | Sessão+workspace+atribuição clínica;paginado |
| GET /health | Público intencional;liveness |
| GET /ready | Público intencional;readiness SQLite |

Inventariadas 66 combinações método/rota Node, incluindo health/readiness. Fontes server.js/account-security.js; localização em evidence/route-handlers.txt. Regras de papéis do inventário inicial preservadas; controles globais acima substituem antigas lacunas de limites/origem.

## Python experimental

37 rotas decoradas; não é backend comercial equivalente, pois equipe e ciclo novo de conta não têm paridade integral. Produção desliga docs/redoc/openapi; health público. Demais rotas seguem cookie/token/workspace/atribuição.

- `GET /api/appointments`
- `GET /api/assessments`
- `GET /api/clinicians`
- `GET /api/dashboard`
- `GET /api/goals`
- `GET /api/me`
- `GET /api/meal-plans`
- `GET /api/meal-plans/{plan_id}`
- `GET /api/patient/me`
- `GET /api/patients`
- `GET /api/patients/{patient_id}`
- `GET /api/workspaces/legacy-preview`
- `GET /health`
- `PATCH /api/appointments/{appointment_id}`
- `PATCH /api/goals/{goal_id}`
- `PATCH /api/patients/{patient_id}`
- `PATCH /api/patients/{patient_id}/portal-access`
- `POST /api/appointments`
- `POST /api/assessments`
- `POST /api/goals`
- `POST /api/login`
- `POST /api/logout`
- `POST /api/meal-plans`
- `POST /api/meal-plans/{plan_id}/publish`
- `POST /api/patient/activate`
- `POST /api/patient/invitations/validate`
- `POST /api/patient/login`
- `POST /api/patient/logout`
- `POST /api/patient/password-resets/complete`
- `POST /api/patient/password-resets/validate`
- `POST /api/patients`
- `POST /api/patients/{patient_id}/invitations`
- `POST /api/patients/{patient_id}/password-resets`
- `POST /api/register`
- `POST /api/workspaces/select`
- `PUT /api/meal-plans/{plan_id}/draft`
- `PUT /api/patients/{patient_id}/assignments`

## Dependências, segredos e riscos residuais

17Node,14Python,2E2E aprovados. Npm/pip-audit finais zero advisories conhecidos; oito IDs Python resolvidos. Imagens/OS e CI remoto não executados. Busca por formatos de segredo não expôs valores; auditoria inicial12commits/88blobs sem match, sem garantia universal. Nenhuma credencial real comprometida identificada. Se exposição externa surgir, revogar/rotacionar no emissor, invalidar sessões e revisar acessos; apagar código não basta.

SMTP real/TLS/proxy/host/criptografia de volume/backup independente/alertas/restore real pendentes. MFA/outbox cifrados não cifram prontuário inteiro. SQLite exige uma instância/volume local, registro1MiB/workspace32MiB/metadata32MiB; sem capacidade multi-host demonstrada. SMTP at-least-once pode duplicar mesma mensagem/token. Restore cifrado invalida sessões/links antigos somente na cópia nova. Retenção/exclusão clínica e bases legais dependem do responsável; sem declaração LGPD integral. Testes browser/Axe são escopados e não certificam compatibilidade ou acessibilidade integral.
