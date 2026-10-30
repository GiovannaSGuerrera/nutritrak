# Auditoria integrada de arquitetura, documentação e estado atual do NutriTrack

**Data:** 2026-10-29
**Escopo:** revisão documental e inspeção estática do workspace e dos fluxos de autenticação, autorização, persistência e rotas.
**Status:** diagnóstico e recomendações; nenhuma decisão de produto foi aprovada por este documento.
**Limite de dados:** nesta auditoria não foi aberto, lido nem consultado `data/store.json`. Não foram executados testes, comandos de migração ou alterações de aplicação.

> **Reconciliação posterior:** as decisões de produto fornecidas em 2026-10-29 após este relatório são normativas para a arquitetura futura. Para a proposta consolidada, consulte [CONSOLIDATED_ARCHITECTURE_PROPOSAL.md](CONSOLIDATED_ARCHITECTURE_PROPOSAL.md) e o baseline atualizado. Onde o texto histórico abaixo disser que tipo de tenant/workspace, separação administrativa/clínica, múltiplos proprietários ou ausência de cobrança no MVP aguardam aprovação, essa pendência foi superada pelas decisões mais recentes. Permanecem abertas as regras de provisionamento, catálogo detalhado de capacidades, identidade/portal de paciente, fluxo de atribuição e informações operacionais listadas na proposta consolidada. O registro histórico é preservado para explicar a cronologia, não como requisito atual.

## 1. Resumo executivo

O repositório contém um protótipo funcional em Node.js/CommonJS: workspace pnpm, API com `node:http`, interface estática servida pelo mesmo processo e persistência em arquivo JSON. O código aplica verificações de propriedade por `userId` em várias rotas profissionais. O portal tem sessão separada e resposta allowlist com planos publicados. O desenho SaaS proposto preserva o monólito, recomenda PostgreSQL, políticas server-side, constraints tenant-aware, migração ensaiada e operação controlada. Essa direção é compatível com a stack e, em geral, coerente entre os documentos.

O código atual não implementa as propostas de SaaS. Sessões estão em `Map` sem expiração server-side; o cookie anuncia oito horas, mas o backend não verifica idade. O store JSON não possui transações ou coordenação entre processos. Não há rate limiting, nem modelo de organização/membership/equipe. O único teste cobre um recorte do fluxo e não demonstra a matriz completa de autorização. A aplicação não deve receber dados reais de saúde até serem cumpridos os gates aprovados de persistência, autorização, operação e privacidade.

O contexto fornecido pelo solicitante informa uma execução local recente de **1 teste aprovado, 0 falhas**. Documentos existentes descrevem uma execução distinta no ambiente restrito em que o teste falhou antes das verificações funcionais por erro de loopback (`EACCES`/`fetch failed`). Não executei os testes nesta auditoria; portanto registro o resultado local como informado pelo solicitante, e o resultado de sandbox como evidência documental de outro contexto. Esses resultados não devem ser combinados nem usados para declarar cobertura completa.

Foram identificadas inconsistências de escopo entre documentos: há divergência sobre se a auditoria anterior consultou ou não `data/store.json`; uma recomendação de organização individual aparece como direção preferida, mas o próprio conjunto mantém tenant, vínculo, portal e retenção como decisões pendentes; e autoria de paciente alterna entre usuário e membership no desenho de banco. Há também duplicação de recomendações de segurança e migration em vários documentos, sem índice mestre que determine qual texto é normativo ou como sincronizar atualizações.

**Orientação:** antes de schema ou migração, obter aprovações explícitas para tenant, acesso/compartilhamento e transferência de paciente, portal, retenção, estratégia de origem/importação, comportamento dos fluxos existentes e limites do piloto. Em paralelo, são possíveis baseline documental e testes sintéticos sem escolher essas questões. Não adotar a proposta de tenant individual por inferência.

### Prioridades de risco

| Prioridade | Risco principal | Estado |
| --- | --- | --- |
| **Crítico** | Store JSON local como persistência de um SaaS com dados clínicos | Implementado; inadequado ao uso proposto |
| **Alto** | Sessões sem expiração server-side e não compartilhadas entre instâncias | Implementado |
| **Alto** | Sem rate limiting e controles distribuídos contra abuso | Não encontrado |
| **Alto** | Tenant e compartilhamento ainda não aprovados; risco de schema ou autorização ambígua | Decisão pendente |
| **Alto** | Cobertura negativa incompleta para autorização, portal e sessões | Comprovado pelo inventário; contexto informa um teste passou, sem cobrir todos os fluxos |
| **Alto** | Ausência de evidência versionada de deploy, backup/restore, monitoramento e gestão de segredos | Não encontrado no repositório inspecionado; infraestrutura externa não avaliada |
| **Médio** | Corridas check-then-act em agenda, unicidade e consumo de tokens | Estrutura do código permite a condição; impacto depende de concorrência |
| **Médio** | Validação desigual, relações sem integridade referencial e política de retenção indefinida | Implementado/pendente |
| **Médio** | Divergências e duplicações documentais podem levar a implementação divergente | Comprovado na documentação |
| **Baixo** | Erros de URI/path e diferença entre métodos estáticos podem gerar respostas inesperadas | Comportamento observado; impacto limitado no escopo auditado |

## 2. Estado atual verificado

### 2.1 Workspace e arquitetura

