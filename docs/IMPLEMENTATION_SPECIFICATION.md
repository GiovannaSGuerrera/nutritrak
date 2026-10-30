# Especificação de implementação — NutriTrack multi-tenant

**Data:** 2026-10-29  
**Estado:** contrato técnico para decomposição; não aprova tecnologia nem inicia implementação.  
**Base normativa:** `CONSOLIDATED_ARCHITECTURE_PROPOSAL.md`, `PRODUCT_REQUIREMENTS_BASELINE.md` e os documentos contextuais indicados abaixo. Requisitos aprovados são tratados como invariantes. Recomendações técnicas permanecem opções até ADR/aprovação.

## 1. Contratos de identidade e workspace

Esta seção define fronteiras e relações conceituais, não tabelas, colunas, migrations ou schema executável.

| Conceito | Contrato | Fronteira e relação |
|---|---|---|
| Identidade profissional | Identifica uma pessoa autenticável de forma estável, independentemente dos locais em que trabalha. Credenciais e estado da conta pertencem a essa identidade. | Global; por si só não concede leitura, escrita ou administração de workspace. Pode participar de vários workspaces. |
| Workspace | Contexto organizacional de consultório individual ou clínica, com zero ou mais proprietários, membros, configurações, equipes e vínculos locais de pacientes. | Fronteira primária de autorização e dados clínicos. Tipos individual/clínica e múltiplos proprietários são requisitos aprovados. |
| Membership | Relação contextual entre identidade profissional e workspace, com estado vigente/revogado e papéis/capacidades aplicáveis naquele workspace. | Removê-lo encerra somente essa relação; não encerra a identidade, outros memberships, nem transfere registros. |
| Workspace ativo | Seleção contextual para a operação corrente, estabelecida por sessão/solicitação. | É indicação, não prova de autorização. Backend resolve e valida membership vigente; cliente não escolhe tenant arbitrário como autoridade. |
| Papéis e permissões | Papel é agrupamento nomeado/editável de permissões. Permissão expressa ação sobre recurso e escopo; cargos padrão, personalizados e exceções individuais são requisitos. | Papéis são contextuais ao workspace. Capacidade administrativa não implica clínica. Exceções não atravessam tenant, membership ou escopo máximo. |
| Equipe | Agrupamento operacional de memberships no workspace, usado para escopo e atribuição. | Nunca cruza workspaces. Configuração de principal/apoio é requisito; fluxo por etapa ainda depende de decisão. |
| Identidade do paciente | Identifica a pessoa paciente, separada dos contextos de atendimento. Pode ser global ou local; a forma está pendente. | Mesmo global, não agrega nem compartilha históricos. Associação entre contextos é explícita. |
| Vínculo paciente-workspace | Cadastro/atendimento local de paciente em um workspace, com estado e relações locais. | Tenant-local. Cadastro administrativo não concede prontuário e vínculo de outro workspace nunca satisfaz autorização neste. |
| Prontuário | Conjunto de registros clínicos (avaliações, consultas, metas, planos e versões) relativo ao vínculo local. | Pertence a um único workspace. Referências devem provar que objetos relacionados pertencem ao mesmo tenant; sem agregação automática por identidade global. |
| Atribuição clínica | Relação contextual/temporal que designa responsável principal, apoio, equipe e eventualmente etapas/ações clínicas para o vínculo local. | Controla acesso clínico além de membership e papel. Alteração/saída não transfere autoria/histórico nem reatribui automaticamente pacientes. |
| Sessão | Prova de autenticação associada a uma identidade/principal e estado de validade/revogação. Pode indicar workspace ativo, mas não autoridade permanente. | Backend valida expiração, revogação e membership em operação protegida. Troca de workspace revalida contexto e policy. Sessões profissionais e de paciente têm principals distintos. |

