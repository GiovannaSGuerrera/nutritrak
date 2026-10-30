# Revisão integrada da arquitetura SaaS — NutriTrack

**Data:** 2026-10-29  
**Status:** revisão técnica; recomendações não aprovam decisões de produto nem certificam segurança ou conformidade legal.  
**Escopo lido integralmente:** `SAAS_ARCHITECTURE.md`, `DATABASE_DESIGN.md`, `MIGRATION_PLAN.md` e `SAAS_IMPLEMENTATION_ROADMAP.md`. Código consultado: `apps/api/src/server.js`, `apps/api/test/application.test.js`, `apps/web/public/app.js`, `apps/web/public/portal.js` e manifests do workspace. O conteúdo de `data/store.json` não foi lido.

## 1. Resumo executivo

Os quatro documentos formam uma direção tecnicamente coerente: manter o monólito Node.js, migrar para PostgreSQL antes de dados reais, definir tenant e autorização antes do schema, usar consultas e constraints tenant-aware, migrar de forma controlada e adiar cobrança e expansão. Eles distinguem corretamente proposta de implementação e não afirmam conformidade com a LGPD.

A direção do produto informada nesta revisão — primeira oferta para profissional individual, com preparação para consultórios futuros — é compatível com tenant organização de uma pessoa, desde que a organização individual seja apenas uma fronteira técnica/comercial e não conceda compartilhamento implícito. A proposta ainda requer aprovação explícita de propriedade dos pacientes, memberships, papéis, transferência e portal. A equipe/clínica pode ficar fora do MVP, mas as relações e FKs escolhidas agora não devem impedir sua adição.

O código verificado permanece protótipo: `server.js` concentra API e persistência em JSON; propriedade é filtrada por `userId`; sessões vivem em `Map`; e o portal paciente vê versões publicadas por vínculo direto com profissional. Há um cookie `Max-Age=28800`, mas não existe expiração validada no servidor; reiniciar processo remove sessões e múltiplas instâncias não compartilham estado. Não há rate limit observado. O teste existente cobre alguns fluxos, incluindo acesso cruzado básico, não uma matriz completa de rotas e papéis. Portanto, não usar dados reais de saúde antes dos gates de segurança, persistência, operação e avaliação competente de privacidade.

Não alterei os quatro documentos-base: apesar de haver decisões não resolvidas e pontos que pedem esclarecimento, eles são explicitamente propostas e não há uma contradição factual que deva ser corrigida sem aprovação de produto. Este relatório registra as interpretações e lacunas para resolver antes da implementação.

## 2. Pontos de consistência

- Arquitetura e roadmap preservam o monólito e propõem extrair módulos gradualmente, sem exigir microsserviços ou troca simultânea de framework.
- O modelo de organização/membership e as FKs compostas dão um caminho para isolamento por tenant; o plano de migração reconhece que `userId` antigo não pode ser convertido em organização por heurística de e-mail.
- O esquema transforma agregados atuais: `goals.progress[]` em `goal_progress`, versões/refeições/itens em tabelas próprias e portal em conta separada. A migração descreve essas expansões e a preservação de `publishedVersionId`.
- Convites e resets são tratados como tokens de uso único com hash; sessões são tokens opacos persistidos no destino; segredos e payloads clínicos são excluídos dos logs propostos.
- Migração, roadmap e arquitetura vedam dual-write improvisado, descarte silencioso e retorno cego ao JSON depois de novas gravações no banco.
- Cobrança está separada dos registros clínicos e a inadimplência não deve apagar dados. Isso permite manter billing fora do MVP.
- A proposta para profissional individual é compatível com um tenant organização individual e membership proprietária. Compartilhamento exigiria relação explícita paciente-profissional/membership e policy; não decorre de pertencer à mesma tabela ou tenant.

## 3. Inconsistências e lacunas objetivas

