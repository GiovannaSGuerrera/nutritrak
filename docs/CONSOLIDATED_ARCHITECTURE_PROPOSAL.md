# Proposta consolidada de arquitetura multi-tenant — NutriTrack

**Data:** 2026-10-29  
**Status:** proposta para aprovação e decomposição em fases. Nenhuma arquitetura técnica aqui descrita foi implementada.  
**Normatividade:** decisões de produto da seção 1 são requisitos aprovados conforme as instruções mais recentes e `PRODUCT_REQUIREMENTS_BASELINE.md`. As demais recomendações não são decisões aprovadas.

## 1. Decisões de produto consolidadas

- O produto atende nutricionistas individuais e clínicas. Um workspace pode representar consultório individual ou clínica e pode ter mais de um proprietário.
- Uma pessoa tem identidade profissional única e participa de vários workspaces.
- Propriedade administrativa, administração operacional e responsabilidade clínica são responsabilidades separadas.
- Haverá cargos padrão editáveis, cargos personalizados, permissões granulares e exceções individuais.
- Autorização considera workspace, equipe, paciente, papel e ação. Cadastrar paciente não concede acesso automático ao prontuário.
- Pacientes podem ter nutricionista responsável principal e profissionais de apoio.
- Remover profissional revoga apenas o workspace de onde saiu. Não transfere pacientes ou registros clínicos automaticamente ao consultório individual.
- A fundação será multi-tenant desde o início da arquitetura, construída progressivamente. A arquitetura comercial deve admitir planos individuais e clínicos; cobrança não é necessária no MVP.
- Registros clínicos de contextos distintos não são compartilhados automaticamente, mesmo quando a pessoa paciente é a mesma.

Essas decisões não fixam onboarding/provisionamento do workspace, catálogo final de capacidades, portal multi-organização, retenção, tecnologia ou regras operacionais. Consultar a seção 3 sem reabrir os requisitos acima.

## 2. Matriz consolidada de requisitos

Legenda de evidência: “não encontrado” descreve o código deste repositório inspecionado, não sistemas externos. Testes são citados pelo conteúdo estático; nenhum teste foi executado nesta consolidação.

