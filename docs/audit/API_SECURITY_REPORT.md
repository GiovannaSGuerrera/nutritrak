# Inventário e segurança das APIs

24/11/2026. Snapshot e método em FULL_AUDIT_REPORT.md. Inventário estático completo dos handlers: **47 operações Node e 36 operações Python**, além das rotas automáticas do framework/estáticos discriminadas abaixo. Uma operação é um par método/rota; padrões com ID representam todas as instâncias. Não foram descobertos webhooks ou APIs financeiras.

## Contratos comuns e convenções

- **N:** `apps/api/src/server.js`; **P:** `apps/api-python/app/main.py`. Números são linhas do if/handler Node ou decorador Python, conforme indicado. Campos citados são os principais; schemas Python AuthInput/PatientInput/AssessmentInput/AppointmentInput/GoalInput nas linhas 37–72 e normalizador de refeições 74–93 completam o detalhe.
- **Prof:** cookie profissional válido; **Portal:** cookie de paciente válido; **Público:** sem sessão, com token quando especificado. Logout é idempotente e não requer uma sessão válida prévia.
- **W:** membership ativo no workspace. Node exige `X-Workspace-Id` nos módulos de domínio; rotas de identidade/gestão especificam o workspace no payload/path. Python usa workspace da sessão e rejeita header divergente. IDs nunca devem, isoladamente, conferir acesso.
- **C:** papel clínico + atribuição do paciente; **A:** administrativo com capacidade pertinente; **G:** gestão (owner/operations); **O:** proprietário. Node aplica capacidades em access-control.js; Python verifica conjuntos de papéis e atribuições em cada rota.
- **Entrada JSON:** Node limita corpo em aproximadamente 1.000.000 de caracteres e faz JSON.parse, não exige Content-Type; tipos/limites são manuais. Python com modelos faz validação Pydantic; `dict` significa esquema parcial/manual e AUD-022 quando relevante. Strings/coleções listadas não têm todas os mesmos limites entre backends.
- **Resposta:** JSON; Node erros `{error}`, Python HTTPException/Pydantic geralmente `{detail}`. Isso causa mensagem genérica no frontend. Não há paginação nas listagens principais.
- **Rate N:** somente register/login/patient-login/activate, 10 por IP/rota/15min. Demais rotas N: **sem limiter específico**. **Rate P:** login 10/e-mail/15min; register 5/e-mail; convite/reset profissional 5/usuário/paciente; validações de token por IP conforme tabela. Count+insert não atômico. Todas as demais rotas P: **sem limiter específico**. Nenhum limite de ingress foi validado.
- **Origem:** N rejeita origem apenas com CORS_ORIGINS não vazio; P rejeita mutações com cookie e Origin ausente/não autorizado. Cookies Strict e CORS não dispensam análise de CSRF de domínio real.
- **Riscos comuns:** AUD-008 (abuso), AUD-013 (listas/N+1), AUD-016 (origem N), AUD-020 (cobertura). Autenticação backend não equivale a ausência de falhas por propriedade/negócio.

## Operações presentes nos dois backends

