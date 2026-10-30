# Decisões necessárias — arquitetura multi-tenant

As recomendações técnicas abaixo não são decisões aprovadas. As escolhas de produto pertencem ao usuário/responsáveis do produto. Não se deve fechar schema ou importar dados enquanto as questões bloqueadoras de domínio e autorização estiverem abertas.

## Requisitos decididos — não reabrir como pendências

As decisões abaixo já foram estabelecidas no baseline de produto e na instrução mais recente: workspace pode representar consultório individual ou clínica; um workspace pode ter múltiplos proprietários; uma identidade profissional participa de vários workspaces; propriedade, operação e responsabilidade clínica são distintas; haverá cargos editáveis/customizados, permissões granulares e exceções; autorização considera workspace, equipe, paciente, papel e ação; cadastro não concede prontuário; paciente pode ter principal e profissionais de apoio; saída revoga somente o workspace e não transfere automaticamente registros; arquitetura multi-tenant é fundacional e progressiva; cobrança não é requisito do MVP. As questões a seguir refinam a configuração desses requisitos, sem invalidá-los.

## 1. Decisões de produto que dependem de aprovação do usuário

| Pergunta | Alternativas razoáveis | Consequências |
|---|---|---|
| Qual evento cria/provisiona um workspace individual e como uma pessoa entra em um workspace clínico? | Provisionamento automático; criação explícita; convite para clínica; associação após onboarding. | Afeta onboarding e mapeamento de contas atuais. Não está em questão se workspace pode ser individual ou clínica; isso já está decidido. |
| Paciente é identidade global, cadastro local por workspace ou identidade global com prontuários locais? | Cadastros independentes; identidade global e relações explícitas; modelo híbrido com associação manual. | Afeta duplicidade, portal, privacidade e risco de unir históricos. A missão exige que a identidade compartilhada não compartilhe registros automaticamente. |
| Paciente poderá acessar vários portais/organizações com uma identidade? | Conta global com memberships de paciente; conta por organização; seleção por vínculo explícito. | Define credenciais e experiência; qualquer associação precisa preservar isolamento clínico. |
| Quais cargos entram no MVP e quais capacidades possuem? | Selecionar cargos exemplo da missão; começar com conjunto menor; cargos modelo editáveis. | Afeta migração, interface e segregação administrativa/clínica. Os nomes listados na missão são exemplos, não decisões finais. |
| Quem pode criar/alterar cargos, exceções e memberships? | Proprietários; delegados com capacidades específicas; administradores designados; aprovação adicional para atos críticos. | Afeta governança e risco de escalada de privilégios. |
| Como configurar equipes e atribuir etapas/responsabilidades entre o principal e os profissionais de apoio? | Equipes fixas; atribuição por paciente; atribuição por etapa; composição configurável por clínica. | Define visibilidade e operação. Principal e apoio são requisitos; configuração padrão e etapas não estão fixadas. |
| Qual procedimento explícito será usado para redistribuir pacientes/tarefas após saída? | Reatribuição manual pelo workspace; aceite de outro profissional; manter sem novo responsável até decisão administrativa. | Define continuidade e responsabilidade. Transferência automática ao consultório pessoal não é alternativa permitida. |
| Qual é o SLA e a semântica de revogação para operações já iniciadas? | Invalidar sessões e negar requests seguintes; cancelar operações ainda não confirmadas; permitir terminar apenas operações já autorizadas até ponto definido. | Define garantias de sessão/cache e janela de concorrência. A revogação do workspace é aprovada; o prazo e o tratamento de operações em andamento não. |
| Como mapear profissionais e pacientes atuais para tenants? | Workspace por conta; mapeamento revisado por responsável; manter casos ambíguos sem importar até decisão. | Define ownership e acesso ao histórico. Não se pode inferir associação por nome/e-mail. |
| Qual política de retenção, arquivamento, exportação e exclusão? | Política por categoria; política organizacional dentro de limites comuns; encerramento/exportação controlados. | Afeta prontuários, backups e saída de organizações. Requer validação pelos responsáveis apropriados. |
| Quais eventos de acesso e mudança precisam ser auditados e por quanto tempo? | Registrar alterações de membership/papel; leituras clínicas; alterações clínicas; exportações; combinação com retenção definida. | Afeta investigação, privacidade e acesso a metadados. |
| Quais limites e recursos comerciais ficam associados a plano individual ou de clínica? | Limite por profissional; por organização; entitlements por recurso; estratégia inicial manual. | Afeta comercialização, mas não deve conceder permissão clínica. A cobrança está fora desta auditoria. |