| ID | Requisito e decisão relacionada | Evidência atual | Lacuna | Dependências | Critério verificável de aceite | Fase |
|---|---|---|---|---|---|---|
| R1 | Workspace individual ou clínica; zero ou mais que um proprietário | `apps/api/src/server.js`: coleções iniciais e handlers L20-L34, L243-L919; não há organization/workspace/membership | Modelo atual tem usuário-dono, não tenant nem co-proprietários | Definir ciclo de vida e cardinalidades sem redecidir os tipos permitidos | Conta participa de dois workspaces; workspace individual e clínica suportam proprietários múltiplos; tenant adulterado não concede acesso | F2 |
| R2 | Identidade profissional única com memberships em múltiplos workspaces | `server.js` `userFor()` L94-L97; `/api/register` L440-L479; lookup do usuário por e-mail em `/api/login` L481-L499 | Identidade e dono de dados estão fundidos; sem membership | Identidade global versus perfil; ciclo de vida de membership | Uma identidade autentica uma vez e tem papéis distintos em dois workspaces; remoção de um vínculo preserva outro | F2 |
| R3 | Contexto de workspace muda autorização no backend | Handlers privados obtêm `uid` em L507-L510; `owned()` L168-L170 | Não há workspace ativo nem checagem de membership por request | Semântica de workspace ativo e sessão/contexto | Request com workspace selecionado autorizado; workspace omitido, inválido ou adulterado é negado sem vazamento | F2 |
| R4 | Separar propriedade, operação e responsabilidade clínica; cargo não é acesso clínico irrestrito | Sem papel/capacidade em handlers L243-L919; acesso atual por ownership de UID | Sem separação de funções | Capacidades e administração de papéis | Testes provam que owner administrativo sem capacidade clínica não lê prontuário; capacidades concedidas operam somente no escopo | F2 |
| R5 | Papéis editáveis, personalizados, exceções e permissões granulares | `/api/*` handlers usam sessão/ownership; sem policy de capacidade encontrada | Nenhuma política RBAC/ABAC ou exceção individual | Catálogo mínimo, quem delega, precedência de exceções | Matriz endpoint × ação × principal cobre papel padrão, customizado e exceção; deny-by-default demonstrado | F2 |
| R6 | Acesso limitado por workspace, equipe, paciente, papel e ação | `owned()` L168-L170 e verificações nas rotas abaixo; sem equipe/atribuição | O único escopo é usuário proprietário | Definição de equipe, escopo e histórico de atribuição | Membro da mesma clínica sem vínculo/equipe não lê paciente fora do escopo; autorizado lê somente ações concedidas | F2 |
| R7 | Cadastro de paciente não dá acesso automático a prontuário | `POST /api/patients` L558-L578; detalhe L592-L609 inclui dados relacionados do mesmo dono | Sem permissão administrativa/clínica separada | Política de leitura de dados cadastrais e clínicos | Recepcionista pode cadastrar/ler campos administrativos aprovados e recebe negação ao consultar avaliações/notas/planos | F2 |
| R8 | Paciente tem principal e profissionais de apoio; fluxo pode variar | Paciente criado com `userId` em L558-L578; assessments/appointments/goals/mealPlans guardam UID e patientId (L683-L716, L721-L800, L832-L849) | Sem relação many-to-many de atribuição, equipe ou etapas | Fluxo mínimo configurável e responsabilidade histórica | Atribuições de principal/apoio por paciente são consultadas em policy; trocar membro não reatribui silenciosamente histórico | F2 |
| R9 | Mesma paciente em contextos distintos não compartilha prontuário automaticamente | Portal liga conta a `patientId` e `professionalId`, `safePatientPortal()` L113-L146; criação clínica valida proprietário em L685, L723, L769, L834 | Portal e patient profile atuais são por par profissional-paciente, sem workspace | Identidade global opcional de paciente, associações explícitas, portal | Fixtures ligam identidade paciente a dois workspaces; histórico, agregados e portal de A jamais incluem dados de B sem vínculo concedido | F2 |
| R10 | Remoção revoga somente workspace, mantém identidade/outros workspaces e não transfere prontuário | Não há rota/modelo de membership no inventário de `server.js` L243-L919; sessões em `Map` L13-L14 | Sem revogação por tenant nem regra de saída | Semântica de revogação, tarefa/atribuição pendente e retenção | Token preexistente perde acesso ao workspace removido; outro workspace continua; registros preservados e nenhuma atribuição criada automaticamente | F2/F3 |
| R11 | Sessão, cache e requests respeitam revogação | `userFor()` L94-L97 apenas resolve Map; cookie L104-L108 define Max-Age; logout L501-L505 remove token local | Sem expiração server-side, sessão distribuída ou membership check; request em andamento sem regra | SLA de revogação e estratégia de sessão | Após revogação, novas leituras/escritas são negadas conforme SLA; testes concorrentes confirmam comportamento de requests já iniciados | F1 |
| R12 | Auditoria de permissão e ações sensíveis sem conteúdo clínico desnecessário | `audit()` L171-L180 grava evento em array limitado; chamadas em operações; sem leitura auditável sistemática | Sem eventos de membership/papel (inexistentes), leitura, exportação ou retenção durável | Escopo de eventos e retenção | Mudanças de membership/capacidade e acesso exigido produzem evento atribuível e não incluem payload clínico/secreto | F1/F2 |
| R13 | Persistência e integridade compatíveis com múltiplos usuários/workspaces | `loadStore()` L36-L56, `persist()` L58-L65; arrays iniciais L20-L34 | Sem constraints, transactions banco ou coordenação interprocesso | Seleção técnica e requisitos operacionais | Constraints barram referências cruzadas/órfãs; operações críticas transacionais; concorrência e restore ensaiados | F3 |
| R14 | Base comercial permite planos individuais/clínicos, sem cobrança obrigatória no MVP | Nenhuma entidade/rota de billing em `server.js` L243-L919; `package.json` scripts sem módulo comercial | Sem catálogo/entitlements, mas cobrança é fora do MVP | Definir limites e quem paga antes de billing | MVP clínico funciona sem cobrança; depois entitlements não substituem policy de acesso clínico | F4 |
| R15 | Migração preserva relações sem associação automática ambígua | `server.js` guarda paciente e filhos por UID; `apps/api/test/application.test.js` L65-L176 usa dados sintéticos | Não há mecanismo de migração relacional; não se sabe conteúdo/qualidade da origem | Aprovar regra de mapeamento e acesso à origem | Reconciliação de IDs, relações, estados e versões; exceções listadas sem dados sensíveis; nenhum merge automático | F3 |
| R16 | Testes provam isolamento em leitura e escrita por papel/escopo e revogação | `apps/api/test/application.test.js` L19-L176: GET cruzado paciente L141-L152, plano L153-L159; outras assertions de plano/agendamento | Um teste de integração e negativos pontuais; sem workspace, papel, equipe ou revogação | Modelo de autorização aprovado e harness sintético | Matriz completa de rotas e ações com allow/deny, IDs cruzados, troca/revogação e multi-instância executada em CI | F1/F2 |

