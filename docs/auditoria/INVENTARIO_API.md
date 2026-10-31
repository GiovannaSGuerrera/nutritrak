# Inventário da API

Contratos deduzidos dos handlers atuais. API Node é o backend padrão; API Python é parcial e não contém as rotas marcadas como somente Node. Respostas comuns de erro: JSON `{error}`; autenticação ausente `401`; recurso ausente/escopo mascarado `404`; validação `400`; conflito de estado/agenda `409`; rota desconhecida `404`. Linhas referem-se a `apps/api/src/server.js` e `apps/api-python/app/main.py`.

## Node — `apps/api/src/server.js`

Autenticação do profissional usa cookie `nc_session`; portal usa `nt_patient_session`. Rotas clínicas também exigem `x-workspace-id` com membership ativo. A autorização específica é descrita por família para evitar repetir a mesma política: owner/admin/assistant com permissões administrativas; clinician precisa de permission + atribuição ativa ao paciente. Não há validação de esquema central; cada handler valida campos.

| Método e rota | Handler / linhas | Auth e autorização | Entrada e saída / persistência / validação e erros |
|---|---|---|---|
| GET `/api/me` | `handle` 393 | profissional por sessão | Saída `{user,workspaces}`; 401 sem sessão. |
| POST `/api/register` | 610 | pública | nome/email/senha, tipo/nome workspace; cria user, workspace/membership e cookie; 201, 400, 409. scrypt; senha 12–200. |
| POST `/api/login` | 671 | pública | email/senha; cookie e user; 401 genérico. |
| POST `/api/logout` | 691 | cookie opcional | revoga sessão em memória, expira cookie; `{ok:true}`. |
| POST `/api/patient/invitations/validate` | 399 | pública, token | token; dados limitados do convite/paciente; 410 inválido/usado/expirado. |
| POST `/api/patient/activate` | 425 | pública, convite | token/email/senha; cria conta, persiste, cria cookie portal; 201, 400/409/410. |
| POST `/api/patient/login` | 511 | pública | email/senha; sessão portal; 401/403. |
| POST `/api/patient/password-resets/validate` | 538 | pública, token | token; nome de paciente; 410 expirado/inválido. |
| POST `/api/patient/password-resets/complete` | 563 | pública, token | token/senha; altera hash, invalida sessões e consome link; 400/410. |
| POST `/api/patient/logout` | 594 | cookie opcional | apaga sessão portal; ok. |
| GET `/api/patient/me` | 600 | paciente autenticado | projeção de planos publicados; 401/403. |
| GET `/api/workspaces/legacy-preview` | 701 | profissional | lista/resumo de registros sem workspace. |
| POST `/api/workspaces/migrate-personal` | 711 | profissional + confirmação explícita/cópia local | nome, IDs principais/atribuição; migra dados legacy; erros por seleção e validação. |
| GET `/api/workspaces` | 792 | profissional | memberships/workspaces ativos. |
| POST `/api/workspaces/select` | 794 | profissional | workspaceId; seleciona/valida membership; salva seleção do lado cliente, não sessão. |
| POST `/api/workspaces` | 814 | profissional | nome/tipo/role; cria workspace/membership. |
| POST `/api/workspace-invitations/accept` | 836 | profissional autenticado, email deve coincidir com convite | token; cria membership; 201, 404 token/e-mail, 409 membro existente. |
| GET `/api/workspaces/:id/members` | 869 | membership + `members.manage` | retorna membros ativos/roles. |
| GET `/api/workspaces/:id/invitations` | 890 | `members.manage` | lista status/metadata de convite, sem token. |
| DELETE `/api/workspaces/:id/invitations/:inviteId` | 915 | `members.manage` | revoga apenas pendente; 404/409. |
| PATCH `/api/workspaces/:id` | 930 | `workspace.manage` | nome; atualiza workspace; 400/404. |
| GET `/api/workspaces/:id/roles` | 942 | membro autorizado | catálogo de papéis/permissões. |
| POST `/api/workspaces/:id/invitations` | 953 | `members.manage` | email/roles; gera token de uso único, expiração; 201, validação/duplicidade. |
| PATCH `/api/workspaces/:id/members/:memberId` | 997 | `members.manage` | roles/status permitidos conforme handler; atualiza membership; erros 400/404/409. |
| DELETE `/api/workspaces/:id/members/:memberId` | 1036 | `members.manage` | remove/revoga membership; valida owner/self conforme regra. |
| GET `/api/clinicians` | 1081 | workspace membro | profissionais clínicos ativos. |
| GET `/api/dashboard` | 1110 | workspace membro; escopo por papel | totais, séries, consultas e atividade filtradas. |
| GET `/api/patients` | 1173 | workspace membro | lista projeção administrativa ou clínica atribuída. |
| POST `/api/patients` | 1188 | permissão de criação/admin + workspace | perfil/dados clínicos conforme role; cria paciente; 201/400. |
| PATCH `/api/patients/:id` | 1240 | acesso administrativo ou clínico adequado | campos de cadastro; atualiza; 404/400. |
| GET `/api/patients/:id` | 1267 | admin ou atribuição clínica | detalhes e dados filtrados por papel. |
| PUT `/api/patients/:id/assignments` | 1302 | `patients.assign` | primary/support IDs; substitui atribuições ativas; exige clinicians no mesmo workspace. |
| PATCH `/api/patients/:id/portal-access` | 1331 | clinician write/autoridade no paciente | status active/suspended/revoked; invalida sessão quando suspende/revoga; revogação terminal; 400/404/409. |
| POST `/api/patients/:id/invitations` | 1380 | clinician write atribuído | gera convite portal, persiste somente hash, token devolvido uma vez; 201/409. |
| POST `/api/patients/:id/password-resets` | 1419 | clinician write atribuído | gera reset 24h e revoga pendentes prévios; token devolvido uma vez; 201/409. |
| GET `/api/assessments` | 1450 | clínica read + atribuição | lista avaliações do workspace com nome paciente. |
| POST `/api/assessments` | 1463 | clínica write + atribuição | medidas, data, notas; grava e calcula IMC/massas; 201/400/404. cintura/quadril aceitam conversão numérica mas sem faixas equivalentes às de peso/altura/gordura. |
| POST `/api/appointments` | 1505 | `agenda.manage` ou clinician atribuído; notas exigem clínico atribuído | paciente, início, duração, tipo/notas; calcula fim; conflito de sobreposição 409; 400/404. |
| PATCH `/api/appointments/:id` | 1546 | `agenda.manage` ou clinical write atribuído | status agendada/realizada/cancelada/falta; atualiza; 400/404. |
| POST `/api/goals` | 1567 | clinical.write + atribuição | patientId, descrição/categoria/prazo; cria meta; 400/404. |
| PATCH `/api/goals/:id` | 1593 | clinical.write + atribuição | status e nota de progresso; 400/404. |
| GET `/api/meal-plans` | 1608 | clinical.read + atribuição | lista resumo/versionamento. |
| POST `/api/meal-plans` | 1643 | clinical.write + atribuição | nome, refeições/itens; valida limites e quantidades; cria rascunho v1; 201/400/404. |
| GET `/api/meal-plans/:id` | 1672 | clinical.read + atribuição | plano, versões e nome paciente; 404. |
| PUT `/api/meal-plans/:id/draft` | 1682 | clinical.write + atribuição | substitui rascunho atual ou cria nova versão; valida limites; 400/404. |
| POST `/api/meal-plans/:id/publish` | 1715 | clinical.write + atribuição | publica rascunho mais recente se refeições/itens/quantidades/unidades válidas; 400/404/409. |
| GET `/api/appointments` | 1737 | `agenda.manage` ou `appointments.manage` | lista ordenada, notas omitidas sem acesso clínico. |
| GET/HEAD estático `/...` | `serveStatic` 1760 | público | arquivos em `apps/web/public`, CSP, nosniff; proteção de caminho e 404. |

