# Inventário de funcionalidades

| Funcionalidade | Fluxo e arquivos / API / dados | Permissões, regras e validações | Testes existentes | Estado comprovado |
|---|---|---|---|---|
| Cadastro/login profissional | `app.js`, Node `server.js`; Python `main.py`; users/workspaces/memberships | Email normalizado, senha 12–200; scrypt no Node, Argon2 no Python; sessão cookie | Node application e Python auth | PARCIAL; presente em ambos, diferenças de workspace e TTL |
| Logout/sessão | Node Map em memória; Python tabela sessions e cookies | cookie HttpOnly/SameSite Strict; 8h padrão | Node suite, Python logout/expiração | PARCIAL; persistência/revogação divergentes |
| Workspace/clínica | UI team/clinic/permissions, Node handlers e access-control; Python básico | membership ativa; owner/admin roles; convite por email | Node application multiworkspace; Python workspace isolation | PARCIAL; Python não possui gestão equipe/convite equivalente |
| Migração de dados pessoais legados | Node `legacy-preview`, `migrate-personal`, cópia backup local | confirmação e IDs de atribuição | Não encontrado teste dedicado comprovado | PARCIAL; inexistente no Python |
| Gestão equipe/convite/revogação | UI team/invitations; Node workspace routes | `members.manage`, token hash one-time, email exato, expiração | Node application | PARCIAL; implementado só no Node; e-mail manual |
| Gestão de pacientes | app.js patient pages, APIs patient, Patient JSON / SQL | workspace; admin projection ou acesso clínico por atribuição; campos validados em parte | Node e Python integração | PARCIAL; campos/formas diferem |
| Atribuição profissional | Node assignments/access-control; Python `PatientAssignment` | clinician ativo do mesmo workspace | Node isolation/roles; Python isolation | PARCIAL; discrepâncias de roles e dados |
| Avaliações antropométricas | UI assessments; POST/GET assessments; Assessment | IMC, gordura/massas no Node; Python IMC; limites peso/altura/fat no Node | Node application | PARCIAL; cobertura não abrange validadores integralmente; diferenças de cálculo |
| Agenda/conflito | UI agenda; POST/PATCH/GET appointments | status permitido, intervalo futuro e sobreposição; Python advisory lock | Node app conflit; Python conflit | PARCIAL; regras/atomicidade distintas |
| Metas | UI metas e painel paciente; Goal | estados ativa/concluída/pausada, progresso | Node app | PARCIAL; pouca validação/cobertura |
| Dashboard | UI dashboard; endpoint agregado | escopo por papel/workspace | sem teste dedicado identificado | NÃO VALIDADA |
| Plano alimentar/rascunhos/versões | UI plans; MealPlan JSON/JSONB | até 12 refeições, 40 itens cada, publicação com quantidades/unidades | Node app e Python portal test (criação/publicação) | PARCIAL; contrato e normalização divergentes |
| Portal do paciente | `portal.js`; patient account/session | convite vinculado ao email; projeção só de publicações; reset one-time; suspensão/revogação | Node app e Python portal | PARCIAL; sem envio externo; status e sessões diferem |
| Recuperação por e-mail | Nenhum provedor/integração identificado; link copiado manualmente | Profissional gera reset de 24h | Testes exercitam reset no Node | NÃO IMPLEMENTADA como envio automático |
| Auditoria de ações | array `audit` Node; algumas rotas Python sem trilha equivalente identificada | Node mantém até 500 registros em JSON | sem cobertura específica visível | PARCIAL |
| Suspensão/reativação/revogação do portal | PATCH portal-access em ambas | suspensão reativável; revogação terminal; limpa sessões na Python e invalida sessão efetiva Node por estado | Node application e Python portal | PARCIAL; fluxo presente, sem testes de concorrência |
| MFA, exportações, notificações, apps mobile | Não há código correspondente identificado | — | nenhum | NÃO IMPLEMENTADA |
| Hospedagem/produção e backup automatizado | Compose local, Dockerfile API, docs manuais | sem deploy/observabilidade demonstrados | nenhum | NÃO VALIDADA |

**Critério de classificação:** completa exige fluxo e evidência de teste suficiente; código presente sem verificação abrangente fica parcial ou não validada. Não foram inferidos testes executados nesta auditoria.