## 3. Decisões realmente pendentes e tipo

### Decisões de produto que ainda exigem aprovação

- O que dispara a criação de workspace individual e como onboarding converte/associa profissional a clínicas (a existência dos dois tipos de workspace está decidida; somente o fluxo de criação/associação falta).
- Modelo de identidade da paciente: cadastro independente por workspace ou identidade global opcional com links explícitos; como consentimento/portal permite múltiplos vínculos sem compartilhar prontuários.
- Catálogo de capacidades do MVP, nomes/capacidades dos cargos iniciais e quem pode criar cargos, atribuir exceções e administrar memberships.
- Semântica operacional de equipes, tarefas e atribuição por etapa, preservando principal e apoio configuráveis.
- Procedimento manual para redistribuir pacientes/tarefas quando profissional sai. Transferência automática ao consultório individual está proibida; escolher procedimento explícito permanece aberto.
- SLA e semântica de revogação para operações já iniciadas, além de novas requisições.
- Eventos de leitura/alteração/exportação a auditar e retenção dos metadados.
- Retenção, exportação, encerramento e exclusão de dados por categoria.
- Regras comerciais futuras: métricas/limites/entitlements, suspensão e preço. Cobrança no MVP não é requisito.

### Recomendações técnicas (não aprovadas como decisões)

- Persistência transacional com FKs/uniques tenant-aware e backup/restore demonstráveis antes de uso clínico multiusuário; avaliar banco relacional segundo operação, concorrência e manutenção. PostgreSQL é opção a comparar, não escolha aprovada.
- Policy server-side centralizada ou composição equivalente, deny-by-default e check em cada leitura/escrita; RLS pode ser defesa adicional após protótipo, nunca único controle.
- Separar identidade global, membership, workspace e prontuário tenant-local; registrar vínculos de paciente por workspace e escopo clínico explicitamente.
- Sessões com expiração/revogação server-side e membership consultado ou versão de autorização; definir mecanismo após SLA.
- Importador separado da inicialização, sintético por padrão, `dry-run`, idempotente e com relatório sem PII/segredos; congelamento de escrita simplifica cutover se janela operacional aprovada.
- Não mudar framework/ORM junto com domínio e persistência; escolher SQL/ORM por prova de relações tenant-aware, transações, migrations, manutenção e restore.
- Testes unitários de policy e integração HTTP para cada endpoint/ação/papel/escopo; testes de concorrência e migração antes de cutover.

### Informação operacional necessária

- Legitimidade, origem, qualidade e volume dos dados existentes; autorização, operador, ambiente e janela para eventual migração. Não foi aberto `data/store.json`; esses fatos não podem ser inferidos do código.
- Requisitos de residência/localização, RPO/RTO, disponibilidade, orçamento, infraestrutura, deploy, suporte e equipe de operação.
- Se piloto real usará dados sintéticos ou clínicos e quais gates de privacidade/jurídicos precisam ser atendidos. O código sozinho não responde.
- Existência de suporte interno com acesso excepcional a tenant e como segregar/aprovar esse acesso.

### Conflitos documentais identificados e reconciliação