Relações de membership, papel, equipe, atribuição, paciente-workspace, prontuário e auditoria clínica são contextualizadas pelo workspace. Identidade profissional/credencial são globais. Identidade global de paciente é opção de produto, com prontuários separados e links explícitos. Nenhuma rota infere vínculo por nome, e-mail, UUID ou coincidência de campos.

## 2. Contrato de autorização

### Informações para decidir

Para ação protegida, a policy recebe: identidade/principal autenticado; estado e validade da sessão; workspace selecionado; membership vigente; ação e tipo de recurso; recurso e tenant efetivamente carregados; relações pai-filho; papéis/capacidades e exceções vigentes; equipe e atribuição paciente-profissional; estado do recurso (arquivado, draft/publicado); metadados mínimos de auditoria. Tenant fornecido pelo cliente é apenas seletor não confiável.

### Fluxo obrigatório

```text
authorize(request, action):
  principal = authenticate(request.credentials)
  if principal ausente, inválido, revogado ou expirado no servidor: deny
  workspace = resolveWorkspace(request, principal)
  if workspace ausente ou malformado: deny
  membership = findCurrentMembership(principal.identity, workspace)
  if membership ausente, inativo ou removido: deny
  resource = loadResourceWithinWorkspace(request.resourceId, workspace)
  if ID inválido, recurso ausente/de outro workspace, ou relação cruzada: deny
  context = {principal, workspace, membership, resource, action,
             team, patientAssignment, resourceState}
  if evaluateCapabilitiesAndScopedExceptions(context) != explicit_allow: deny
  execute with the same authorization preconditions
  record minimal required audit event
  return only fields permitted for this action
```

- **Negação padrão:** ausência, ambiguidade, falha de lookup, relação inconsistente, timeout da autorização ou policy desconhecida resulta em negação. Não há fallback para ownership legado após ativar policy por workspace.
- **Membership e escopo:** membership é verificado em cada operação protegida. Toda leitura/escrita confirma tenant do recurso e objetos relacionados; listas aplicam o mesmo predicado antes de agregar/paginar. Capacidade clínica em clínica não substitui equipe/atribuição quando o dado/ação exigir.
- **Exceções individuais:** vinculadas a principal, workspace, ação, recurso/escopo e validade, com autoria/trilha. Não criam membership nem contornam tenant/revogação. Precedência allow/deny entre papel e exceção requer decisão antes de ativar cargos customizados.
- **IDs inválidos/adulterados:** UUID não é credencial. ID malformado, de outro tenant, inexistente ou com relações cruzadas falha fechado, sem revelar existência alheia. 404 uniforme é compatível com o inventário atual.
- **Administrativo versus clínico:** gestão de workspace, agenda e cadastro requer capacidades próprias. Prontuário requer capacidade clínica e escopo/atribuição; propriedade, cadastro ou papel operacional não bastam. Proprietário administrativo sem concessão clínica é negado.
- **Após remoção:** requests subsequentes no workspace são negadas conforme SLA; outros workspaces continuam. Requests em andamento seguem semântica aprovada. Portal é principal separado, limitado a vínculos explícitos e projeção/publicação aprovada.

## 3. Inventário de rotas e migração de autorização

Autorização atual resume `ROUTE_INVENTORY.md` e `AUTHORIZATION_MATRIX.md`; é observação estática, não afirma suficiência. Capacidades são categorias, não nomes aprovados. As mudanças não alteram endpoints.