- A raiz declara pnpm `11.25.0`, Node `>=20`, scripts de desenvolvimento, início, teste e formatação, e Prettier como dependência de desenvolvimento (`package.json:5-17`).
- `pnpm-workspace.yaml:1-2` inclui `apps/*`. `apps/api/package.json:6-13` usa `node src/server.js`, `node --watch` e `node --test`; `apps/web/package.json` não declara framework ou scripts de build.
- A API é CommonJS, usa módulos nativos do Node e concentra rotas, estado, autorização, persistência e servidor estático em `apps/api/src/server.js`. A interface fica em `apps/web/public/` e a API a serve (`server.js:1-6, 8-14, 921-940`). As pastas API e web não representam deploy independente.
- No conteúdo inspecionado não há framework HTTP/web, ORM, driver PostgreSQL ou dependência de runtime declarada. Nenhum Dockerfile, pipeline CI, arquivo de infraestrutura ou deploy apareceu no inventário mencionado nos documentos; isso não prova que não exista infraestrutura fora deste repositório.

### 2.2 Autenticação e sessões

- Cadastro/login profissional e login do portal derivam senha por `scrypt` com salt aleatório; os trechos de criação de credencial estão em `server.js:315-325, 440-499`. Não há autenticação por provedor externo no código examinado.
- Sessões de profissional e paciente são mapas em memória (`server.js:13-14, 94-102`). Os cookies usam `HttpOnly`, `SameSite=Strict`, `Path=/`, `Max-Age=28800`; `Secure` é condicional a `NODE_ENV=production` (`104-108, 475-498`). `userFor()` e `patientAccountFor()` só resolvem o token no mapa, sem timestamp ou expiração server-side (`94-102`).
- Logout elimina o token recebido do mapa (`server.js:424-428, 501-505`). Reinício invalida as sessões; outra instância não conhece os mapas. Limites do cookie no navegador não substituem expiração backend. Não foi encontrado rate limiting para login, cadastro, convite ou reset.
- Convites e resets têm token aleatório de 32 bytes, persistem hash e verificam validade/uso/revogação (`server.js:110-111, 251-272, 372-423, 610-674`). A interface recebe link para compartilhamento manual; não há envio transacional por e-mail no servidor.

### 2.3 Autorização e isolamento atuais

- Depois dos endpoints públicos, a API exige usuário profissional antes das rotas de aplicação (`server.js:507-510`). `owned(list, id, userId)` compara os dois identificadores (`168-170`). Listagens de pacientes, avaliações e consultas filtram pelo `userId`; endpoints individuais também usam propriedade (`552-608, 676-719, 721-765, 767-801, 803-919`).
- Criações de avaliação, consulta, meta e plano confirmam que o paciente pertence ao profissional autenticado (`server.js:683-686, 721-724, 767-770, 832-835`). Não foi encontrada no inventário de handlers uma rota privada que autorize somente por UUID sem autenticação/propriedade.
- O teste existente exercita uma tentativa de GET cruzado de paciente e plano, além de outros fluxos, segundo `apps/api/test/application.test.js:141-160`; faltam negativos para PATCH, mutações relacionadas, listas, conta de paciente, sessões e todas as rotas.
- Paciente e profissional têm cookies/sessões distintos. `safePatientPortal()` procura a relação paciente/profissional, rejeita arquivados e projeta explicitamente nome e planos cuja versão está publicada (`server.js:99-102, 113-160, 430-438`). É uma proteção real do MVP, mas não substitui a futura policy tenant-aware.
- O código não tem `organization`, `tenant`, `membership`, papel de equipe ou vínculo independente com histórico/transferência. Pacientes e recursos são ligados diretamente ao `userId`/`professionalId` (`server.js:560-575, 697-719, 738-752, 773-787, 839-848`).

### 2.4 Persistência, integridade e erros

- `loadStore()` carrega o arquivo JSON integralmente e apenas normaliza coleções ausentes para arrays; JSON inválido aborta a inicialização (`server.js:22-56`). As coleções e relações são mantidas em arrays e referências por UUID, sem FK/unique/checks de banco.
- `persist()` encadeia gravações dentro do processo, escreve um arquivo temporário e renomeia (`server.js:34, 58-65`). Não há transação, lock interprocesso, backup/restauração ou rollback da mutação em memória. O arquivo inteiro é serializado. A fila é serializada por processo, mas não sincroniza instâncias e não torna as regras check-then-act atômicas.
- A leitura de arquivo falha em startup quando o arquivo existente não pode ser analisado. Uma falha da cadeia `writeQueue` também pode rejeitar gravações posteriores, pois cada nova gravação depende da promessa anterior resolvida.
- Há limite de corpo de 1 MB e resposta genérica em erros não tratados (`server.js:74-85, 942-950`). Validações variam: pacientes aceitam alguns campos como string truncada; peso/altura/gordura têm faixa, cintura/quadril não têm checagem de faixa; datas antropométricas usam regex sem validar calendário (`server.js:558-590, 683-715`).
- Verificação de conflito da agenda ocorre antes da inclusão em memória (`server.js:730-752`). Cadastro verifica e-mail duplicado, depois executa hash assíncrono e insere (`server.js:455-472`); duas requisições concorrentes podem passar pela verificação antes da inserção. Isso é inferência a partir do fluxo, não incidente observado.
- Erros HTTP inesperados registram método e `req.url` (`server.js:942-950`), que pode carregar query string. Não há evidência nesse handler de logging do corpo/senha, mas política de logs de proxy/host não foi inspecionada.

### 2.5 Testes

- O pacote tem um arquivo principal de integração em `apps/api/test/application.test.js`. Seu fluxo declarado inclui cadastro, paciente, avaliação/cálculo, criação/publicação/versionamento de plano, leitura cruzada de paciente/plano e conflito simples de agenda (`:19-176`).
- **Resultado fornecido nesta solicitação:** 1 executado, 1 aprovado, 0 falhas, execução local. É informação do solicitante; esta auditoria não repetiu a execução.
- **Resultado registrado nos documentos:** `docs/BASELINE_REPORT.md:14-25` registra falha de readiness em `fetch failed` (0 passou/1 falhou) e ressalta que nenhuma asserção funcional foi alcançada. `docs/TEST_EXECUTION_DIAGNOSIS.md:5-37` atribui a falha naquele ambiente a bloqueio de loopback (`EACCES`) e descreve a inicialização do servidor com diretório sintético. São resultados de um ambiente restrito; não invalidam por si o resultado local comunicado agora.
- Um teste aprovado demonstra somente as asserções percorridas naquele teste. Não demonstra cobertura total, uso seguro em produção, isolamento de todos os endpoints, segurança de infraestrutura ou conformidade legal.