- `INTEGRATED_AUDIT.md` registra tenant individual como proposta ainda não aprovada. Instrução de produto mais recente aprova que workspace represente consultório individual ou clínica. Atualização normativa: tipos são decididos; provisionamento e mapeamento de contas existentes continuam pendentes.
- `ARCHITECTURE_REVIEW.md`/`INTEGRATED_AUDIT.md` enumeram compartilhamento, papéis e transferência como pendentes de forma ampla. Requisitos mais recentes já decidem a separação de funções, permissões granulares, principal/apoio, revogação por workspace e ausência de transferência automática. Permanecem pendentes apenas as regras de operação e configuração listadas acima.
- `DATABASE_DESIGN.md` alterna autoria de paciente entre `created_by_user_id` e referência a membership; é inconsistência técnica do desenho, não decisão de produto. Resolver em desenho revisado com histórico de autoria tenant-aware.
- `INTEGRATED_AUDIT.md` e outros documentos registram resultados de teste de contextos diferentes. Eles não foram reexecutados aqui; manter separados por ambiente e não declarar cobertura total por 1 teste aprovado.
- Documentos antigos divergem sobre o escopo de leitura de `data/store.json`. Esta consolidação não abriu o arquivo; não altera o que ocorreu em auditorias anteriores.

## 4. Modelo conceitual proposto (não executável)

| Conceito | Responsabilidade e relações | Limite de isolamento |
|---|---|---|
| Identidade profissional | Pessoa autenticável global e estável; pode ter perfil profissional e memberships múltiplos. | Global apenas como identidade; não é autorização nem fronteira clínica. |
| Workspace | Contexto organizacional; tipo individual ou clínica; tem memberships e configurações. | Fronteira primária de dados e policy. |
| Membership | Vínculo de identidade a workspace, com estado, período e atribuição de capacidades/papéis. | Sempre pertence a um workspace; revogação não encerra identidade ou outros memberships. |
| Papel | Conjunto nomeado/editável de capacidades dentro do workspace; papéis padrão e personalizados. | Papel é contextual ao workspace, não global à pessoa. |
| Permissão | Ação em recurso com escopo (workspace/equipe/paciente), derivada de papel e policy. | Avaliada por request no backend; negação padrão. |
| Exceção individual | Concessão ou negação explícita, limitada por recurso/ação/escopo e governança. | Não pode superar tenant nem bypass de vínculo/revogação; precedência deve ser aprovada e testada. |
| Equipe | Agrupamento operacional no workspace; membership de profissionais e associações a pacientes. | Nunca cruza workspace implicitamente. |
| Identidade da paciente | Pode ser identificador global opcional, distinto dos contextos de atendimento; a forma é pendente. | Mesmo se global, não agrega nem compartilha conteúdo clínico. |
| Vínculo paciente-workspace | Cadastro local/associação explícita de paciente ao workspace, com estado/origem. | Pertence a um workspace e não autoriza outro tenant. |
| Prontuário clínico | Avaliações, consultas, metas, planos e registros clínicos associados ao vínculo local. | Tenant-local; chaves/relações impedem ligação a paciente ou recurso de outro workspace. |
| Atribuição clínica | Relação temporal de responsável principal, apoio, equipe e etapas autorizadas com paciente local. | Restringe leitura/escrita clínica; saída não reatribui automaticamente histórico. |
| Sessão | Prova de autenticação associada à identidade; contexto ativo pode selecionar workspace, nunca substitui membership/policy. | Deve expirar/revogar server-side; mudar workspace revalida permissões. |
| Auditoria | Evento de autoria/ação, workspace e recurso técnico; pode registrar decisão de autorização sem payload clínico. | Evento tenant-scoped com acesso restrito; política de retenção pendente. |

Relacionamentos que podem ser globais: identidade profissional, credencial e, se o produto aprovar, identificador global de paciente. Relações de membership, papel, equipe, atribuição, paciente-workspace, prontuário e auditoria de atividade clínica são sempre contextuais e isoladas por workspace. Conectar duas identidades/contextos requer vínculo explícito, autorização e trilha auditável.

## 5. Exemplos do modelo de autorização

Exemplos ilustram a decisão pretendida, não definem cargos finais. Cada operação verifica identidade autenticada, membership ativo no workspace, capacidade para ação, escopo de recurso e atribuição relevante. Falha em qualquer requisito nega acesso; UUID conhecido não altera a decisão.