1. **Organização versus usuário proprietário:** o diagrama põe pacientes na organização, enquanto o modelo atual é por usuário. A tabela `patient_relationships` é opcional e a arquitetura recomenda relação profissional/paciente, mas o roadmap exige cobertura de autorização por rota. Sem decidir se o MVP exige sempre um vínculo ativo individual, um tenant compartilhado poderia dar a membros acesso amplo demais. Definir uma regra única antes do schema: cada leitura clínica deve exigir tenant ativo e, para acesso individual/restrito, vínculo ativo do membership ao paciente.
2. **Criador não é necessariamente membership:** `patients.created_by_user_id` sugere usuário; a nota recomenda FK para membership. `created_by_membership_id` aparece nas demais tabelas. Padronizar autoria em membership, com semântica histórica, ou documentar a exceção. Um `created_by` não deve ser confundido com autorização atual.
3. **Identidade global e conta de portal:** `users.email_normalized` é globalmente único, mas `patient_accounts.email_normalized` parece separado. O código hoje impede colisão de e-mail entre profissional e portal e trata cada conta paciente vinculada a um profissional. Escolher se paciente terá identidade global, se pode ter mais de um vínculo e como e-mail compartilhado/duplicado será resolvido. Não unir contas automaticamente por e-mail.
4. **Ativação/reset requerem operação atômica:** o modelo sugere consumo condicional e a arquitetura lista transações; o fluxo atual marca convite usado, cria conta e grava depois. O banco precisa consumir token, criar/atualizar credencial, revogar sessões e gravar evento atomicamente, com proteção contra consumo concorrente.
5. **Idempotência ainda não é especificação executável:** o plano exige UPSERT pela origem/ID/versão e checkpoint, mas não define tabela/manifesto durável de importação, chave exata da execução, política de conflito com escrita posterior nem comportamento ao repetir versão parcial. Definir essas regras antes de implementar o importador. Repetibilidade não pode sobrescrever mudanças feitas após uma importação aceita.
6. **Rollback é dependente do momento:** os documentos reconhecem que voltar ao JSON antigo após novas escritas perde dados, mas “migration reversível ou forward-fix” pode ser interpretado como downgrade automático. Toda fase deve nomear migrations destrutivas (se houver), compatibilidade de release e autoridade/gatilhos do rollback; após cutover com escrita, preferir forward-fix ou reconciliação aprovada.
7. **Semântica de agenda precisa preservar comportamento e decidir concorrência:** o JSON usa `start`, `end`, `duration`, timezone implícito e bloqueia sobreposição por profissional apenas para status `agendada`. O esquema propõe timestamptz, duração, responsável e exclusion constraint ainda condicional. Definir fuso exibido, estados que bloqueiam horário, intervalos de borda e se colisão é por responsável ou organização antes da migration.
8. **O calendário de lançamento não é o mesmo que piloto:** o roadmap põe billing na fase 8 depois do piloto; isso é consistente se piloto fechado não cobrar. Se “primeira versão comercial” exigir cobrança, decisão de produto pode tornar billing gate comercial, mas não gate de dados reais/piloto técnico.

## 4. Riscos técnicos e de segurança

### Fatos verificados no código

- A API lê e grava `data/store.json`; as gravações são serializadas em uma fila dentro de um processo, com arquivo temporário e rename. Não há transações relacionais, constraints ou coordenação entre processos.
- A autenticação profissional e paciente usa mapas locais em memória. Cookie de oito horas é limite no cliente; `userFor`/`patientAccountFor` não verifica idade server-side. Reinício apaga sessões e uma segunda instância não reconhece sessões emitidas por outra.
- O cookie usa `HttpOnly`, `SameSite=Strict`, `Path=/`; `Secure` é acrescentado apenas quando `NODE_ENV=production`. Verificar configuração de proxy/TLS e alinhar também a expiração/revogação server-side. Logout remove a sessão local.
- Senhas são derivadas com `scrypt` e salt aleatório; tokens de convite/reset são comparados por hash SHA-256. Fluxos do portal hoje retornam links/tokens para a interface copiar manualmente, não enviam e-mail.
- O portal usa conta separada, valida relação paciente-profissional e constrói DTO com dados de planos publicados. Isso é uma proteção observada no estado atual, não uma policy de tenant futura.
- `owned(list,id,userId)` implementa filtragem por dono em várias rotas e verificações de paciente nas criações; não cobre compartilhamento/equipe porque o domínio não existe no código.
- Não foi encontrada implementação de rate limiting. Não há prova de configuração de produção, banco, backup/restore ou monitoramento nos manifests/código inspecionados.
- O teste de integração cobre cadastro, avaliação, publicação/versionamento, acesso cruzado a paciente/plano e conflito de agenda. Não cobre todas as rotas/métodos, papéis, concorrência, sessões após restart/duas instâncias, abuso, falhas de persistência ou garantias operacionais.