## 3. Consistência documental, contradições e lacunas

Os dez documentos solicitados foram lidos. Também foram consultados os manifests e o código referenciados por eles. Documentos arquiteturais são tratados como propostas, exceto onde declaram explicitamente baseline observado.

### 3.1 Contradições ou afirmações que exigem reconciliação

1. **Acesso prévio a `data/store.json`:** `ARCHITECTURE_REVIEW.md:5`, `BASELINE_REPORT.md:3,38`, `TEST_EXECUTION_DIAGNOSIS.md:3,59` e `SAAS_ARCHITECTURE.md:4` afirmam que o conteúdo/valores não foram lidos; `SAAS_READINESS_AUDIT.md:31,329` diz que estrutura, contagens e nomes de propriedades foram consultados. Esses registros de escopo divergem. A presente auditoria não abriu o arquivo e não repete sua consulta; a declaração do documento novo descreve apenas este trabalho.
2. **Resultado da suíte:** o resultado local comunicado pelo solicitante é 1/1 aprovado; `BASELINE_REPORT.md:16-19` registra 0/1 em sandbox e `TEST_EXECUTION_DIAGNOSIS.md:24-35` explica que a tentativa falhou antes das asserções funcionais. Não é necessariamente contradição técnica: são contextos distintos. Falta registrar data/commit/runtime/comando do resultado local em um baseline reproduzível. Nenhum documento deve declarar o outro contexto como teste aprovado.
3. **Tenant/workspace individual versus decisão aberta (histórico reconciliado):** versões anteriores de `ARCHITECTURE_REVIEW.md` recomendaram workspace individual e documentos como `SAAS_ARCHITECTURE.md`, `DATABASE_DESIGN.md` e `SAAS_IMPLEMENTATION_ROADMAP.md` mantiveram tenant como pendente. A decisão posterior aprova que workspace possa representar consultório individual ou clínica; isso não define criação automática, onboarding, associação de contas atuais nem schema. Não tratar a recomendação antiga de provisionamento como decisão aprovada.
4. **Autoria de paciente:** `DATABASE_DESIGN.md:76-77` sugere `created_by_user_id` e comenta que a FK idealmente referencia membership; o resto do esquema usa `created_by_membership_id` (`91,99,107,114,122`). `ARCHITECTURE_REVIEW.md:30` já identifica a inconsistência. Padronizar antes da migration, após aprovar a semântica histórica de autoria.
5. **Migração reversível versus forward-fix:** `SAAS_IMPLEMENTATION_ROADMAP.md:11` pede “migration reversível ou estratégia forward-fix aprovada”, enquanto `MIGRATION_PLAN.md:83-87` corretamente alerta que, após escritas no destino, rollback cego para JSON perde atualizações e sugere forward-fix/reconciliação. Interpretar “reversível” como rollback de release/schema compatível, não como retorno automático dos dados a uma origem desatualizada; documentar gatilhos e autoridade por fase.
6. **Resultado funcional declarado:** a documentação de diagnóstico ambiental informa que a suíte não alcançou assertions naquele ambiente. Não se deve transformar esse evento em afirmação de falha funcional, nem o resultado 1/1 fornecido agora em afirmação de cobertura completa.

### 3.2 Recomendações duplicadas

Os mesmos controles aparecem, com pequenas diferenças, em `SAAS_READINESS_AUDIT.md`, `ARCHITECTURE_REVIEW.md`, `SAAS_ARCHITECTURE.md`, `SAAS_IMPLEMENTATION_ROADMAP.md`, `DATABASE_DESIGN.md`, `MIGRATION_PLAN.md`, `AUTHORIZATION_MATRIX.md` e `ROUTE_INVENTORY.md`:

- tenant derivado da sessão, autorização server-side e IDs não equivalentes a permissão;
- PostgreSQL, constraints compostas, transações e migrations;
- sessões compartilhadas com expiração/revogação, rate limits e e-mail;
- logs sem tokens/conteúdo clínico, backups restauráveis, TLS e secrets;
- importador idempotente, reconciliação, origem preservada, rollback explícito;
- testes negativos por rota, portal publicado, concorrência e ciclo de sessão.

A repetição é coerente em direção, mas cria risco de versões divergentes. Recomenda-se escolher um índice de documentação e declarar fonte normativa por tema (por exemplo, matriz de autorização como fonte das policies; desenho de banco como fonte do schema; plano de migração como fonte do cutover; roadmap como sequência e gates). Atualizações futuras devem apontar para esses documentos em vez de copiar o mesmo checklist integralmente.

### 3.3 Lacunas entre roadmap e requisitos de segurança