| Principal | Leitura | Escrita | Negação e exceções |
|---|---|---|---|
| Proprietário administrativo | Configurações e informação administrativa permitidas; prontuário somente com capacidade clínica e escopo explícitos | Administração/delegação dentro dos poderes concedidos; escrita clínica apenas se também autorizado e atribuído | Propriedade não herda acesso clínico irrestrito. Exceção individual não cruza tenant nem ignora membership. |
| Administrador operacional | Agenda/visões operacionais de clínica conforme escopo concedido; cadastro administrativo | Agendamento/cadastro/gestão operacional permitidos | Sem avaliação, notas, consulta ou plano clínico sem capacidade clínica concedida. |
| Nutricionista responsável | Registros clínicos do paciente atribuído e ações permitidas no plano clínico | Registrar/editar atos clínicos segundo policy e estado do registro | Não acessa pacientes fora da atribuição ou workspace; principal não implica permissão universal sobre pacientes da clínica. |
| Nutricionista de apoio | Dados necessários ao escopo de apoio concedido | Registra etapas que lhe foram atribuídas | Não altera decisões reservadas ao principal se policy assim definir; atribuição pode limitar tipos de registro. |
| Profissional sem vínculo com paciente | Somente agenda/dados organizacionais expressamente autorizados | Operações não clínicas expressamente autorizadas | Prontuário negado por padrão, mesmo com membership e cargo clínico genérico, até atribuição/escopo válido. |
| Recepcionista | Dados cadastrais e agenda mínimos concedidos | Cadastro e agendamento autorizados | Prontuário, avaliação, metas e plano negados; permissão de cadastro não amplia leitura clínica. |
| Profissional removido da clínica | Nada do workspace após revogação | Nenhuma escrita no workspace | Identidade e outros workspaces continuam. Sem transferência automática; requests em andamento obedecem SLA de revogação aprovado. |
| Paciente no portal | Somente conteúdo e campos publicados para seus vínculos explícitos | Ações de portal aprovadas, sem mutação clínica profissional | Sem rascunhos, prontuários de outro workspace ou registros de outra paciente; sessão deve ser revogável e vínculo validado. |

Exceções individuais são verificadas com contexto, escopo, validade e autoria. Recomendação é negar por padrão e não permitir que exceção conceda capacidade fora do workspace/membership; precedência entre exceção deny/allow e papel requer decisão técnica detalhada e cobertura de testes.

## 6. Estratégia de migração sem consulta aos dados

1. Manter desenvolvimento e ensaios em fixtures totalmente sintéticas. Nenhum conteúdo de `data/store.json` foi aberto nesta auditoria.
2. Inventariar futuramente a origem por operador autorizado em ambiente restrito, sem imprimir valores pessoais/clínicos; produzir contagens e relatórios de exceção minimizados.
3. Mapear cada `users[].id` profissional para identidade global. Criar ou associar workspace individual somente conforme decisão de onboarding; workspace clínico só mediante vínculo explicitamente aprovado. Não inferir membership de clínica a partir de e-mail.
4. Mapear `patients[].userId` para vínculo paciente-workspace local e converter coleções filhas (`assessments`, `appointments`, `goals`, `mealPlans`) pela relação pai e owner original. Validar que cada relação pai/filho pertence ao mesmo tenant. Manter versões e `publishedVersionId` coerentes.
5. Tratar pacientes duplicados, IDs inválidos/duplicados, owner ausente, registros sem paciente, e-mail coincidente e relações incompatíveis como exceções para revisão humana. Não unir identidades nem registros por nome/e-mail; não transferir automaticamente para outro workspace.
6. Preservar autoria histórica e status; sessões em memória não migram. Convites/reset ativos devem ser invalidados ou tratados conforme decisão aprovada; nunca exportar token puro.
7. Desenvolver importador separado da inicialização da API, idempotente, dry-run padrão, checkpointado e transacional por lote/tenant após escolha técnica. Logs/reports não incluem nome, e-mail, token, hash de segredo ou payload clínico.
8. Validar relações por contagem/ID/estado/versionamento e testes de autorização. Executar segundo dry-run e restaurar backup sintético/backup protegido autorizado antes de cutover. Congelar escrita para snapshot final se janela aprovada; ativar fonte única após reconciliação assinada.
9. Preparar rollback com gatilhos, autoridade, backup e janela. Antes de escrita no destino, retorno ao snapshot pode ser seguro; depois, não voltar cegamente a JSON antigo. Preferir forward-fix ou reconciliação auditada do delta.

Dados concretos, volumes, duplicidades e qualidade não podem ser estimados sem autorização e exame controlado da origem; não são presumidos neste plano.

## 7. Plano de implementação recomendado por fases (não executar)