## Python — `apps/api-python/app/main.py`

FastAPI valida tipos UUID, modelos Pydantic onde declarados e `HTTPException`. Operações clínicas passam por `principal` e `patient_access`; o workspace ativo vem do cookie/sessão ou `X-Workspace-Id`. Portal é separado. Várias rotas recebem `dict`, com validação manual. Endpoint list abaixo é independente do Node.

| Método e rota | Handler / linha | Auth/autorização | Entrada, saída, persistência e validações |
|---|---|---|---|
| GET `/health` | health 148 | pública | consulta banco; status de saúde. |
| POST `/api/register` | register 153 | pública | AuthInput; cria User/Workspace/Membership e cookie; limite de tentativas, 201/erro. |
| POST `/api/login` | login 166 | pública | AuthInput, rate limit; sessão DB, 401. |
| POST `/api/logout` | logout 176 | cookie opcional | revoga sessão, limpa cookie. |
| GET `/api/me` | me 182 | profissional | usuário/workspaces; 401. |
| GET `/api/workspaces/legacy-preview` | 188 | profissional | preview básico, sem migrador Node. |
| POST `/api/workspaces/select` | 192 | profissional | troca workspace em sessão; valida membership. |
| GET `/api/dashboard` | 205 | profissional | agregados em DB. |
| GET `/api/clinicians` | 217 | profissional | clínicos do workspace. |
| GET `/api/patients` | 229 | profissional | lista filtrada por papel/atribuição. |
| POST `/api/patients` | 244 | profissional com capability | PatientInput; cria registro. |
| GET `/api/patients/{patient_id}` | 254 | profissional com escopo; pode mascarar 404/403 | busca por UUID/workspace; DTO clínico condicionado. |
| PATCH `/api/patients/{patient_id}` | 269 | permission/assignment | dict de campos; atualiza whitelist conforme código. |
| PUT `/api/patients/{patient_id}/assignments` | 285 | operador de atribuição | lista de usuário(s); atualiza atribuições. |
| POST `/api/patients/{patient_id}/invitations` | 305 | clínico com write | token portal, hash DB, 7 dias; rate limit. |
| POST `/api/patients/{patient_id}/password-resets` | 315 | clínico com write | token reset, hash DB, 24h; invalida pendente anterior. |
| POST `/api/patient/invitations/validate` | 325 | pública, token + rate limit | valida convite e retorna nomes limitados. |
| POST `/api/patient/activate` | 333 | pública, token | email vinculado e senha; cria PatientAccount, sessão e consome token; 201/400. |
| POST `/api/patient/login` | 345 | pública + rate limit | email/senha; cookie paciente, 401. |
| GET `/api/patient/me` | 354 | cookie paciente | apenas planos publicados no DTO. |
| POST `/api/patient/logout` | 358 | cookie opcional | revoga sessão e limpa cookie. |
| POST `/api/patient/password-resets/validate` | 364 | pública, token + rate limit | valida link e retorna nome; 400 inválido. |
| POST `/api/patient/password-resets/complete` | 371 | pública, token + rate limit | nova senha; rotaciona hash, consome token e revoga sessões. |
| PATCH `/api/patients/{patient_id}/portal-access` | 384 | clínico write | status active/suspended/revoked; revogação terminal, invalida sessões; 400/404/409. |
| POST `/api/assessments` | 396 | clínico write atribuído | AssessmentInput; calcula IMC; cria. |
| GET `/api/assessments` | 406 | role clinician e paciente atribuído | lista avaliações visíveis. |
| POST `/api/appointments` | 416 | usuário + acesso write | AppointmentInput; timezone por APP_TIMEZONE, lock advisory e checagem conflito; 409. |
| GET `/api/appointments` | 428 | profissional; filtro por role/assignment | lista e remove notas para admin sem clínica. |
| PATCH `/api/appointments/{appointment_id}` | 432 | clinician atribuído | dict status; 400/404. |
| POST `/api/goals` | 439 | clinician write | GoalInput; cria meta. |
| PATCH `/api/goals/{goal_id}` | 443 | clinician atribuído | status e nota; 400/404. |
| GET `/api/meal-plans` | 452 | clinician com acesso | resumo de planos. |
| POST `/api/meal-plans` | 459 | clínica write | paciente/nome/refeições; cria versão em JSONB. |
| GET `/api/meal-plans/{plan_id}` | 470 | clinical read atribuído | detalhe de plano. |
| PUT `/api/meal-plans/{plan_id}/draft` | 476 | clinical write atribuído | atualiza rascunho ou nova versão. |
| POST `/api/meal-plans/{plan_id}/publish` | 488 | clinical write atribuído | valida e publica versão atual. |

### Diferenças de contrato e consumo

Python não implementa rotas Node de gestão de membros/equipe (listar, editar e revogar membros), convites de workspace (criação/lista/revogação/aceitação), catálogo `/roles`, cadastro configurável de papéis clínicos, além de detalhes de migração legacy. Também não implementa `GET /api/patients/:id/invitations` ou reset como UI chama? Portal UI usa criação, presentes. `app.js` consome rotas de workspace mencionadas e espera payloads do Node. Com `API_BASE_URL` dirigido ao Python, esses fluxos ficam sem implementação equivalente. Endpoints Python adicionais sem uso óbvio no frontend: `/health` e `/api/workspaces/select` (a UI seleciona pelo Node `/api/workspaces/select`, portanto há uso se configurada; seleção persiste de forma diversa). Não foi encontrada chamada frontend para health.

**Limite:** tabela resume contratos por rota e não é especificação normativa; payloads completos variam por página/handler. Nenhuma rota foi chamada nesta auditoria.