- O roadmap lista controles de segurança em backlog transversal (`SAAS_IMPLEMENTATION_ROADMAP.md:113-126`), mas não todos têm fase/dono/critério independente. A arquitetura sugere CSRF/Origin, comparação segura de hash, limite de custo de hash e logging sem query (`SAAS_ARCHITECTURE.md:79-83`); nem todos aparecem como aceite individual da fase correspondente.
- A fase 4 requer teste multi-instância e isolamento, mas segurança por rota/papel deve estar definida antes de finalizar schema (`SAAS_IMPLEMENTATION_ROADMAP.md:58-67`). O modelo e as decisões de tenant bloqueiam a semântica do teste.
- “Backup/restore técnico validado” aparece na aceitação da fase de banco e “restore cronometrado/RPO/RTO” na fase de operação. A distinção deve ser explícita: verificação técnica preliminar antes de dados importados; ensaio operacional com metas aprovadas antes do piloto.
- CI, review gates de dependências/runtime, alertas e responsáveis operacionais aparecem como requisitos, mas o repositório não mostra pipeline atual. Devem ser gates executáveis e atribuídos, e não apenas checklist documental.
- Política de retenção, exclusão e backups condiciona tabelas, auditoria, logs e importação. A roadmap reconhece dependência de decisão humana; implementação desses módulos não deve começar assumindo política padrão.
- Escopo de portal tem duas formulações: arquitetura recomenda somente publicação autorizada (`SAAS_ARCHITECTURE.md:68`), enquanto a decisão de se portal entra no piloto permanece aberta (`ARCHITECTURE_REVIEW.md:74`). Tratar a inclusão e o conjunto de campos como gates de produto.
- O plano de banco recomenda FKs tenant-aware, mas a regra fina de vínculo paciente-membership e estados ativos ainda é variável (`DATABASE_DESIGN.md:81-86`). Sem essa regra, FK de tenant não garante o grau correto de acesso por profissional dentro da organização.

## 4. Riscos técnicos e de segurança priorizados

Probabilidade é uma estimativa qualitativa para exposição no cenário futuro de SaaS; não significa que o evento tenha ocorrido. **Crítico** significa que impede o uso com dados reais. **Alto** requer tratamento antes do piloto. **Médio** precisa de mitigação planejada antes de exposição pública/expansão. **Baixo** tem impacto limitado no escopo observado.

### Tabela de riscos

| ID | Nível | Risco | Evidência / estado | Probabilidade e impacto |
| --- | --- | --- | --- | --- |
| K1 | **Crítico** | Store JSON não fornece integridade transacional, escala multi-instância, backup nem recuperação comprovada | Código: `server.js:22-65`; documentos: `DATABASE_DESIGN.md`, `MIGRATION_PLAN.md` | Alta em operação distribuída; perda/corrupção ou exposição de dados clínicos |
| K2 | **Alto** | Sessões sem expiração backend e sem compartilhamento/revogação central | Código: `server.js:13-14,94-108,473-505`; matriz `AUTHORIZATION_MATRIX.md:14-16` | Média-alta; token obtido pode seguir aceito até remoção/restart |
| K3 | **Alto** | Ausência de rate limiting para autenticação e endpoints públicos de tokens | Código: `server.js:251-423,440-499`; matriz e revisão arquitetural | Alta quando endpoints públicos; brute force, consumo de CPU e indisponibilidade |
| K4 | **Alto** | Tenant, membership e regra de compartilhamento ainda não aprovados | `SAAS_ARCHITECTURE.md:50-71`; `DATABASE_DESIGN.md:37,81-86,195-203`; revisão `:69-84` | Média; definição prematura pode expor registros a membros incorretos |
| K5 | **Alto** | Testes negativos não cobrem todas as rotas/principais/IDs alterados | `application.test.js:19-176`; `ROUTE_INVENTORY.md:14-46`; `AUTHORIZATION_MATRIX.md:5-17` | Alta chance de falha escapar em alteração; impacto de acesso cruzado alto |
| K6 | **Alto** | Não há evidência no repositório de deploy seguro, TLS real, secrets, backup/restore, monitoramento e resposta | `package.json`, `.env.example`, `server.js`; `BASELINE_REPORT.md:27-38`; arquitetura/roadmap | Probabilidade operacional não determinada; impacto alto para confidencialidade e recuperação |
| K7 | **Médio** | Corridas check-then-act e gravação em memória | Código: cadastro `server.js:455-472`; agenda `:730-752`; fila `:58-65`; tokens `:315-344,610-674` | Média com simultaneidade; duplicidade, conflito ou consumo inconsistente |
| K8 | **Médio** | Relações sem FKs e validação desigual | Código: arrays e `loadStore` `server.js:22-56`; exemplos `:558-590,683-715`; schema proposto | Média; órfãos, valores inválidos e migração ambígua |
| K9 | **Médio** | Dados pessoais podem aparecer em logs por URL completa ou logs externos não avaliados | `server.js:942-950`; arquitetura `SAAS_ARCHITECTURE.md:81-87` | Baixa-média; depende de parâmetros e plataforma, retenção amplia exposição |
| K10 | **Médio** | Política de retenção/exclusão/transferência/portal ainda não decidida | `DATABASE_DESIGN.md:195-203`; roadmap fase 0; revisão `:73-80` | Média; risco de retenção excessiva, expurgo indevido ou divulgação não pretendida |
| K11 | **Médio** | Fontes de documentação duplicadas e divergentes podem ser tratadas como especificações aprovadas | Seção 3 deste relatório; especialmente `ARCHITECTURE_REVIEW.md`, `SAAS_ARCHITECTURE.md`, `DATABASE_DESIGN.md` | Média; retrabalho ou implementação de acesso/tenant com regra não aprovada |
| K12 | **Baixo** | Rotas estáticas não limitam método explicitamente; URI malformada pode chegar ao catch global | `server.js:921-950`; inventário `ROUTE_INVENTORY.md:47-50` | Baixa; respostas/logs inconsistentes, sem bypass confirmado |

### Explicação e mitigação por risco

**K1 — Persistência (crítico).** O arquivo inteiro é carregado e gravado, e a fila serializa somente dentro do processo. Não há constraints, transações nem recuperação demostrada. Para o SaaS proposto, usar PostgreSQL com transações, FKs/unique/checks tenant-aware, backups criptografados e restore exercitado. Não importar dados até autorização da origem e aceite de reconciliação.