| Fase | Escopo e dependências | Módulos potencialmente afetados | Riscos | Testes necessários | Critérios objetivos de conclusão |
|---|---|---|---|---|---|
| F0 — Aprovações e baseline | Resolver decisões de produto restantes e registrar policy; threat model e inventário baseline. Sem schema. | Documentação `docs/*`; inventário de `apps/api/src/server.js`; contratos atuais | Implementar premissas não aprovadas; confundir histórico de teste/env | Nenhum teste precisa ser executado para fechar produto; preparar fixtures sintéticas e matriz | Decisões bloqueadoras registradas; todas as capacidades MVP e fluxos de paciente mapeados; riscos e fontes normativas definidos |
| F1 — Baseline segura e sessão | Cobrir comportamento e fechar política de expiração/revogação/logging/abuso antes de expor piloto. | `apps/api/src/server.js` auth, cookies, logger; `apps/api/test/application.test.js`; manifests só se scripts forem aprovados | Regressão de autenticação, invalidar sessões; impacto de rate limit | Expiração, logout/reuso, reset, token inválido, rate limits concorrentes, logs sanitizados, CSRF/Origin conforme decisão | Testes sintéticos repetíveis; expiração server-side/revogação demonstradas; nenhum segredo/token em logs de teste |
| F2 — Domínio e policy multi-tenant | Introduzir identidade/membership/workspace/role/capability/team/patient assignment conforme F0; enforcement por rota | `apps/api/src/server.js` (hoje monolítico), possível módulos novos sob `apps/api/src/`; `apps/web/public/app.js`, `index.html`, `portal.js` para seleção/UX após API | Cross-tenant IDOR, bypass por rota, papel administrativo confundido com clínico | Matrix HTTP por rota/ação/papel/escopo, patient-link, portal, principal/apoio, exceções, revogação, IDs alterados | Workspace selection muda backend auth; negativos em todos endpoints; remoção afeta só um workspace; dados clínicos locais |
| F3 — Persistência, importador e cutover | Selecionar tecnologia em ADR; schema/migrations executáveis só após aprovação; repositories/transações e importação | Novos módulos API persistence; `apps/api/src/server.js`; novo diretório migration/importer a definir; docs migration | FK errada, perda, duplicação, concorrência e rollback inconsistente | Constraints/FKs, isolamento, transações concorrentes, migration do zero/upgrade, import dry-run/idempotente, reconciliação/restore | zero vínculo cruzado/órfão não aprovado; contagens/IDs/versões reconciliados; restore e rollback praticados; fonte única de verdade |
| F4 — Operação e oferta comercial | Operação segura; entitlements/limites, se estratégia comercial aprovada; cobrança pode continuar fora do MVP | Configuração/deploy/CI e módulos futuros de entitlement; web/API conforme escolha | Plano comercial alterar acesso clínico; falha de backup/ops | RPO/RTO/restore, deploy rollback, alertas; testes de entitlement isolado de policy clínica | Metas operacionais aprovadas demonstradas; MVP roda sem cobrança; plano não concede acesso clínico |

Fases são recomendação de sequência, não decisão de framework ou autorização de implementação. Os testes acima são propostas; não foram executados.

## 8. Fontes e limites

- Baseline aprovado: [PRODUCT_REQUIREMENTS_BASELINE.md](PRODUCT_REQUIREMENTS_BASELINE.md)
- Evidências e riscos: [MULTITENANT_GAP_ANALYSIS.md](MULTITENANT_GAP_ANALYSIS.md)
- Plano detalhado de persistência/cutover: [MULTITENANT_MIGRATION_PLAN.md](MULTITENANT_MIGRATION_PLAN.md)
- Decisões e informações abertas: [MULTITENANT_DECISIONS_REQUIRED.md](MULTITENANT_DECISIONS_REQUIRED.md)
- Contexto integrado e conflitos anteriores: [INTEGRATED_AUDIT.md](INTEGRATED_AUDIT.md)
- Código: `apps/api/src/server.js`, `apps/api/test/application.test.js`, manifests raiz/API/web.

Não foram lidos dados de persistência, logs pessoais ou segredos. Não houve teste, migration, mudança de código ou alteração de banco. A inspeção é documental/estática, não pentest, revisão legal, nem validação da infraestrutura hospedada.