### Controles recomendados antes de dados reais

- Sessão aleatória opaca com somente hash persistido; expiração absoluta e ociosa verificadas no backend; rotação em login/elevação; revogação individual, logout global e revogação de sessões após recuperação; cookies seguros por ambiente e estratégia explícita para CSRF/Origin.
- Rate limit distribuído por conta/IP/operação para login, cadastro, convites e recuperação; limite de payload, resposta que reduza enumeração de contas e proteção contra consumo concorrente de token. Limitar custo de operações de hash.
- Recuperação de profissionais por canal verificado e e-mail transacional para convites/reset. Fluxo manual atual de copiar token não comprova entrega segura nem controle de destinatário.
- Matriz de autorização por rota, método, tipo de principal, tenant, papel e relação com paciente. Resolver tenant a partir da sessão/membership; nunca confiar em `tenantId` fornecido pelo cliente. Fazer consulta de recurso com tenant e relação no predicado SQL; UUID não é permissão. Registrar evento mínimo na mesma transação da ação crítica.
- PostgreSQL com FKs compostas, `NOT NULL`, `UNIQUE`, `CHECK`, índices alinhados às consultas e transações. RLS pode ser camada adicional após desenho de pool/reset de contexto e testes; não substitui autorização de aplicação.
- Logs sem senha, token, cookie, corpo clínico, URL com segredo ou dados pessoais desnecessários; auditoria durável com acesso/retention aprovados. Backups criptografados, segregados, restore exercitado, credenciais mínimas, TLS e gestão de segredos.
- Threat model, revisão de dependências/runtime, proteção de XSS/CSRF, tratamento de erros e limites, monitoramento sem conteúdo clínico e runbook de incidente. Revisão independente de segurança/privacidade apropriada ao uso e avaliação legal por responsáveis competentes; este relatório não declara LGPD.

### Privacidade e ciclo de vida pendentes

Definir finalidade e dados mínimos; papéis de controlador/operadores e contratos aplicáveis com assessoria competente; região e subprocessadores; acesso e transparência do portal; retenção de prontuário, snapshots e auditoria; exportação, correção, encerramento e exclusão; retenção de backups após expurgo; acesso de suporte; resposta a incidente; e política após inadimplência/cancelamento. Dados fictícios sintéticos reduzem o impacto, mas não tornam dados reais de saúde equivalentes nem apropriados para testes comuns.

## 5. Decisões pendentes priorizadas

“Agora” significa antes de fechar schema/contratos da Fase 1–4; não significa aprovação automática. “Bloqueia?” refere-se à decisão de iniciar a primeira fase de implementação (baseline de testes/documentação isolada pode avançar sem algumas decisões, conforme indicado).