**K2 — Sessões (alto).** `Max-Age` vive no cookie, mas a busca no `Map` não verifica validade. Token revogado não é compartilhado entre processos. Implementar sessão opaca persistida (guardar hash), prazo absoluto/ocioso aplicado no servidor, rotação e revogação individual/global. Testar restart, múltiplas instâncias e cookies em HTTPS.

**K3 — Abuso (alto).** Não há limite no código observado. Aplicar limitação distribuída por conta/IP/operação, incluindo login, cadastro, convite e reset; monitorar sem guardar tokens/corpos clínicos. Definir comportamento para usuários legítimos bloqueados e testes de concorrência.

**K4 — Tenant (alto).** `userId` atual não resolve clínica, membership ou compartilhamento. Não decidir por inferência a organização individual proposta. Aprovar se paciente é privado por profissional, compartilhado no tenant ou acessível por vínculo explícito; somente então fechar schema/policies. Exigir tenant e vínculo em consultas server-side e constraints compostas.

**K5 — Autorização/testes (alto).** O teste atual cobre um par de acessos cruzados, não cada operação. Completar matriz de positivos e negativos, com dois tenants sintéticos, dois profissionais e contas de paciente. Cobrir GET/PATCH/POST/PUT, IDs de outra pessoa e inconsistências de relação; exigir zero falha de isolamento como gate.

**K6 — Operação (alto).** Ausência de arquivos no repo não prova que infra não existe, mas impede revisão verificável. Criar pipeline e documentação operacional conforme provedor escolhido; confirmar configuração efetiva de HTTPS/cookies, gestão de secrets, retenção de logs, restore, alertas e autoridade de incidente.

**K7 — Concorrência (médio).** Requisições simultâneas podem passar por verificações antes de ambas atualizarem o estado. No banco, transacionar consumo de token/conta, unicidade de e-mail, publicação/ponteiro e reserva de agenda; adicionar constraints ou exclusão temporal apropriada. Testar requests paralelos.

**K8 — Integridade/validação (médio).** JSON permite relações órfãs e `loadStore` não valida schema. Criar validação por operação e constraints relacionais. Na migração, isolar exceções com identificadores técnicos não sensíveis e interromper cutover se integridade/autorização for afetada.

**K9 — Logs (médio).** O catch registra `req.url`; a query pode conter identificador/dado que não deveria persistir. Sanitizar rota e query, definir allowlist, revisar logs de proxy/host, limitar retenção/acesso e testar ausência de segredos.

**K10 — Ciclo de vida (médio).** As decisões de retenção, exclusão, transferência, tokens e histórico do portal afetam schema, backup e suporte. Obter política por categoria com revisão competente antes de dados reais; não introduzir cascade/exclusão automática por conveniência técnica.

**K11 — Governação documental (médio).** Várias fontes repetem o mesmo checklist e algumas têm diferenças de status/escopo. Definir documento normativo por assunto, registro de decisão (ADR), dono e data de revisão; diferenciar claramente fato, proposta e aceite.

**K12 — HTTP estático (baixo).** Servir arquivo para métodos não-GET pode ser evitável; uma URI inválida pode resultar em erro genérico. Fix futuro deve responder método não permitido/400 e preservar a verificação de caminho. Não foi confirmado acesso a arquivos fora de `PUBLIC_DIR`.

## 5. Decisões que dependem de aprovação

As opções abaixo são alternativas abertas, não escolhas feitas por esta auditoria. Recomendações técnicas que aparecem nos documentos continuam propostas até aprovação explícita.

| Decisão | Pergunta a aprovar | Dependência / consequência de adiar |
| --- | --- | --- |
| Modelo inicial de tenant | Tenant é profissional individual, organização de uma pessoa, consultório desde o início, ou modelo misto? | Bloqueia schema, autorização, onboarding e cobrança por tenant; baseline sintético pode prosseguir |
| Propriedade de paciente | Um cadastro é propriedade do tenant ou do profissional que o criou? Pode haver várias relações ativas? | Bloqueia predicados de autorização e FKs; `created_by_user_id` vs `created_by_membership_id` precisa de padrão |
| Compartilhamento e papéis | Membros de uma clínica veem todos os pacientes, somente os vinculados ou permissões concedidas por caso? | Bloqueia política deny-by-default e matriz por rota. Não habilitar acesso amplo por pertencer à mesma organização sem aprovação |
| Profissional, clínica e paciente | Como convidar membro, encerrar membership, transferir paciente e preservar histórico/atribuição? | Bloqueia modelo de relationship e migração; não unir/transferir por e-mail |
| Identidade do paciente | Uma conta portal é global e pode estar ligada a vários profissionais/organizações, ou cada relação tem credencial própria? Como tratar e-mail compartilhado? | Bloqueia unicidade de e-mail, paciente multi-tenant, login e recuperação; não fazer merge automático |
| Portal do paciente | Entra no piloto? Quais campos e versões publicados ficam visíveis, por quanto tempo e como revogar? | Bloqueia desenho de DTO, account/relationship, convites e testes de privacidade |
| Retenção e exclusão | Regras para pacientes, avaliações, planos publicados/rascunhos, contas, convites, auditoria, logs e backups; como atender exportação/correção/encerramento? | Bloqueia schema, deletes, cascades e suporte; exige revisão competente |
| Estratégia de migração | Migrar todos os registros, nenhum ou um subconjunto? Qual ambiente e janela? | Antes de acessar/importar valores, pessoa autorizada deve confirmar origem, legitimidade e finalidade |
| Idempotência e conflitos de importação | Qual manifesto/ledger durável identifica execução e versão? Como impedir que repetição sobrescreva gravação posterior? | Bloqueia ferramenta executável; checklist atual não especifica formato completo do ledger nem política para execução parcial |
| Credenciais/tokens legados | Preservar hash/salt após validar compatibilidade, exigir novo login, invalidar convites/reset ativos ou reemitir? | Bloqueia cutover; sessão de `Map` não é migrável |
| Compatibilidade de fluxos | Quais respostas HTTP, estados, cálculo, datas/timezone, conflito de agenda e versionamento são contratos que devem permanecer? Quais comportamentos inseguros podem mudar? | Baseline aprovado precisa anteceder refatoração; não perpetuar comportamento inseguro por acidente |
| Agenda | Fuso de exibição, intervalo de borda e quais estados bloqueiam conflito; conflito por profissional ou consultório? | Bloqueia constraint/índice e estratégia de concorrência |
| PostgreSQL e migrations | Driver SQL ou ORM; provedor, pooling e migration ledger? | ADR técnico antes da fase de persistência; não instalar dependências nesta auditoria |
| Operação | Região, hospedagem, TLS, responsáveis, RPO/RTO, janela de manutenção e critérios de rollback/suspensão? | Bloqueia importação e piloto real; não usar downgrade cego depois de escrita no destino |
| Autenticação | MFA para profissionais, verificação/recuperação por e-mail, suporte privilegiado e encerramento global? | Bloqueia piloto real e sessão final; fricção e ameaça devem ser avaliadas pelo produto |
| Escopo comercial | Piloto técnico fechado será gratuito? Billing é necessário para a primeira oferta paga? | Roadmap posiciona billing depois do piloto; cobrança pode ser gate de venda paga, não necessariamente de piloto técnico |