| Método / rota | Linhas N / P | Finalidade e entrada → saída | Autenticação e permissão | Validação / rate específico / risco |
|---|---|---|---|---|
| POST /api/register | 667 / 153 | name,email,password,profileType,workspaceName,clinician → usuário/workspace + cookie | Público intencional; cria identidade própria | N senha 12–200, regex/e-mail e perfil; P AuthInput. Rate N10/P5. AUD-003/007; flags/perfis divergem |
| POST /api/login | 730 / 166 | email,password → usuário/contexto + cookie | Público intencional | N tipo de senha/hash; P AuthInput exige 12–200. Rate N10/P10. Erro genérico; AUD-007/008 |
| POST /api/logout | 750 / 176 | cookie opcional → ok + cookie expirado | Público idempotente, afeta somente sessão apresentada | Revogação server-side; sem rate específico |
| GET /api/me | 440 / 182 | cookie → identidade/workspaces (P também roles/activeWorkspaceId) | Prof; P também W da sessão | Projeção segura de identidade; sem hashes; sem rate específico |
| GET /api/workspaces/legacy-preview | 767 / 188 | sem body → nomes/IDs de legados próprios | Prof; P exige W | N filtra userId sem workspace; P sempre falso/vazio. AUD-014 |
| POST /api/workspaces/select | 864 / 192 | workspaceId,experience → contexto/papéis | Prof + membership do destino; papel compatível | N clínica/experiência por flag; P UUID e roles, muda workspace na sessão. Sem rate |
| GET /api/clinicians | 1163 / 217 | W → profissionais/papéis clínicos | Prof+W+G/patients.assign | N flag clínica; projeção identidade sem hashes; P retorna DTO distinto; sem rate |
| GET /api/dashboard | 1192 / 205 | W → totais, histórico agregado, próximos/recentes | Prof+W; clínico vê atribuições; N também A conforme capacidades | Filtros backend; P zeros/mock e consultas N+1. AUD-013/014 |
| GET /api/patients | 1255 / 229 | W → pacientes visíveis | Prof+W; N A ou C; P admin ou clínico atribuído | N DTO administrativo; P clinicalNotes vaza para admin, AUD-001. Sem paginação/rate |
| POST /api/patients | 1270 / 244 | nome,contatos,nascimento,status,objetivo,notas; N responsáveis → cadastro | Prof+W; patients.manage/create; dados clínicos exigem C | N nome/atribuições/limites; P PatientInput, atribui criador clínico automaticamente e ignora parâmetros de atribuição extras. AUD-006/014 |
| GET /api/patients/{id} | 1349 / 254 | ID → cadastro,portal,agenda,metas/avaliações autorizadas | Prof+W; A administrativo ou C | Scope do paciente validado; dados clínicos só C, exceto AUD-001 P; sem rate |
| PATCH /api/patients/{id} | 1322 / 269 | campos permitidos → paciente | Prof+W; N demographics patients.manage, clinical C; P manager ou C | N muta antes de validar AUD-005; P dict/truncamento e status não normalizado AUD-006. Retorno admin P AUD-001 |
| PUT /api/patients/{id}/assignments | 1385 / 285 | primaryProfessionalId,supportProfessionalIds → atribuições | Prof+W+G/patients.assign | Profissionais clínicos ativos do mesmo W; P máximo 10; substitui conjunto, sem rate |
| PATCH /api/patients/{id}/portal-access | 1414 / 384 | status active/suspended/revoked → estado de acesso | Prof+W+C | Estados validados; revogado terminal; sessões revogadas ao suspender/revogar; sem rate |
| POST /api/patients/{id}/invitations | 1463 / 305 | paciente → token/expiração | Prof+W+C | E-mail/conta/escopo; N 7 dias; P 7 dias. Rate N nenhum/P5. Token plaintext somente na resposta intencional ao emissor autorizado |
| POST /api/patients/{id}/password-resets | 1502 / 315 | paciente → token/expiração | Prof+W+C | Conta existente; reset anterior invalidado; expira 24h. Rate N nenhum/P5. Sem envio automático |
| POST /api/patient/invitations/validate | 453 / 325 | token → nome paciente/profissional | Público intencional, exige token válido | Hash/expiração/uso; N checa arquivo/conta e status; rate N nenhum/P30 por IP. Nomes são revelados a detentor do token, não por ID livre |
| POST /api/patient/activate | 479 / 333 | token,email,password → cookie/portal | Público intencional, token + e-mail vinculado | N/P senha 12–200, token válido e e-mail do cadastro; rate N10/P10 por IP. P concorrência requer prova transacional |
| POST /api/patient/login | 565 / 345 | email,password → cookie/portal | Público intencional | Hash e estado de acesso; N arquivado reconhecido; P AUD-006. Rate N10 por IP/P10 por e-mail; P senha dict sem mesmo limite de AuthInput |
| GET /api/patient/me | 657 / 354 | cookie → nome/profissional/planos publicados | Portal; vínculo do paciente/estado ativo | Token sessão/expiração, sem rascunho; P AUD-006 pode manter arquivado. Sem rate |
| POST /api/patient/logout | 651 / 358 | cookie opcional → ok/expiração | Público idempotente, só sessão apresentada | Revoga sessão; sem rate |
| POST /api/patient/password-resets/validate | 592 / 364 | token → nome de paciente | Público intencional, token válido | Uso/expiração/hash; N estado da conta; P20 por IP/N nenhum. Não é lookup público por e-mail |
| POST /api/patient/password-resets/complete | 617 / 371 | token,password → ok | Público intencional, token válido | 12–200, hash/expiração/uso, revoga sessões. Rate N nenhum/P10 por IP. AUD-002 N; AUD-012 P |
| GET /api/assessments | 1532 / 406 | W → avaliações de pacientes atribuídos | Prof+W+C | Scope e permissão backend; P filtra após carregar, N ordena data; AUD-013; sem rate |
| POST /api/assessments | 1545 / 396 | patientId,date,peso,altura,gordura,cintura,quadril,método,notas → avaliação | Prof+W+C | Peso 0–500, altura 0–280, gordura 0–100; validação cintura/quadril/datas desigual. P AssessmentInput. Sem rate |
| GET /api/appointments | 1819 / 428 | W → agenda,notas condicionais,nome | Prof+W; A agenda ou C atribuído | Scope W; notas omitidas sem C. Listagem integral; sem rate |
| POST /api/appointments | 1587 / 416 | patientId,start,duration,type,notes → consulta | Prof+W; N A agenda ou C, notas só C; P exige C | N data futura, duração clamp/conflito por criador; P input/zone/advisory lock. Sem rate. P não replica gate de futuro N |
| PATCH /api/appointments/{id} | 1628 / 432 | status → consulta | Prof+W; N agenda A ou C; P C | Enum agendada/realizada/cancelada/falta; N remove notas no retorno admin. Reagendar status pode exigir revalidar overlap; ver observação abaixo |
| POST /api/goals | 1649 / 439 | patientId,description,category,dueDate → meta | Prof+W+C | N texto/limites; P GoalInput mas descarta category/dueDate, AUD-014; sem rate |
| PATCH /api/goals/{id} | 1675 / 443 | status,note → meta/progresso | Prof+W+C | Enum status e limite nota; histórico cresce; sem rate |
| GET /api/meal-plans | 1690 / 452 | W → planos/última versão/metadados | Prof+W+C | Scope e assignment; N sumário, P latestVersion completo; sem paginação/rate. AUD-013/014 |
| POST /api/meal-plans | 1725 / 459 | patientId,name,objective,datas,instruções,meals/items → plano/rascunho | Prof+W+C | N allowlist, 12 refeições e 40 itens/refeição; P 12 refeições/40 itens totais e dict. AUD-022 P; sem rate |
| GET /api/meal-plans/{id} | 1754 / 470 | ID → plano e versões | Prof+W+C | Scope+assignment; nome do paciente; sem rate; nenhuma leitura por ID sem autoria autorizada identificada |
| PUT /api/meal-plans/{id}/draft | 1764 / 476 | nome/refeições/metadados → versão rascunho | Prof+W+C | Validação de refeições; N cria versão após publicação; P sobrescreve lista JSONB. AUD-012/022; sem rate |
| POST /api/meal-plans/{id}/publish | 1797 / 488 | ID → versão publicada | Prof+W+C | Rascunho obrigatório, campos clínicos; P predicado incompleto AUD-011, concorrência AUD-012. Sem rate |