| Prioridade / quando | Decisão | Opções possíveis | Recomendação técnica | Impacto no produto | Consequência de adiar | Bloqueia implementação? |
|---|---|---|---|---|---|---|
| Agora — responsável do produto | Modelo inicial de tenant | Usuário profissional; organização de uma pessoa; organização de equipe desde o início | Aprovar organização individual provisionada automaticamente como tenant; membership proprietária única no MVP; estrutura suporta múltiplos membros depois | Define conta, ownership, onboarding e futura venda a clínicas | Schema e migração ambíguos; risco de associação de dados errada | **Sim** para autorização, schema e persistência; baseline pode iniciar |
| Agora — responsável do produto | Acesso a paciente / compartilhamento | Só profissional responsável; todos no tenant; vínculos/permissões explícitos | Exigir relação ativa paciente↔membership para dados clínicos; deny-by-default; compartilhamento futuro por concessão auditada granular | Determina colaboração e transferência | Tenant de equipe pode ampliar acesso sem intenção | **Sim** para schema e policy |
| Agora — responsável do produto | Vínculo e transferência de paciente | Cadastro por tenant; um vínculo ativo; vários vínculos; transferir, duplicar ou convidar | Um cadastro clínico por tenant e vínculos explícitos; definir transferência e visibilidade histórica; sem merge por e-mail | Afeta continuidade do cuidado, duplicatas e portal | Importação sem regra pode revelar histórico ou duplicar registro | **Sim** se portal/migração incluídos; ao menos regra de vínculo sim |
| Agora — produto/privacidade | Portal do paciente | Desligado no piloto; somente plano atual publicado; histórico; mais conteúdo | Manter escopo mínimo: versão autorizada/publicada, conta vinculada, revogação definida; decidir se portal entra no piloto antes do schema final | Muda experiência paciente e compartilhamento | Exposição de conteúdo e escopo de teste incertos | **Sim** para modelo/fluxo do portal; não bloqueia baseline |
| Agora — produto/privacidade/operação | Retenção, exportação, correção, exclusão e auditoria | Prazos/fluxos por entidade; retenção uniforme; política por contrato | Aprovar política por categoria e evento, inclusive backups e conta encerrada, com orientação legal competente | Influencia confiança, suporte e custo | Risco de retenção excessiva ou expurgo indevido; auditoria sem prazo | **Sim** para schema e dados reais |
| Agora — técnica/equipe | Driver/ORM e migration ledger | Driver PostgreSQL com SQL; ORM com migrations | ADR curta comparando suporte Node/CommonJS, transações, migrations, pooling, SQL e operação; adicionar ledger/checksum/import-run explícito | Influencia velocidade e manutenção | Ferramenta pode forçar retrabalho ou importação não repetível | **Sim** antes da Fase 4/5; não antes de baseline |
| Agora — operação | Ambiente, região, segredos, backup e RPO/RTO | Hospedagem gerenciada/VM; região e níveis de recuperação diversos | Escolher por residência/contratos/custo e provar restore antes de dados reais; declarar metas e operador | Disponibilidade, custo e confiança | Sem destino operacional nem critério de recuperação | **Sim** antes do piloto com dados reais; não para protótipos sintéticos |
| Agora — produto/operação/privacidade | Autenticação profissional e recuperação | MFA obrigatório/opcional; e-mail; recuperação assistida | Definir canal verificado, revogação em reset, rate limits; avaliar MFA para profissionais antes do piloto e privilegiados | Fricção e recuperação da conta | Bloqueio de usuário ou takeover sem resposta segura | **Sim** para piloto real |
| Agora — produto | Escopo do primeiro piloto e da oferta comercial | Portal incluído; billing incluído; profissional individual; clínica | Confirmar MVP profissional individual; piloto restrito pode anteceder cobrança; billing e equipe fora do MVP salvo requisito comercial explícito | Define sequência e critério de lançamento | Roadmap pode entregar fluxo técnico sem produto vendável esperado | **Sim** para critérios de aceite; billing não bloqueia piloto técnico |
| Antes da importação | Origem e legitimidade dos dados em `data/store.json` | Não importar; migrar tudo; selecionar/reconciliar | Pessoa autorizada confirma origem/finalidade e autoriza snapshot/ambiente; tratar dados como potencialmente reais | Determina se e quais registros entram | Importação indevida ou mistura de fixture e dado pessoal | **Sim** para qualquer leitura/importação de valores e cutover |
| Antes do corte | Tokens e credenciais legados | Invalidar convites/reset; migrar hashes após validação; exigir novo login | Invalidar sessões em memória; normalmente reemitir tokens ativos; preservar hash de senha somente após compatibilidade/revisão e autorização | Fricção de reautenticação/ativação | Links órfãos ou credenciais incompatíveis | **Sim** para cutover |
| Pode esperar — produto | Papéis de equipe e administração detalhados | Proprietária, profissional, assistente, suporte | Não oferecer equipe no MVP; definir catálogo e privilégio mínimo antes de ativar memberships adicionais | Expansão para consultórios | Pode limitar expansão; não impede profissional individual | Não para MVP, sim antes de equipe |
| Pode esperar — produto/comercial | Provedor, preço e estados de billing | Sem cobrança no piloto; cobrança individual; organização | Adiar integração, manter abstração mínima; definir inadimplência, cancelamento e exportação antes de cobrar | Monetização | Atraso no lançamento pago, sem risco à integridade clínica se billing fora do MVP | Não para piloto técnico; sim para venda cobrada |
| Pode esperar — técnico/produto | RLS, MFA obrigatório universal, retenção avançada | Consultas tenant-aware; RLS adicional; MFA escalonado | Aplicação + constraints sempre; avaliar RLS como defesa adicional com teste de pool; MFA conforme risco antes de produção pública | Defesa/custo e fricção | Menos defesa adicional/controles de conta até decisão | Não bloqueia baseline; RLS não deve atrasar schema se não adotada |