## 6. Plano incremental de implementação e critérios de conclusão

As fases abaixo sintetizam documentos de arquitetura e roadmap, preservando decisões abertas. “Concluída” requer evidência verificável; não significa que recomendação já tenha sido implementada.

| Fase | Trabalho e dependências | Critérios objetivos para concluir |
| --- | --- | --- |
| **0 — Aprovações de domínio e produto** | Aprovar tenant, acesso a pacientes, relacionamento/transferência, portal, retenção, escopo do piloto e compatibilidade de fluxos. Decisões de provedor e preço podem ser posteriores se não houver billing no piloto. | ADRs aprovados por responsáveis; matriz recurso × ação × principal sem lacunas; regras de paciente/tenant e portal não ambíguas; decisões pendentes nomeadas com owner |
| **1 — Baseline e threat model** | Congelar inventário de rotas e comportamento atual em ambiente sintético; distinguir resultado da suíte local e bloqueio de sandbox; estabelecer modelo de ameaça e gaps por rota. Pode começar sem decisão final de tenant, desde que não imponha semântica futura. | Inventário 100% dos handlers; execução de teste registrada com comando, commit/runtime, ambiente e resultado real; casos não alcançados marcados como não verificados; fixtures somente sintéticas; threat model cobre dados clínicos, portal, sessões, operadores e abuso |
| **2 — Testes de regressão e fronteiras de domínio** | Criar testes unitários para regras puras e integração de API; extrair gradualmente validação/autorização conforme roadmap. Depende do baseline; decisões de papéis definem testes finais de policy. | Testes caracterizam os fluxos aprovados; mudanças comportamentais têm justificativa; negativa por ID cruzado e portal coberta; execução repetível em CI; sem leitura do store local |
| **3 — Modularização/API e autorização** | Separar handler, caso de uso, policy e persistência sem reescrever stack. Centralizar resolução de principal/tenant e fazer deny-by-default conforme decisões. | Handlers não consultam arrays diretamente; cada operação usa policy e repositório; contratos HTTP aprovados preservados ou mudança documentada; testes positivos/negativos por rota e papel passam |
| **4 — Identidade e controles de abuso** | Sessões duráveis com hash e expiração/revogação server-side, limites distribuídos, recuperação aprovada, CSRF/Origin/CORS e logs sanitizados. Pode paralelizar com modularização; multi-instância requer mecanismo compartilhado. | Expiração é aplicada no backend; revogação funciona entre instâncias; rate limit é testado sob concorrência; fluxos de recuperação e tokens são atômicos; logs de teste não contêm credenciais, tokens nem query sensível |
| **5 — PostgreSQL/schema** | Após decisões de fase 0 e fronteiras da fase 3, escolher driver/ORM em ADR; schema/migrations tenant-aware, constraints, transações e pool; manter dados de teste sintéticos. | Migração de schema do zero e upgrade passam em DB efêmero; FK/unique/checks bloqueiam referências cruzadas e inválidas; transações críticas provadas; teste multi-instância; restore técnico testado; sem downgrade destrutivo automático |
| **6 — Importação e cutover** | Só após autorização de origem, estratégia aprovada e fase 5. Importador separado da inicialização normal, dry-run por padrão, backup/restauração e janela definidos. | Segunda execução não duplica nem sobrescreve mudanças posteriores; todas as FKs resolvidas ou exceções aprovadas; contagens/IDs/estados/versionamento conciliados por tenant; `publishedVersionId` preservado; logs sem PII; rollback praticado conforme gatilhos |
| **7 — Operação e privacidade** | Ambientes separados, TLS/segredos, CI/CD, backup criptografado, restore cronometrado, alertas, runbooks, resposta a incidente, retenção e revisão competente. | RPO/RTO aprovados e atingidos em restore; rotação de secrets, indisponibilidade de DB/e-mail, deploy/rollback e alerta de backup exercitados; responsáveis definidos; configuração efetiva revisada; processos de titular e privacidade aprovados por responsáveis competentes |
| **8 — Piloto fechado** | Liberar a profissionais e pacientes previamente aprovados, população/funções mínimas, observabilidade e plano de suspensão. Sem onboarding aberto. | Todos os gates de dados reais abaixo estão fechados; nenhum risco de isolamento crítico/alto aberto; canal de suporte/incidente ativo; critérios de saída e data de revisão aprovados |
| **9 — Cobrança e expansão** | Só se primeira oferta paga exigir: billing isolado, webhooks idempotentes, estados de cancelamento/inadimplência e suporte. Equipes/compartilhamento em fase própria. | Reconciliação financeira testada; eventos duplicados/fora de ordem/falsos cobertos; dados clínicos não são apagados por inadimplência; políticas aprovadas; novo papel/compartilhamento passa matriz própria |

