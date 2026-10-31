# Inventário de arquivos

Base: 60 arquivos rastreados (`git ls-files`), dos quais 32 arquivos de runtime/configuração/testes/dependências e 27 documentos; lockfile completa a contagem. Este inventário detalha runtime/configuração/testes e resume documentos existentes. Excluídos `.git`, `node_modules`, `.venv`, temporários/builds. Estado descreve evidência estática, não validação em produção.

| Caminho | Nome / tipo | Camada | Responsabilidade e principais elementos | Dependências / integrações | Estado e observações |
|---|---|---|---|---|---|
| `package.json` | JSON | Raiz / scripts | Workspaces pnpm e scripts dev/start/test/python/migrate/format | Node, pnpm, Docker | Scripts declarados; Python tests tocam PostgreSQL Compose |
| `pnpm-workspace.yaml` | YAML | Configuração | Define `apps/*` como workspaces | pnpm | Configuração |
| `pnpm-lock.yaml` | lockfile | Dependências | Lock de workspace e Prettier | pnpm | Não se inferiu atualização/uso além do manifesto |
| `.env.example` | env modelo | Configuração | Exemplo APP_ENV, porta, DB, cookie, TTL, CORS | Compose/Python | Não contém segredo válido esperado |
| `.env` | env local | Configuração | Configuração local presente | Python Compose possivelmente | Não lido por segurança; estado dos valores desconhecido |
| `.gitignore` | texto | Configuração | Regras de exclusão | Git | `data/store.json` citado pelo README como ignorado |
| `.prettierrc.json` | JSON | Ferramenta | Configuração de formatação | Prettier | Formatação, não valida runtime |
| `.vscode/tasks.json` | JSON | Ferramenta | Tarefas do editor | VS Code | Auxiliar |
| `README.md` | Markdown | Documentação | Instruções e descrição de arquitetura/estado | docs, pnpm, Docker | Parcialmente desatualizado frente ao próprio texto e código Python |
| `docker-compose.yml` | YAML | Infra | DB, API, perfil de test-db; healthcheck e volume | Docker Compose, PostgreSQL | Sem Node/web; segredo local de teste constante no YAML |
| `apps/api/package.json` | JSON | Backend Node | start/dev/test, Node >=20 | Node nativo | Sem dependências runtime externas |
| `apps/api/src/server.js` | JavaScript | Backend/API | HTTP, auth, JSON store, autorização, 50+ handlers/rotas, static serving | Node builtins, `access-control.js`, frontend, `data/store.json` | Implementado localmente; monolítico; sessão em memória |
| `apps/api/src/access-control.js` | JavaScript | Autorização | Papéis, permissões, membership ativa, atribuição clínica | `server.js` | Implementado e testado em unitários |
| `apps/api/test/access-control.test.js` | JavaScript | Teste | Permissões, ausência de acesso clínico sem atribuição, membership revogada | node:test | Teste existente, não executado nesta auditoria |
| `apps/api/test/application.test.js` | JavaScript | Teste integração | Spawn Node, chamadas HTTP e fluxos de autenticação/multi-tenant/portal | node:test, filesystem, HTTP | Remove `test/.runtime-data`; não executado |
| `apps/web/package.json` | JSON | Frontend | Metadados do workspace web | pnpm | Sem scripts/dependências próprios |
| `apps/web/server.mjs` | JavaScript ESM | Servidor web/proxy | Static serving, rotas SPA e proxy `/api` por `API_BASE_URL` | Node builtins, FastAPI/Node | Implementado; headers proxy herdados do upstream; sem definição explícita de CSP neste caminho |
| `apps/web/public/index.html` | HTML | Frontend | Shell, login, dashboard container, modal e scripts | app.js, portal.js, styles.css, config.js | Interface implementada como SPA sem framework |
| `apps/web/public/app.js` | JavaScript | Frontend profissional | Estado, navegação, telas e formulários; `api`, páginas e modais | API JSON e cookie, localStorage workspace | Implementado parcialmente/fortemente acoplado ao contrato Node |
| `apps/web/public/portal.js` | JavaScript | Frontend paciente | Login/ativação/reset, renderização de planos publicados | API portal, cookie separado | Implementado; link usa fragmento URL e formulário com escaping |
| `apps/web/public/config.js` | JavaScript | Configuração frontend | Base de API vazia por padrão | window global | Same-origin Node; precisa parametrizar Python |
| `apps/web/public/styles.css` | CSS | Frontend | Estilos de shell, profissional e portal e responsividade | index/app | Implementação visual; não avaliada em navegador |
| `apps/api-python/requirements.txt` | requirements | Dependências | FastAPI 0.115.12, Uvicorn 0.34.2, SQLAlchemy 2.0.40, psycopg 3.2.6, Alembic 1.15.2, Pydantic 2.11.3, Argon2 23.1.0, pytest 8.3.5, httpx 0.28.1 | Python | Versões fixadas; frescor não verificado |
| `apps/api-python/Dockerfile` | Dockerfile | Infra/API | Imagem e inicialização Uvicorn | requirements, app.main | Não aplica migração no startup |
| `apps/api-python/alembic.ini` | INI | Banco | Configuração Alembic | migrations/env.py, DATABASE_URL | Migração explícita |
| `apps/api-python/app/__init__.py` | Python | Backend | Marca pacote | Python | Mínimo |
| `apps/api-python/app/main.py` | Python | API | Middleware, modelos request, auth, endpoints e lógica clínica | FastAPI, SQLAlchemy, models/security | Subconjunto de APIs em migração; validações heterogêneas em dict payload |
| `apps/api-python/app/database.py` | Python | Persistência | Engine PostgreSQL, sessionmaker, dependency `get_db` | DATABASE_URL, SQLAlchemy | Tem URL default local; falha no modo production se ausente |
| `apps/api-python/app/models.py` | Python | Persistência/modelo | 13 modelos de tabela e constraints/índices | SQLAlchemy, PostgreSQL JSONB/UUID | Schema inicial; dados parcialmente JSONB |
| `apps/api-python/app/security.py` | Python | Segurança | Argon2, verificação, session id, hash token, clock e expiry | argon2-cffi, secrets/hashlib | Implementado; sessão 8h via env |
| `apps/api-python/migrations/env.py` | Python | Migração | Metadata e URL Alembic | app.models/database | Migrações explícitas |
| `apps/api-python/migrations/script.py.mako` | template | Migração | Template de revisão | Alembic | Auxiliar |
| `apps/api-python/migrations/versions/0001_initial.py` | Python | Migração | Cria tabelas via metadata; downgrade bloqueado | models, Alembic | Implementado, inicial não reversível |
| `apps/api-python/tests/test_api.py` | Python | Testes integração | Quatro cenários: auth, sessão expirada, isolamento/conflito, portal/revogação | pytest, TestClient, PostgreSQL via DATABASE_URL | Escreve schema/dados no banco fornecido; não executado |
| `data/` | diretório | Persistência Node | Store runtime `store.json` conforme código/README | server.js | Presente; conteúdo não inventariado |
| `docs/*` (25 arquivos) | Markdown | Documentação | Arquitetura atual/alvo, migração, auditorias e especificações | Repositório | Vários são propostas/diagnósticos; não são prova de runtime. Inclui `docs/ARCHITECTURE_REVIEW.md`, `AUTHORIZATION_MATRIX.md`, `BASELINE_REPORT.md`, `CONSOLIDATED_ARCHITECTURE_PROPOSAL.md`, `DATABASE_DESIGN.md`, `IMPLEMENTATION_SPECIFICATION.md`, `INTEGRATED_AUDIT.md`, `MIGRATION_PLAN.md`, `MULTITENANT_*`, `MVP_IMPLEMENTATION_STATUS.md`, `PRODUCT_REQUIREMENTS_BASELINE.md`, `PYTHON_MIGRATION_STATUS.md`, `ROUTE_INVENTORY.md`, `SAAS_*`, `TEST_EXECUTION_DIAGNOSIS.md`, `architecture/*`, `decisions/*`, `development/*`. |
| `docs/auditoria/*` | Markdown | Entregáveis | Esta auditoria | Código atual | Criados nesta tarefa; não são fonte de runtime |
| `.tmp-*`, `node_modules`, `.venv`, `.git`, logs `server-preview*.log` | gerados/locais | Ambiente | Diretórios de build/preview/dependências e logs existentes | ferramentas locais | Registrados; excluídos do inventário detalhado; logs não inspecionados |

## Arquivos extensos

`apps/api/src/server.js`: inicialização/store (1–120); sessão, projeções e helpers de domínio (123–390); rotas de auth/portal/workspace (391–1080); dashboard, pacientes, atribuições e acesso portal (1081–1449); avaliações, agenda, metas e planos (1450–1758); static/error/listen (1760–1800). `apps/api-python/app/main.py`: configuração/middleware/modelos auxiliares (1–147); health/auth/workspaces/pacientes/portal (148–395); avaliações, agenda, metas e planos (396–final). `apps/web/public/app.js` usa funções/page handlers (1–1185 aproximadamente); `portal.js` concentra a experiência paciente e reset.