## 6. Escopo recomendado para o MVP

| Funcionalidade/controle | Classificação | Justificativa |
|---|---|---|
| Um profissional por tenant organização; sem equipe nem compartilhamento implícito | Obrigatória antes do piloto com dados reais | Limita superfície de autorização e atende à primeira oferta proposta, preservando futuro crescimento |
| PostgreSQL, migrations versionadas, transações e constraints tenant-aware | Obrigatória antes do piloto com dados reais | JSON e `Map` não são persistência/identidade compartilhadas adequadas a serviço com dados reais |
| Policy server-side em cada rota e recurso; isolamento negativo automatizado | Obrigatória antes do piloto com dados reais | Filtragem `userId` atual não implementa tenant/equipe nem prova autorização completa |
| Sessões server-side com expiração, revogação, rotação; rate limit; recuperação segura | Obrigatória antes do piloto com dados reais | Cookies e mapas atuais não validam expiração no backend nem limitam abuso |
| Portal, se incluído no piloto: vínculo explícito, allowlist mínima, publicação/revogação e testes de acesso | Obrigatória antes do piloto com dados reais | Portal é fluxo de divulgação de dado clínico e requer escopo aprovado |
| Origem de dados autorizada, importador repetível, reconciliação e rollback testado | Obrigatória antes de importar dados reais | O arquivo local pode conter dados reais; `.gitignore` não é controle suficiente |
| HTTPS, secrets, ambientes segregados, backup criptografado/restaurado, resposta e responsáveis | Obrigatória antes do piloto com dados reais | Disponibilidade/recuperação e acesso a dados pessoais exigem controle operacional verificável |
| Política aprovada de dados, retenção, exportação/correção/encerramento e avaliação de privacidade competente | Obrigatória antes do piloto com dados reais | Decisões de ciclo de vida não podem ser inferidas pelo schema; sem declaração automática de conformidade |
| MFA de profissionais, recomendado avaliar como gate do piloto conforme ameaça; MFA de contas privilegiadas | Obrigatória antes do lançamento comercial para papéis privilegiados; decisão de piloto agora | Reduz risco de takeover; produto decide fricção e perfil de ameaça |
| CI reproduzível, alertas, runbooks exercitados, revisão de segurança e processo de suporte | Obrigatória antes do lançamento comercial (elementos críticos também antes do piloto) | Operação contínua e resposta a incidente devem ter responsáveis e evidência |
| Onboarding comercial completo, self-service e suporte ampliado | Obrigatória antes do lançamento comercial | Pode ser manual e restrito no piloto |
| Billing, webhooks, reconciliação, inadimplência e cancelamento | Obrigatória antes do lançamento comercial pago | Roadmap corretamente posterior ao piloto técnico, salvo requisito de cobrança antecipada |
| Equipes, papéis adicionais, patient sharing, transferência entre clínicas e multi-tenant de paciente | Pode ser implementada posteriormente | Preparar chaves/membership e relação explícita agora; ativar após desenho e testes próprios |
| RLS, microsserviços, frontend/framework novo, analytics clínico avançado | Pode ser implementada posteriormente | Não substituem controles básicos e não são necessários sem benefício validado |