| Grupo | Autorização atual observada | Contexto e permissões futuros | Ownership a substituir/complementar | Testes negativos obrigatórios |
|---|---|---|---|---|
| `GET /api/me` | Sessão profissional; retorna usuário. | Identidade e memberships vigentes; identidade não concede acesso. | UID continua identidade, deixa de ser dono universal. | Sem cookie, cookie aleatório/expirado/revogado; membro removido não aparece ativo. |
| `POST /api/register`, `POST /api/login`, `POST /api/logout` | Públicos; login por e-mail; logout remove token local. | Autenticar identidade global; provisionamento inicial depende de fluxo pendente; logout revoga servidor. | Unicidade de usuário não define tenant. | Duplicidade concorrente/case, credenciais inválidas, abuso, reuso pós-logout. |
| `GET /api/dashboard` | Agrega coleções filtradas por `userId`. | Workspace/membership e capacidades separadas para métricas admin e clínicas; agregados só incluem escopo autorizado. | Filtro UID vira tenant + policy/escopo. | Sem sessão/workspace, tenant adulterado, paciente fora da equipe, vazamento agregado. |
| `GET/POST /api/patients`, `GET/PATCH /api/patients/:id` | Lista por UID; detalhe/edição por `owned()`; detalhe agrega dados. | Cadastro administrativo separado de leitura/escrita clínica; workspace e atribuição nos dados clínicos. | `owned(patients,id,uid)` vira tenant + vínculo; autor permanece autoria, não autorização. | Outro tenant/ID fabricado, recepcionista lendo campos clínicos/relacionados, cadastro sem prontuário, relação inconsistente. |
| `POST /api/patients/:id/invitations`, `POST /api/patients/:id/password-resets` | Exige paciente `owned()`; estado/token em memória. | Capacidade de administrar portal para vínculo local, sem conceder leitura clínica. | Ownership vira workspace + capacidade + vínculo ativo. | Outro tenant, arquivado, portal de outro workspace, repetição concorrente, token em log. |
| Rotas públicas `/api/patient/invitations/{validate,activate}`, `/api/patient/password-resets/{validate,complete}`, `/api/patient/login`, `/api/patient/logout` | Token hash/estado e e-mail; conta portal separada. | Credencial de uso único e vínculo explícito; modelo multi-organização do paciente/portal pendente. | Par paciente-profissional deve ser contextualizado no workspace. | Token inválido/expirado/usado, e-mail divergente, corrida, vínculo removido, sessões pós-reset, enumeração/abuso. |
| `GET /api/patient/me` | Sessão paciente; `safePatientPortal()` valida par paciente/profissional e plano publicado. | Principal paciente e vínculo escolhido/validado; allowlist mínima e conteúdo publicado. | Relação atual ganha contexto de vínculo/workspace e estado de publicação. | Outra conta/vínculo, draft, versão cruzada, arquivado/revogado, dados de outro tenant. |
| `GET/POST /api/assessments` | GET filtra UID; POST verifica paciente `owned()`. | Leitura/criação clínica requer workspace, capacidade, escopo paciente e atribuição. | UID/ownership complementados por tenant e atribuição; relação local. | Sem atribuição, outro workspace/paciente, órfão, relação cruzada, vazamento de lista. |
| `GET/POST/PATCH /api/appointments` | Lista UID; criação verifica paciente e conflito por profissional/status; PATCH ownership. | Agenda/visibilidade e notas clínicas podem ter permissões distintas; workspace, equipe/responsável/paciente. | Dono não é responsável universal; validar tenant e responsável autorizado. | Outro tenant/paciente, acesso de equipe sem permissão, conflito concorrente, notas fora do escopo, transição inválida. |
| `POST /api/goals`, `PATCH /api/goals/:id` | Criação verifica paciente; alteração `owned()`. | Escrita clínica, workspace, atribuição e estado do registro. | UID vira tenant + atribuição, preservando autoria histórica. | ID cruzado, não atribuído, referências divergentes, membro removido. |
| `GET/POST /api/meal-plans`, `GET /api/meal-plans/:id`, `PUT /api/meal-plans/:id/draft`, `POST /api/meal-plans/:id/publish` | Filtros/ownership UID; publicação valida versão; portal só inclui publicado. | Capacidade clínica/escopo; publicação pode ser ação distinta; plano/versão tenant-coerentes. | UID vira tenant + atribuição; leitura de draft também exige autorização. | Outro tenant/paciente, usuário só administrativo, versão cruzada, publish repetido/concorrente, portal errado/draft. |
| Estáticos `GET /`, `/paciente`, páginas/assets | Públicos, CSP/traversal lexical; métodos não-GET sem contrato explícito. | Conteúdo estático público sem dados clínicos; rotas dinâmicas permanecem protegidas. | Sem ownership clínico; garantir que asset não incorpora dados privados. | Traversal codificado, método inesperado, bypass estático/API. |
| Caminhos/métodos não inventariados `/api/` | 404 após ordem de autenticação atual. | Negação padrão; sem rota/alias não mapeado. | Não aplicável; atualizar inventário para endpoints futuros. | Método/caminho/encoding não suportado não contorna policy ou revela existência. |

