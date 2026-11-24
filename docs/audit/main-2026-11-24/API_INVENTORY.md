# Inventário da main b759e77

Fonte server.ts e segurança global security.ts. Rotas clínicas exigem profissional próprio, portal usa conta/paciente vinculado. Não existem papéis de equipe/workspace nesta versão. Sessões PostgreSQL hash/TTL8h, validação de origem/JSON nas mutações, rate20/IP em sete rotas de auth; demais domínios sem rate global/paginação. Nenhuma rota clínica anônima indevida confirmada. Logout aceita falta de cookie e não manipula outra identidade.

| Método/rota | Autenticação/autorização |
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

31 métodos/rotas canônicos. Paths de agenda/metas usam startsWith na implementação; o inventário mostra forma pretendida, não validação estrita de path. /api/health é tratado antes do handler. Rotas não existentes podem retornar401 antes de404 sem sessão; isso não comprova implementação.

Não existem na main atual /api/workspaces, /api/clinicians, /api/account/*, auth profissional de recuperação/verificação, MFA, exportações, billing, upload ou webhook financeiro. Não transportar silenciosamente módulos fora do escopo individual. Estáticos: /, /paciente, /paciente/ativar, /paciente/redefinir e arquivos públicos; path resolve/prefixo impede leitura fora do diretório público no código revisto. CSP no servidor/vercel.json; style inline ainda incompatível. Nenhum segredo privado é servido na configuração frontend.

CORS/CSRF: mutações recusam sec-fetch-site cross-site e Origin divergente quando presente; JSON obrigatório. Ausência de Origin é aceita; APP_ORIGIN explícita deve substituir fallback Host na configuração segura. Não foi demonstrado CSRF com as proteções combinadas. GET clínicos retornam no-store; middleware/log sem corpo/URL. Strings livres/datas/medidas têm lacunas MAIN-005, planos MAIN-003 e disponibilidade MAIN-001. Corpo1MB é medido em bytes no body pré-parseado Vercel e em comprimento de string no streaming local; uniformizar.