**Regra de rollback:** antes de escritas no PostgreSQL, origem preservada pode ser reaberta segundo plano aprovado. Depois de novas escritas, não retornar cegamente ao JSON antigo; preferir forward-fix, reverter apenas release compatível ou reconciliar delta com ferramenta auditada. Cada fase deve identificar se a migration é reversível, compatível ou exige forward-fix, além da pessoa autorizada a decidir.

## 7. Plano incremental de testes

### 7.1 O que existe e o que foi reportado

- **Existe:** um teste de integração principal (`apps/api/test/application.test.js:19-176`) que percorre cadastro, avaliação/cálculo, criação e publicação/versionamento de plano, GET cruzado de paciente/plano e conflito simples de agenda.
- **Resultado local informado:** 1 teste, 1 aprovado, 0 falhas, segundo o contexto do solicitante. Não foi reproduzido neste trabalho.
- **Resultado do sandbox documentado:** 0 aprovados/1 falhou em readiness por loopback, segundo `BASELINE_REPORT.md:14-19` e `TEST_EXECUTION_DIAGNOSIS.md:22-37`; as asserções de negócio não foram alcançadas naquele ambiente.
- **Não existe evidência** de cobertura de todos os endpoints, cobertura percentual, testes unitários, CI, testes de migração ou de produção. Nenhuma porcentagem deve ser inventada.

### 7.2 Testes propostos por camada

| Camada | Testes incrementais | Critério de aceite |
| --- | --- | --- |
| Unitário de domínio | Validação de unidade/data/limites, antropometria e fórmulas documentadas, regra de agenda e fronteiras temporais, metas, imutabilidade/versionamento de plano | Casos de borda definidos por domínio; saída determinística; sem acesso a rede/arquivo real |
| Integração HTTP | Rotas públicas/privadas, códigos e DTOs, erros JSON/corpo grande, cookies, cadastro/login/logout, convites/reset | Todas as rotas inventariadas têm ao menos um caminho válido e erros pertinentes; ambiente temporário sintético isolado |
| Autorização positiva/negativa | Duas profissionais e dois pacientes artificiais; GET/PATCH/POST/PUT com IDs próprios, alheios e inexistentes; recursos com paciente incompatível | Para cada rota/método/principal, acesso permitido somente conforme policy; recurso alheio não revela existência/conteúdo |
| Isolamento multi-tenant | Dois tenants, múltiplos memberships conforme modelo aprovado, consultas/alterações/agregações e tenant adulterado em body/query | Nenhuma leitura, escrita, contagem, relação ou portal cruza tenant; testar também consultas agregadas e reuso de pool |
| Portal do paciente | Conta paciente isolada, convite/reset expirado/revogado/reusado, validação de vínculo, publicado vs draft, revogação, campos allowlist e arquivamento | Paciente vê somente conteúdo aprovado e seu vínculo; rascunhos/notas internas sempre ausentes; token consumido uma vez atomicamente |
| Sessões e abuso | Token desconhecido, logout/reuso, expiração backend, revogação global, reset, reinício, duas instâncias, rate limits sob concorrência, CSRF/Origin | Sessão expira/revoga no servidor e entre instâncias; limites previsíveis; origem não aprovada não realiza mutação |
| Segurança de renderização/log | HTML malicioso fabricado em campos renderizados, CSP, URL/query, erros e traces; ausência de senha/token/cookie/PII desnecessária | Sem execução de conteúdo injetado; logs de teste sanitizados; não capturar payload clínico |
| Persistência/concorrência | Transações interrompidas, falha DB, FKs/uniques, duas reservas simultâneas, cadastro duplicado, consumo simultâneo de token, publicação simultânea | Estado invariável ou erro explícito; sem duplicidade, órfão ou consumo duplo; transação e auditoria consistentes |
| Regressão | Caracterizar fluxo atual aprovado de pacientes, medidas, consultas, metas, plano publicado e portal, antes e após módulos/repos | Comportamento aprovado permanece idêntico ou alteração explícita; snapshots publicados preservados |
| Migração | Migrations do zero/upgrade, fixtures com órfãos, IDs duplicados, datas inválidas, email colidente, versões publicadas, idempotência e reconciliação | Nenhuma perda silenciosa; repetição sem duplicação/overwrite; divergências têm relatório seguro e decisão registrada |
| Operação | Backup/restore cronometrado, rotação de segredo, deploy e rollback, falha DB/e-mail, alertas, health/readiness | RPO/RTO aprovados cumpridos, alertas chegam ao responsável, runbook executável e ambiente isolado |

### 7.3 Regras para evidência de execução

1. Registrar comando, commit, versão Node/pnpm, sistema/ambiente, quantidade de testes, passes/falhas/skips e logs sanitizados.
2. Separar claramente “teste não iniciado”, “teste iniciou mas não alcançou asserções” e “asserções funcionais executadas”.
3. Não contornar falha de ambiente alterando testes para pular conexão necessária. Se loopback for bloqueado, executar a suíte em ambiente autorizado e conservar `DATA_DIR` temporário sintético.
4. Nenhum teste aponta para `data/store.json`; fixtures são fabricadas, não cópias mascaradas sem processo aprovado.
5. Para testes de autorização, confirmar não só o status HTTP mas a ausência de dados em resposta, agregados, logs e efeitos colaterais.