Antes de migrar cada grupo, matriz rota × método × recurso × ação × principal × escopo deverá nomear allow/deny e retorno externo. Não se alteram endpoints nesta especificação.

## 4. Sessões e segurança

### Requisitos obrigatórios

1. Validade absoluta e, se escolhida, ociosa é verificada no servidor em cada uso; `Max-Age` do cookie sozinho não basta.
2. Logout revoga sessão no servidor. Recuperação/alteração de credencial e eventos de risco invalidam sessões conforme política aprovada. Reuso falha fechado.
3. Membership removido revoga autorização daquele workspace para requests subsequentes e invalida contexto/cache; a sessão pode seguir válida em outros workspaces.
4. Troca de workspace exige nova validação de membership e policy; nenhum papel do workspace anterior é reutilizado.
5. Múltiplas instâncias concordam sobre validade, logout e revogação no horizonte definido; reinício não revalida sessão expirada/revogada.
6. Requests concorrentes têm decisão consistente: autorização ligada à operação/transação ou ponto de linearização documentado. Após o SLA, operação ainda não confirmada é negada/cancelada conforme decisão; efeito já confirmado não é retroativamente desfeito.
7. Logs não incluem senha, token, cookie, hash de credencial, token em URL, payload clínico ou URL/query com segredo. Auditoria contém metadados mínimos, com acesso e retenção controlados.
8. Login, convite e recuperação limitam repetição através de instâncias no escopo definido; respostas reduzem enumeração; derivação de senha tem limite de concorrência.
9. Cookies em produção usam transporte seguro; política CSRF/Origin definida e testada. Sessões profissional/paciente não se confundem.

### Escolhas ainda técnicas, não aprovadas

Sessão opaca persistida/compartilhada versus token assinado com versão/revogação; token puro ou hash; expiração e rotação; cache/TTL de autorização; rate limit distribuído; CSRF/Origin; duração numérica e MFA. O `Map` atual não verifica idade e não compartilha instâncias. Alternativas diferem em revogação, latência, operação e complexidade; comparar contra SLA/ambiente antes de escolher. Nenhum provedor foi aprovado.

## 5. Persistência e migração

Selecionar por ADR com evidências, sem escolher banco/ORM antecipadamente.

| Critério | Evidência exigida |
|---|---|
| Integridade referencial | Referências órfãs barradas; relações paciente, prontuário, equipe, autoria e versões coerentes. |
| Isolamento | Consultas e restrições provam tenant em todos os caminhos; relações cruzadas impossíveis ou bloqueadas. FKs/uniques tenant-aware são opção. RLS pode complementar, nunca substituir policy da aplicação. |
| Transações | Consumo de convite/reset, publicação/versionamento, autorização crítica e escrita clínica não deixam estado parcial. |
| Concorrência | Sem perda de atualização, duplo consumo ou bypass de conflito entre instâncias; locks/isolation/retries documentados. |
| Migrações de schema | Versionadas, ordenadas, aplicáveis a ambiente vazio e atualizável; compatibilidade e mudanças destrutivas documentadas. Nenhuma migration executável criada nesta fase. |
| Backup/restore | Backup protegido/segregado e restauração ensaiada com consistência; RPO/RTO definidos antes de dados reais. |
| Importação idempotente | Importador separado do boot; mesma entrada repetida não duplica; checkpoint/lote rastreável sem PII no relatório. |
| Dry-run | Padrão sem escrita; informa contagens, conflitos e ações previstas sem dados pessoais/clínicos. |
| Reconciliação | Compara IDs, relações, estados e versões via contagens/metadados mínimos; ambíguos aguardam revisão, sem merge por nome/e-mail. |
| Rollback/cutover | Gatilhos, autoridade, backup, janela e compatibilidade definidos. Após escrita nova no destino, não retornar cegamente à origem: forward-fix/reconciliação aprovada. |