## Operações exclusivas do Node

Estas operações também fazem parte do inventário mesmo quando a flag de clínica retorna 404. Não existe implementação Python correspondente, portanto não prometer paridade.

| Método / rota | Linha N | Finalidade; entrada → saída | Autenticação/permissões | Validação, rate e risco |
|---|---:|---|---|---|
| POST /api/workspaces/migrate-personal | 777 | nome,clinician,primaryPatientIds → workspace/arquivo de backup | Prof; somente legado próprio | IDs próprios, papel clínico e backup antes de migrar; sem rate. Cópia local não equivale a DR; AUD-004/009 |
| GET /api/workspaces | 858 | sem body → workspaces e papéis próprios | Prof | Membership ativo, filtra clínica por flag; sem rate |
| POST /api/workspaces | 888 | name,type,clinician → workspace/membership | Prof; O do contexto quando já possui workspace conforme regra | Tipos/nome, flag individual exige clínico; sem quotas/rate |
| POST /api/workspace-invitations/accept | 916 | token → workspace/membership | Prof, e-mail da identidade deve corresponder ao convite | Hash/expiração/uso/revogação e membership duplicado; flag clínica; sem rate. Identidade de e-mail sem verificação AUD-007 |
| GET /api/workspaces/{w}/members | 949 | path W → identidade/papéis dos membros | Prof+membership W+members.manage | Flag clínica; sem hashes; sem rate |
| GET /api/workspaces/{w}/invitations | 970 | path W → convites/status/e-mails/papéis | Prof+membership W+members.manage | Flag clínica; não retorna tokenHash/plaintext; sem rate |
| DELETE /api/workspaces/{w}/invitations/{id} | 995 | IDs → ok/revogação | Prof+membership W+members.manage | Somente pendentes do W; flag clínica; sem rate |
| PATCH /api/workspaces/{w} | 1010 | name → workspace renomeado | Prof+membership W+workspace.manage | Nome até 120, flag clínica; sem rate |
| GET /api/workspaces/{w}/roles | 1022 | W → definições de papéis/capacidades | Prof+membership W+members.manage | Flag clínica; sem rate |
| POST /api/workspaces/{w}/invitations | 1033 | email,role → token/expiração | Prof+membership W+members.manage; só O concede operations_admin | Allowlist de papel, e-mail, membro duplicado, revoga anterior; expira 7d; flag clínica; sem rate |
| PATCH /api/workspaces/{w}/members/{id} | 1077 | roles → membership | Prof+membership W+members.manage; restrições owner/operations | Papéis válidos, último O preservado; flag clínica; sem rate |
| DELETE /api/workspaces/{w}/members/{id} | 1116 | IDs → ok/membership revogado | Prof+membership W+members.manage; só O remove O | Último O protegido; revoga atribuições desse usuário nesse W; flag clínica; sem rate |

