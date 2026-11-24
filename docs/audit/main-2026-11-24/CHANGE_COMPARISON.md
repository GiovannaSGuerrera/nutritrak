# O que mudou e como transportar as correções

Snapshot auditado: main b759e77. Comparação com base antiga987d692 e hardening e5d4202. Não executar merge automático: ancestral comum é d7def2c e ambas reescreveram os mesmos fluxos.

| Área | Versão endurecida anterior | Main atual | Decisão opção1 |
|---|---|---|---|
| Backend | JavaScript + Python experimental | TypeScript Node; Python removido | Preservar TS; não reintroduzir Python |
| Persistência | SQLite single-instance/local | PostgreSQL/pg, snapshot de compatibilidade | Preservar PG/Neon; melhorar consultas/transações |
| Publicação | Compose/Caddy/disco persistente propostos | Entrada serverless Vercel e banco remoto | Preservar infraestrutura atual; não portar perfil SQLite |
| Identidade/tenant | Workspace/membership/atribuição e clínica por flag | Profissional individual via userId | Preservar escopo atual; não inventar módulo de equipes |
| Sessões/backup | Módulos novos duráveis/cifrados | Sessões PG e backup GCM já existentes | Aproveitar implementação atual; testar novas tabelas/retention |
| Auth profissional | Verify/reset/MFA/troca/revoke reais | Login/register/logout sem novo ciclo | Adaptar com TS/schema compatível/SMTP; não copiar store |
| Concorrência | Transação+revisão plano | CAS global + fila local | Preservar proteção existente e adicionar revisão de intenção por recurso |
| UI | Correções sobre layout anterior | Layout/copy novos; labels parcialmente associados | Preservar UI/copy; portar correções pontuais |
| Gates |17Node/14Python/2E2E |10Node incluindo7PG; sem CI/E2E | Criar regressões PG/browser próprias; não herdar contagens antigas |

## Reavaliação dos achados anteriores

| ID antigo | Resultado na main atual | Ação |
|---|---|---|
| AUD-001 | Não aplicável: DTO administrativo Python removido | Não transportar backend antigo |
| AUD-002 | Mitigado PostgreSQL: reset duas instâncias200/409 | Manter regressão multi-instância; não reimplementar fila SQLite |
| AUD-003 | Cadastro duplicado entre duas instâncias retornou201/409; unicidade PG/revisão/fila mitigam | Preservar constraints; nova verificação de e-mail permanece necessária |
| AUD-004 | JSON deixou de ser alvo produtivo; PG/sessões/backup já existem | MAIN-007/009/012; evoluir sem trocar banco |
| AUD-005 | Persiste em JSON dev; não confirmado persistido PG | MAIN-012 e validação MAIN-005 |
| AUD-006 | Não aplicável Python; portal TS já bloqueia Arquivado | Manter teste de archive/cookie e fortalecer enum |
| AUD-007 | Ciclo profissional continua ausente | MAIN-002 |
| AUD-008 | Rate20/IP compartilhado já existe; fila/body/abuso geral incompletos | MAIN-001/007 |
| AUD-009 | Backup/health/grants locais existem; externo não revalidado | MAIN-009 |
| AUD-010 | Minuta operacional existe; export/exclusão não | MAIN-008 |
| AUD-011 | Python removido; TS usa every nos itens | Preservar normalização; MAIN-005 tipos inválidos |
| AUD-012 | Python removido; CAS PG mitiga snapshots concorrentes, não edição stale | MAIN-003 |
| AUD-013 | Agregação SQL reduz roundtrips, ainda lê todos; N+1 metas permanece | MAIN-007 |
| AUD-014 | Paridade Python deixou de ser objetivo; métricas/metas TS persistidas | Não prometer equipes/Python; manter contratos individuais |
| AUD-015 | Dependências Python removidas; pnpm audit atual zero conhecidos | Não portar locks Python; auditar pg/TS atuais |
| AUD-016 | Origem/JSON/sec-fetch-site já protegidos; configuração explícita pode endurecer | Preservar controles; exigir APP_ORIGIN sem alegar CSRF explorado |
| AUD-017 | Alembic removido; schemaSql/versão1 PG próprios | Criar migrações PG explícitas para novas tabelas, não Alembic |
| AUD-018 | labelFields/showLabeledModal já existem | Validar browser e corrigir somente lacunas atuais |
| AUD-019 | Estilos inline incompatíveis permanecem | MAIN-011 |
| AUD-020 | Dez testes PG passam, sem workflow CI | MAIN-010 |
| AUD-021 | TS modular existe, strict false e formatação falha | MAIN-010; refatorar incrementalmente |
| AUD-022 | Python removido; null meal TS agora500 e medidas inválidas aceitas | MAIN-005 |
| AUD-023 | Reativação conflitante permanece | MAIN-004 |
| AUD-024 | Prefill do editor ainda ausente | MAIN-006 |
| AUD-025 | Main não tem worker SMTP | Não aplicável hoje; transportar seleção elegível quando adicionar outbox |

Os rótulos VALIDATED da auditoria SQLite não são herdados. A configuração real Neon/Vercel não foi acessada. Os documentos históricos de23/11 relatam ações externas anteriores; são contexto, não comprovação nova.