## 2. Decisões técnicas que podem ser recomendadas com base nas evidências

Estas são recomendações técnicas revisáveis, não decisões de produto nem tecnologia já aprovada.

| Tema | Evidência disponível | Recomendação técnica | Alternativas a avaliar |
|---|---|---|---|
| Persistência | `apps/api/src/server.js`: `loadStore()` carrega JSON integral; `persist()` serializa arquivo local. Sem schema relacional/transactions multi-instância. | Adotar persistência transacional com constraints tenant-aware antes de clínicas multiusuárias e importação. | Banco relacional; avaliar transações, FKs compostas, concorrência, backup/restore e operação. PostgreSQL é candidato, não escolha aprovada. |
| Isolamento no backend | `userFor()`, `owned()` e rotas clínicas usam um `userId`; não há workspace/membership. | Exigir contexto ativo e validar membership e policy em toda leitura e escrita; IDs não autorizam acesso. | Guard/middleware central, policy por caso de uso ou combinação; enforcement no banco (p.ex. RLS) pode complementar, não substituir policy. |
| Identidade, membership e dados clínicos | Modelo atual acopla paciente a `userId`; não há organização ou equipe. | Separar identidade global, membership por workspace e registros clínicos por tenant; associações de pacientes explícitas. | Diferentes esquemas relacionais são possíveis após decidir cardinalidades de produto. |
| Papéis e permissões | Sem RBAC/ABAC observável; requisitos pedem escopo e exceções. | Modelar capacidades granulares e escopos organizacional/equipe/paciente, com negação padrão e distinção administrativa/clínica. | RBAC puro, ABAC ou híbrido; testar manutenção de cargos personalizados e exceções antes da escolha. |
| Sessões/revogação | `sessions`/`patientSessions` são `Map`; `userFor()` não verifica idade; logout apaga token local. | Sessão com expiração server-side e verificação de membership em operação protegida; política explícita para cache e requisição em andamento. | Sessão compartilhada persistente ou tokens versionados/revogáveis, avaliados contra SLA aprovado. |
| Migração | Dados atuais em JSON, schema e integridade não declarados; conteúdo não foi consultado. | Importador separado, dry-run, idempotência, reconciliação de relações e backup/restore testado. | Cutover com congelamento de escrita tende a simplificar consistência; outra estratégia exige protocolo de concorrência comprovado. |
| Testes | Um teste de integração em `apps/api/test/application.test.js`; cobertura negativa pontual de GET cruzado de paciente/plano. | Matriz automatizada por rota × ação × papel × tenant/equipe/paciente, incluindo revogação, concorrência e migração. | Testes unitários de policy e integração HTTP podem coexistir; E2E não substitui testes de isolamento no backend. |
| Stack e ORM | Node HTTP nativo, CommonJS, sem dependências runtime declaradas na API; não há evidência que obrigue framework específico. | Manter mudanças de framework separadas da migração de domínio/persistência; escolher após protótipo e critérios de manutenção/segurança. | SQL explícito, query builder ou ORM; NestJS/Next.js/Expo não são requisitos aprovados. |

## 3. Questões que não podem ser resolvidas sem informações adicionais

- Quantidade, qualidade, origem, legitimidade, completude e consistência dos dados locais. O arquivo `data/store.json` não foi aberto; nenhum total ou dado individual é conhecido nesta auditoria.
- Requisitos legais/contratuais específicos, residência geográfica, base de tratamento, prazos de retenção e autoridade para aprovar importação/expurgo. Exigem informações e responsáveis externos ao código.
- RPO/RTO, disponibilidade, janela de manutenção, orçamento, infraestrutura e competências operacionais para selecionar e operar o banco.
- Se o piloto usará somente dados sintéticos e em que condições dados reais poderão ser introduzidos.
- Regras comerciais de preço, medição de uso, cobrança, suspensão e período de tolerância.
- Se haverá equipe de suporte/administradores da plataforma com acesso excepcional a tenants, e qual aprovação/auditoria tal acesso exigiria.

## Tecnologias não aprovadas

PostgreSQL, RLS, Prisma, NestJS, Next.js, Expo, provedor de sessão, cobrança, estrutura de packages, multi-região e estratégia específica de deploy permanecem escolhas em aberto. A recomendação é aplicar os critérios técnicos da seção 2 depois de receber as decisões de produto e as informações operacionais necessárias.