Alternativas a comparar: persistência relacional transacional com SQL explícito; query builder/ORM relacional; outra persistência transacional que prove os critérios. Comparar suporte ao Node/CommonJS atual, manutenção, operação, transações, constraints, migrations, concorrência, restore, custo e competências. JSON atual pode permanecer no legado de desenvolvimento enquanto não houver aprovação; não prova capacidade multi-instância. PostgreSQL/RLS são candidatos, não decisões.

## 6. Critérios de aceite da primeira fase — segurança e sessão

Fase não implementa multi-tenant nem migra dados. Verificar com fixtures sintéticas, sem ler o store:

1. Cada rota privada de profissional/paciente testa ausência, token aleatório, expiração e revogação; nenhuma resposta contém dados privados.
2. Reapresentar manualmente cookie após prazo falha por expiração server-side, usando relógio controlável ou timestamps determinísticos.
3. Logout seguido de reuso falha; logout repetido é seguro; reset invalida as sessões definidas pela política aprovada.
4. Sessões profissional e paciente não se autenticam mutuamente; restart/múltiplas instâncias seguem o mecanismo escolhido e não aceitam estado expirado/revogado.
5. Consumo concorrente de convite/reset produz no máximo um sucesso; rate limit atua no escopo multi-instância definido e respostas reduzem enumeração.
6. Teste de corrida comprova ponto de linearização e SLA: depois do limite, novas operações são negadas e operação não confirmada segue semântica aprovada.
7. Login/logout/falha/reset/expiração não registram credenciais, cookies, tokens, URL sensível ou conteúdo clínico; auditoria não inclui payload clínico.
8. Cookies e CSRF/Origin atendem configuração do ambiente alvo sintético; segredo não aparece em cabeçalho/erro.
9. Comportamento legado permanece compatível até migração aprovada; testes não dependem de `data/store.json`.
10. Casos são repetíveis em CI/ambiente temporário sintético sem serviço externo não declarado. Aceite não autoriza piloto com dados reais.

Duração, MFA, canal de recuperação e operações em curso precisam das decisões abaixo para o aceite correspondente.

## 7. Decisões bloqueadoras restantes

Apenas decisões que bloqueiam etapas concretas estão listadas. Tipos de workspace, múltiplos proprietários, identidade profissional multi-workspace, separação administrativa/clínica, permissões granulares, principal/apoio, revogação por workspace e ausência de transferência automática são decisões aprovadas, não pendências.