## 8. Critérios globais para etapa/piloto

Uma etapa só é concluída quando seu critério específico da seção 6 está demonstrado e não depende de uma decisão ainda pendente. Para piloto com dados reais, cumulativamente:

1. Tenant, propriedade/compartilhamento, paciente, transferência e papéis foram aprovados e traduzidos em matriz completa de autorização.
2. Todas as rotas e métodos têm testes positivos e negativos; testes com IDs adulterados e contas de pacientes de outro tenant não acessam dados.
3. PostgreSQL e migrations tenant-aware são a única fonte de verdade; constraints e transações impedem relações cruzadas, duplicidade e consumo duplo.
4. Sessões têm validade/revogação server-side, e autenticação, convite e reset possuem rate limiting e trilha de evento sem segredo.
5. Portal está aprovado no escopo e expõe só campos/versionamentos autorizados, testados por allowlist.
6. Origem dos dados foi autorizada; importador foi ensaiado em dados sintéticos, preserva IDs/relacionamentos/versionamento e reconcilia exceções. Backup original e rollback foram aprovados.
7. TLS, secrets, ambientes, logs, backups/restores, monitoramento, RPO/RTO, resposta a incidente e responsáveis foram verificados na infraestrutura real.
8. CI reproduz os testes do release e o resultado da suíte está registrado no ambiente relevante; nenhuma falha de isolamento ou corrupção ficou aberta.
9. Retenção, exportação, correção, exclusão, encerramento e suporte foram decididos com revisão competente; não há afirmação de LGPD baseada apenas no código.
10. Piloto é fechado e suspensível, com usuários/funções/população limitados e critérios de saída aprovados. Cobrança e expansão só avançam quando regras comerciais e controles adicionais estiverem aceitos.

## 9. Referências analisadas

### Documentos solicitados

- `docs/ARCHITECTURE_REVIEW.md`
- `docs/AUTHORIZATION_MATRIX.md`
- `docs/BASELINE_REPORT.md`
- `docs/DATABASE_DESIGN.md`
- `docs/MIGRATION_PLAN.md`
- `docs/ROUTE_INVENTORY.md`
- `docs/SAAS_ARCHITECTURE.md`
- `docs/SAAS_IMPLEMENTATION_ROADMAP.md`
- `docs/SAAS_READINESS_AUDIT.md`
- `docs/TEST_EXECUTION_DIAGNOSIS.md`

### Código/configuração e documentos de contexto

- `apps/api/src/server.js` — persistência e início (`:8-65`); sessão/cookies (`:94-111`); DTO do portal (`:113-160`); autenticação/rotas (`:243-919`); estáticos e erros (`:921-959`).
- `apps/api/test/application.test.js:19-176` — teste de integração existente.
- `package.json:5-17`, `pnpm-workspace.yaml:1-2`, `apps/api/package.json:6-13`, `apps/web/package.json` — workspace e scripts.
- `.env.example`, `.gitignore`, `README.md` — configuração documentada, exclusões e limitações.
- `docs/architecture/current-state.md`, `docs/architecture/target.md`, `docs/development/migration-plan.md`, `docs/development/patient-portal.md`, `docs/development/meal-plans.md`, `docs/decisions/0001-incremental-monorepo.md` — decisões e contexto anterior.

### Limitações da auditoria

Esta é uma revisão de documentos e inspeção estática, não um pentest, execução de suíte, revisão de infraestrutura hospedada, auditoria de dependências ou parecer jurídico. Nenhuma afirmação de acesso cruzado explorado, perda ocorrida ou conformidade foi feita. Infraestrutura que não esteja no repositório permanece desconhecida. A origem e legitimidade do conteúdo do store continuam não verificadas.

## 10. Alterações e confirmação de escopo

Foi criado somente `docs/INTEGRATED_AUDIT.md`. Nenhum código de produção ou teste existente foi modificado; nenhum teste ou migração foi executado; nenhuma dependência foi instalada. **Nesta auditoria, `data/store.json` não foi aberto, lido ou consultado, e nenhum dado pessoal foi modificado ou reproduzido.** A divergência documental sobre consultas em auditorias anteriores está explicitada na seção 3.1; este relatório não afirma que os documentos anteriores tenham sido incorretos, apenas registra que seus relatos de escopo diferem.

## 11. Addendum normativo — decisões posteriores e proposta consolidada

Este relatório foi redigido antes das decisões de produto mais recentes. Para qualquer trabalho futuro, prevalecem as decisões explicitadas em `PRODUCT_REQUIREMENTS_BASELINE.md` e detalhadas em [CONSOLIDATED_ARCHITECTURE_PROPOSAL.md](CONSOLIDATED_ARCHITECTURE_PROPOSAL.md): workspace pode representar consultório individual ou clínica; pode haver vários proprietários; identidade profissional participa de vários workspaces; propriedade administrativa, administração operacional e responsabilidade clínica são distintas; cargos/permissões granulares e escopos são requisitos; paciente pode ter principal e apoio; remoção revoga somente o workspace e não transfere registros automaticamente; a fundação será multi-tenant progressiva; cobrança não é requisito do MVP.

Assim, as frases históricas nas seções anteriores que tratam esses pontos como aprovação pendente não são pendências atuais. Permanecem abertas somente as definições de produto mais específicas da seção 3 da proposta consolidada, informações operacionais, critérios de implantação e opções técnicas. A decisão sobre tipos de workspace não implica provisionamento automático nem determina o mapeamento de contas existentes.

A proposta consolidada é a fonte de leitura recomendada para matriz requisito-evidência-aceite, modelo conceitual, exemplos de autorização, estratégia de migração e fases. Este addendum não altera fatos observados anteriormente nem declara sua implementação. Nenhum teste foi executado e nenhum dado persistente foi consultado durante a consolidação.