## Python: health e rotas automáticas

| Método / rota | Finalidade | Autenticação / dados / limites |
|---|---|---|
| GET /health, main.py:148 | SELECT 1 e status ok | Público intencional; sem dados de paciente; sem limiter específico; não comprova schema/head |
| GET /openapi.json | Schema gerado FastAPI | Público por default; não foi desabilitado na instanciação. Inventário/documentação, não autorização de dados |
| GET /redoc | UI ReDoc | Público por default, inclusive APP_ENV=production; assets externos do framework precisam revisão de CSP/hosting |
| GET /docs | Swagger UI | Default fora de produção; desabilitado quando APP_ENV=production |
| GET /docs/oauth2-redirect | Auxiliar Swagger | Default quando Swagger está habilitado; sem integração OAuth de negócio identificada |
| OPTIONS de preflight | Middleware CORS | Origens explícitas, credenciais, métodos/headers definidos; não é endpoint administrativo |

HEAD e respostas 405/404 automáticas do framework são comportamento de transporte, não novas funções de domínio. Defaults de framework foram identificados estaticamente, sem afirmar resposta real de uma imagem instalada.

## Superfície web/estáticos

Ambos servidores servem index em `/`, `/paciente`, `/paciente/ativar`, `/paciente/redefinir`, e arquivos em public. Web separado aceita GET/HEAD e proxy de qualquer método sob `/api/`; Node serveStatic não limita explicitamente método. Caminhos usam resolve + prefixo com separador. Config gerada só contém API base pública/flag. Não há endpoint de upload, debug executor, arquivo do store ou download arbitrário identificado.

Web separado não faz autorização por si: encaminha cookie/headers; backend precisa validar tudo. Upstream vem de configuração do operador, não payload do cliente. Falta timeout explícito de upstream e validação do deployment real. CSP pode bloquear styles inline (AUD-019).

## Conclusões e pontos de revalidação

Nenhuma rota clínica anônima indevida confirmada. Endpoints de login/ativação/reset são intencionalmente públicos e exigem credencial/token onde aplicável. Token de alta entropia não é substituto de limiter nem de consumo atômico. AUD-001 é exposição indevida de propriedade em rota privada; AUD-006 permite leitura após arquivamento no contrato Python atual. Nenhum bypass entre workspaces confirmado; Node suíte atual passou, Python precisa validação dinâmica.

Risco adicional de negócio a verificar: PATCH de consulta permite voltar status para agendada sem repetir a verificação de conflito de criação, em ambos backends. Cancelar consulta, preencher o horário e reativar pode criar overlap. Incluído nos critérios de validação de agenda do plano; não foi feito teste dinâmico dessa sequência nesta auditoria. Regra de conflito em clínica também precisa prestador explícito, não apenas criador.

Aceitação de lançamento: testes negativos por rota/papel/tenant, respostas por allowlist, replay/concorrência, limitação distribuída, contratos reais da UI e validação do proxy/domínios finais. Resultados existentes e pendências estão em TEST_RESULTS.md.