| Decisão | Por que / alternativas | Etapas dependentes | Pode adiar? |
|---|---|---|---|
| SLA e semântica para requests já iniciados na revogação | Necessário ao ponto de linearização e teste. Alternativas: só requests iniciados depois; cancelar antes do commit; concluir requests autorizados antes do corte. | Aceite concorrente F1, enforcement de membership F2, cache/sessão. | Sim para expiração/logout e fixtures isoladas; não para declarar revogação segura ou piloto. |
| Modelo de identidade/vínculos de paciente e escopo de portal no MVP | Cadastro local, identidade global com links ou híbrido; portal por vínculo/conta global/local. Todos preservam prontuários separados. | Domínio paciente, portal, schema e importação. | Sim para F1 e policy profissional sem portal; não para portal/schema/importação. |
| Capacidades MVP e governança de papéis/exceções | Define catálogo mínimo, administradores e precedência allow/deny. Alternativas: somente proprietários ou delegados com capacidades específicas; sempre deny-by-default. | Matriz concreta por rota/papel; administração e ativação de cargos customizados. | Sim para framework neutro e F1; não para permissões de produção/equipe. |
| Fluxo de atribuição/equipe e procedimento explícito de saída | Define como principal/apoio/equipe autorizam e destino de tarefas. Opções incluem atribuição por paciente/etapa e reatribuição manual auditada. Transferência automática continua proibida. | Clínica colaborativa, equipe, saída e continuidade do cuidado. | Sim para workspace individual sem equipe; não para colaboração clínica. |
| Provisionamento e mapeamento das contas atuais | Workspace automático ou explícito; entrada em clínica via convite/associação aprovada. Não inferir membership por e-mail. | Contexto inicial real, onboarding, migração/cutover. | Sim para fixtures; não para habilitar contas reais/migrar. |
| Parâmetros operacionais para persistência e dados reais | Região, infraestrutura, orçamento, equipe, disponibilidade, RPO/RTO determinam escolha justificável e restore verificável. | ADR, deploy, backup/restore e piloto real. | Sim para protótipo sintético; não para seleção final/cutover/dados reais. |
| Ciclo de vida e auditoria para uso real | Retenção/exportação/correção/encerramento e eventos/prazos afetam referências, backups e operação; requer responsáveis competentes. | Schema final, saída/exclusão e piloto real. | Sim para protótipo; não para schema final/dados reais. |
| Autenticação/recuperação e abuso no piloto | Canal verificado, MFA (ao menos privilegiados), limites e resposta a takeover. Opções incluem MFA obrigatório ou escalonado; suporte depende da operação. | Aceite F1 para piloto, endpoints públicos e piloto real. | Rate limit/logging podem avançar sinteticamente; não liberar piloto real sem política e responsáveis. |

Cobrança, preço, limites comerciais e provedor podem esperar: cobrança não é requisito do MVP e não concede autorização clínica. Tecnologia pode esperar até critérios operacionais, sem impedir protótipos sintéticos.

## 8. Decomposição proposta em tarefas futuras (não executar)

Arquivos são potenciais, inferidos da estrutura atual. Testes listados são trabalho futuro.