Dados sintéticos podem ser usados em testes e staging, mas fixtures devem ser fabricadas e não cópias mascaradas sem processo aprovado. Um piloto com dados reais já é uso de risco real, mesmo que pequeno, gratuito ou fechado.

## 7. Critérios de aceite para iniciar a implementação

### Para iniciar a primeira fase (baseline de comportamento)

- Confirmar escopo: não alterar código funcional nesta revisão; os testes novos futuros usarão fixtures sintéticas.
- Congelar snapshot documental do comportamento atual e inventário de rotas; não importar nem inspecionar valores do store sem autorização explícita e controles de ambiente.
- Atribuir responsável por aprovar decisões de produto/tenant e responsáveis técnicos. A Fase 1 do roadmap pode iniciar em dados sintéticos enquanto decisões não bloqueantes aguardam.

### Antes de fechar schema e implementar persistência

- Aprovar tenant individual com evolução para consultórios e regra deny-by-default de relação profissional↔paciente.
- Aprovar identidade, vínculo/transferência, portal e política de autoria; documentar matriz recurso × ação × papel/principal.
- Aprovar decisões de ciclo de vida e retenção com revisão competente; escolher semântica de agenda/timezone e conflitos.
- Aprovar ADR de driver/ORM, migrations e ledger de importação/repetição; especificar constraints/índices de consultas do MVP.

### Antes de qualquer piloto/importação com dados reais

- Revisão de segurança e privacidade adequada e aprovação de origem/uso dos dados; nenhuma afirmação de conformidade baseada apenas neste relatório.
- Testes negativos por rota/principal/tenant, concorrência, sessão/revogação/restart, rate limit, CSRF/Origin, tokens únicos e DTO do portal.
- Importação dry-run repetida com fixtures de casos ruins, conciliação sem payload pessoal em logs, backup/restauração e rollback praticados.
- PostgreSQL operacional com TLS/segredos mínimos; logs/auditoria minimizados; responsáveis, suporte, incidente, monitoramento, RPO/RTO e critérios de suspensão definidos.

## 8. Sequência recomendada de execução

1. **Aprovar domínio mínimo (Fase 0):** registrar ADR curto: profissional individual provisionado como organização/tenant; uma membership proprietária; pacientes privados por padrão; nenhuma equipe ativa; regra de vínculo e futuro compartilhamento explícito. Aprovar também portal, ciclo de vida e escopo de piloto.
2. **Baseline e threat model (Fase 1):** mapear todas as rotas atuais, principais, recursos e casos negativos; usar dados sintéticos; não consolidar comportamento inseguro como contrato.
3. **Corrigir autenticação/abuso e modularizar (Fases 2–3 em fatias):** criar fronteira única de policy e casos de uso; persistir sessões/hash; expiração backend, revogação, rate limits, recuperação e logs seguros. Não exigir microsserviços.
4. **Escolher PostgreSQL e fechar schema (Fase 4):** resolver chaves e cardinalidades; adicionar constraints, índices, transações e migrations; provar isolamento em queries e connections; agenda concorrente e portal como gates próprios.
5. **Construir migração isolada (Fase 5):** só após autorização da origem; dry-run default, ledger/checkpoint estável, regra de conflitos e reconciliação; nunca imprimir PII; ensaiar repetição, restore e rollback.
6. **Preparar operação (Fase 6):** ambiente/região, gestão de segredos, TLS, backup/restore, alertas, runbooks, suporte e avaliação competente; provar controles em staging sintético.
7. **Executar piloto restrito (Fase 7):** após todos os gates de dados reais, com acesso e população limitados, critérios de saída e plano de suspensão aprovados.
8. **Cobrar e expandir (Fase 8+):** implementar billing apenas quando oferta, provedor, cancelamento e inadimplência forem aprovados; adicionar equipe/compartilhamento em fase própria.

## 9. Alterações nos documentos-base

Nenhum dos quatro documentos-base foi alterado. Os pontos de organização individual, import ledger/idempotência, regra de vínculo por paciente e distinção entre piloto fechado e lançamento pago são esclarecimentos necessários, mas não contradições que possam ser corrigidas sem decisão do responsável pelo produto. Este relatório os torna gates explícitos.