| # | Objetivo e escopo | Dependências | Arquivos potencialmente afetados | Riscos | Testes necessários | Critério de conclusão |
|---|---|---|---|---|---|---|
| 1 | Fechar contrato F1 de validade, logout, reset, revogação/rotação e concorrência; registrar SLA e ameaça. Só documentação. | Decisão de SLA; canal/MFA no escopo do piloto. | `docs/IMPLEMENTATION_SPECIFICATION.md`, ADR em `docs/decisions/` | SLA vago torna testes inconclusivos ou incompatíveis com clínica. | Revisar cenários sintéticos e estados; não executar teste de aplicação nesta tarefa. | Decisões mínimas registradas; F1 sem ambiguidade. |
| 2 | Implementar harness sintético e sessão segura sem tenant parcial. | Tarefa 1; decisão de armazenamento compatível com instâncias alvo. | `apps/api/src/server.js`, módulos futuros `apps/api/src/`, `apps/api/test/application.test.js` | Regressão de login/reset, revogação indevida, log sensível. | Ausente/inválido/expirado/logout/reuso/reset, concorrência, instâncias, abuso e sanitização. | Aceite F1 demonstrado sem dados reais/store pessoal. |
| 3 | Aprovar capacidades MVP e matriz por rota, ação, principal e escopo, incluindo governança/exceções. | Catálogo e governança decididos. | `docs/AUTHORIZATION_MATRIX.md`, esta especificação | Papel amplo vira acesso clínico; matriz incompleta. | Revisar caminhos e casos allow/deny sintéticos. | Cada ação protegida tem regra e negativos explícitos. |
| 4 | Fechar identidade paciente, vínculo local, portal, atribuição/equipe e saída manual. | Decisões de paciente/portal, fluxo e saída. | Documentos de domínio, `docs/development/patient-portal.md`, `docs/DATABASE_DESIGN.md` | União de históricos, exposição portal, atribuição implícita. | Mesma pessoa em dois workspaces, vínculo revogado, principal/apoio/saída. | Relações inequívocas sem compartilhamento automático. |
| 5 | Selecionar persistência por ADR e provar constraints, transações, concorrência e restore sintéticos. | Requisitos operacionais, região, RPO/RTO, equipe e domínio mínimo. | `docs/decisions/` e módulos futuros de persistência; manifests somente se aprovados. | Escolha sem suporte operacional ou restore demonstrável. | Comparação, FKs tenant-aware, rollback transacional, corrida, restore. | ADR justifica escolha e critérios obrigatórios passam. |
| 6 | Implementar identidade/workspace/membership e policy central, sem importar dados. | Tarefas 3–5; provisionamento/mapeamento decidido. | `apps/api/src/server.js`, módulos novos `apps/api/src/`, `apps/api/test/` | Bypass de rota, contexto forjado, mistura admin/clínico. | Policy e matriz HTTP de membership, workspace adulterado e remoção. | Toda rota privada resolve contexto/membership e falha fechado. |
| 7 | Migrar grupos de rotas em fatias, mantendo caminhos; cadastro antes de recursos clínicos/portal. | Tarefa 6; atribuições e capacidades decididas. | `apps/api/src/server.js`/handlers futuros, `apps/api/test/application.test.js`, frontend `apps/web/public/*` se aprovado. | IDOR, agregados com vazamento, diferenças GET/mutação. | Negativos de cada grupo da seção 3, por método e relação. | Cada rota cobre allow/deny; ownership não é policy única. |
| 8 | Planejar/implementar importador isolado idempotente, dry-run e reconciliação em fixtures. | Persistência/domínio estáveis; autorização de origem antes de dados reais. | Módulo futuro, `docs/MULTITENANT_MIGRATION_PLAN.md`, testes novos. | Duplicação/perda, PII em relatório, associação errada, rollback falho. | Repetição, conflitos sintéticos, dry-run sem escrita, reconciliação, restore/rollback. | Fixtures reconciliadas e exceções explícitas; sem leitura real antes do gate. |
| 9 | Preparar gate operacional de piloto: TLS/segredos, logs/auditoria, rate limit, backup/runbooks e revisão. | Operação, ciclo de vida, autenticação/persistência; aprovação dos responsáveis. | Configuração/deploy/CI e documentação operacional futura. | Exposição clínica, recuperação impossível, suporte privilegiado. | Exercício sintético de restore, incidente, revogação e auditoria. | Gates assinados e evidências operacionais aprovadas. |

## Referências e limites

- [Proposta consolidada](CONSOLIDATED_ARCHITECTURE_PROPOSAL.md)
- [Baseline de produto](PRODUCT_REQUIREMENTS_BASELINE.md)
- [Inventário de rotas](ROUTE_INVENTORY.md)
- [Matriz de autorização atual](AUTHORIZATION_MATRIX.md)
- [Análise de lacunas](MULTITENANT_GAP_ANALYSIS.md)
- [Plano de migração](MULTITENANT_MIGRATION_PLAN.md)
- [Decisões necessárias](MULTITENANT_DECISIONS_REQUIRED.md)
- [Auditoria integrada](INTEGRATED_AUDIT.md)
- [Revisão arquitetural](ARCHITECTURE_REVIEW.md)
- [Desenho de banco existente, ainda proposta](DATABASE_DESIGN.md)

Evidência de autorização é estática/documental. Não foram consultados `data/store.json`, dados clínicos, logs pessoais ou segredos. Esta especificação não declara conformidade, não seleciona tecnologia e não autoriza uso de dados reais.
