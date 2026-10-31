# Auditoria técnica integral — NutriTrack

**Data da inspeção:** 30/10/2026. **Base:** conteúdo presente em `master`; `git status --short` limpo no início. Nenhum código foi alterado. A auditoria é estática; não houve execução de testes.

## Escopo e método

Inspecionados em detalhe os 32 arquivos rastreados de código, configuração, dependências (exceto lockfile), testes e README; os 27 documentos técnicos preexistentes foram inventariados e tratados como contexto, sem usá-los como prova de implementação. `rg --files` listou 57 arquivos fora de diretórios ignorados; `git ls-files` listou 60 rastreados. `node_modules`, `.venv`, `.git`, diretórios temporários e saídas de build foram excluídos da análise detalhada. Esses diretórios estão presentes (`node_modules`, `.venv`, `.git`, `.tmp-*`). O arquivo `.env` existe, mas seu conteúdo não foi aberto nem reproduzido.

A documentação anterior foi usada apenas para localizar temas. Os estados abaixo derivam do código. Os números de linha referem-se aos arquivos atuais e podem mudar após alterações.

## Resumo da arquitetura encontrada

Monorepo pnpm com frontend estático HTML/CSS/JavaScript em `apps/web/public`, servidor HTTP Node.js legado em `apps/api/src/server.js` e API FastAPI em `apps/api-python/app/main.py`. O Node serve os arquivos estáticos e as rotas de API no mesmo processo/origem; persiste coleções em `data/store.json` e mantém sessões em mapas na memória. A API Python usa FastAPI, SQLAlchemy, PostgreSQL e Alembic, e está em migração: seu conjunto de rotas não espelha integralmente o Node. `apps/web/server.mjs` é um servidor estático/proxy separado cuja configuração de destino vem de `API_BASE_URL`; sem ela, responde 503 para `/api/*`. O frontend usa same-origin por padrão via `config.js`.

Docker Compose define PostgreSQL, API Python e serviço separado de banco temporário para testes. Não define frontend nem Node. O README descreve a API Python como inicial/não substituta e alerta contra dados reais. Não há evidência no repositório de hospedagem, CI, monitoramento ou backup automatizado.

### Fluxo de requisição

No caminho padrão, navegador → `app.js`/`portal.js` → `fetch('/api/...', credentials: include)` → Node `handle` → cookie/sessão em memória → autorização de workspace/papel/atribuição → atualização da estrutura em memória → gravação serializada do JSON → resposta JSON. O portal usa cookie independente e projeção `safePatientPortal`, que expõe versões publicadas.

No caminho Python, navegador/proxy → FastAPI middleware (CORS e verificação de Origin em operações com cookie) → dependências `principal`/`portal_principal` → SQLAlchemy/PostgreSQL → JSON. Migrações são explícitas e a API não migra schema no startup. Com URL Python configurada, telas que chamam recursos não implementados na API Python falham.

## Inventário da aplicação

A lista detalhada de arquivos está em [INVENTARIO_ARQUIVOS.md](INVENTARIO_ARQUIVOS.md); endpoints em [INVENTARIO_API.md](INVENTARIO_API.md); fluxos em [INVENTARIO_FUNCIONALIDADES.md](INVENTARIO_FUNCIONALIDADES.md); segurança em [SEGURANCA_E_RISCOS.md](SEGURANCA_E_RISCOS.md).

### Backend Node

`apps/api/src/server.js` concentra persistência, sessões, autenticação, autorização, regras de negócio, rotas, resposta de erro e arquivos estáticos (cerca de 1.800 linhas). `loadStore` inicializa e valida coleções (54–83); `persist` serializa gravações com arquivo temporário e rename (85–98); leitura do corpo limita 1 MB (110–120); sessões/cookies e projeções ficam em helpers (123–230); autorização multi-workspace e atribuições em 236–330; normalização/publicação de plano em 336–389; roteamento em `handle` (391–1758); static-serving em 1760+. `access-control.js` declara papéis e permissões. Não há framework HTTP externo.

Persistência JSON é funcional para uma instância local; fila de escrita serializa dentro do processo, sem transação entre processos, constraints de banco ou persistência de sessão. Há cópia local de backup na migração de dados pessoais (aprox. 711–790), acionada pelo usuário, não política de backup.

### Backend Python/PostgreSQL

`main.py` declara 36 operações HTTP incluindo health (linhas 148–490), autenticação, workspace básico, pacientes/atribuições, portal, avaliação, agenda, metas e plano alimentar. `models.py` declara 13 tabelas: users, workspaces, memberships, patients, patient_assignments, assessments, appointments, goals, meal_plans, patient_accounts, sessions, one_time_tokens e rate_limit_hits. Colunas, constraints e FK constam no modelo. JSONB guarda papéis, perfil, medidas, dados de agenda, progresso e versões do plano. `0001_initial.py` cria tabelas a partir do metadata; downgrade lança erro intencionalmente, sem remoção. Nenhuma segunda migração foi encontrada.

A API Python implementa senha Argon2id via PasswordHasher, cookies server-side persistidos, tokens de uso único apenas em hash, CORS configurável, validação de Origin e rate limiting no banco. Porém, os controles devem ser avaliados junto às rotas e estado de migração; veja segurança.

## Frontend

`index.html` é shell único com login e contêiner profissional. `app.js` contém roteamento/telas dashboard, pacientes/detalhe, avaliações, planos, agenda, metas, equipe, profissionais, convites, clínica e permissões; formulários usam atributos HTML e validações no servidor. `portal.js` provê experiência separada para login, ativação, planos publicados, logout e redefinição, e escapa conteúdo com `portalEsc`. `styles.css` reúne estilos e breakpoints responsivos. `config.js` define `window.NUTRITRACK_API_BASE = ''` por padrão. Estado do workspace escolhido fica em `localStorage`; token de sessão está em cookie HttpOnly.

A interface chama `/api/workspaces/:id/members`, `/invitations`, `/roles`, convites/aceite, gestão do workspace e rotas Node de autorização/atribuições que não estão implementadas na API Python (ver inventário). `app.js` também espera certos DTOs e campos específicos. Portanto, configuração do Python requer validação de compatibilidade funcional antes de uso.

## Banco, dados e regras

Node usa documento JSON com arrays para usuários, pacientes, avaliações, consultas, metas, planos, contas/tokens do portal, workspaces, memberships, atribuições, convites e auditoria. Senhas são salt + scrypt, não sessões. Python usa PostgreSQL e UUID; FK compostas paciente/workspace limitam associações clínicas em assignments, assessment, appointment, goal e meal plan. Campos de nascimento estão armazenados como `String(10)`; avaliações antropométricas usam Float; medidas e alguns agregados ficam em JSONB. Índices existem em FK e horários conforme `models.py`; sem constraints explícitas de valores/enums, e relações SQLAlchemy não declaram ORM relationships.

Regras observadas no Node: senha de 12–200 caracteres; sessão profissional/paciente de 8h padrão; convite de equipe expira em 7 dias e de paciente e reset têm validade; clínica exige atribuição explícita para acesso clínico; agenda detecta sobreposição por usuário; avaliação calcula IMC/massa gorda/magra; plano mantém versões e publicação exige refeição/item e quantidade/unidade. Python implementa subconjunto e tem formatos/estados parcialmente diferentes.

## Testes e qualidade

Existem dois testes Node (`access-control.test.js`, `application.test.js`) e um arquivo Python com quatro funções de teste. O arquivo Node cobre permissões e diversos fluxos de integração, incluindo workspace, portal, papéis e revogação. Há limpeza destrutiva de `apps/api/test/.runtime-data` na inicialização e teardown. O caminho estava ausente na inspeção, mas testes não foram executados por cautela quanto à exclusão automática. Python exige `DATABASE_URL`; fixture cria tabelas no banco apontado, e script `pnpm test:python` sobe containers via Docker. Não executado para evitar alterações a estado Docker/banco não confirmadas como descartáveis. Nenhum resultado de aprovação/reprovação foi produzido nesta auditoria.

## Infraestrutura e operação

`docker-compose.yml`: PostgreSQL 16 Alpine com volume nomeado persistente, healthcheck e restart; API Python com porta 8000 e dependência do banco; profile `test` com PostgreSQL em tmpfs. API Docker inicia Uvicorn (Dockerfile) mas não aplica Alembic automaticamente. `pnpm db:migrate` é comando explícito. Não há serviço Node/web no Compose. `.env.example` lista APP_ENV, API_PORT, credenciais de DB, cookie, TTL e CORS. `.env` está presente (não inspecionado); `.gitignore` e rastreamento devem ser conferidos antes de qualquer publicação.

O README prescreve backup/restauração manual via pg_dump/pg_restore, mas isso não configura rotina executável. Não há health check de aplicação no Compose, CI, deploy manifest, TLS termination, logs estruturados externos nem monitoramento identificado. Preparação para hospedagem: **não validada/pronta**; o próprio README diz que Python não é substituta completa e recomenda HTTPS, CORS explícito, cookie Secure, proxy same-site, backups testados e sem dados reais.

## Problemas e riscos

Prioridades e evidências detalhadas em [SEGURANCA_E_RISCOS.md](SEGURANCA_E_RISCOS.md). Principais confirmados: persistência/sessões Node locais não compartilhadas; divergência entre contratos Node/Python; `SESSION_TTL_HOURS` não aplicado consistentemente no cadastro Python, que define cookie de 28.800s; API Node não possui rate limit; API Python tem tabela de rate limit com limpeza não demonstrada; serviço web proxy não propaga explicitamente `Set-Cookie`/credenciais cross-origin nem configura cabeçalhos de segurança nos caminhos de proxy; ausência de evidência de operação de produção. Nenhum teste de ataque externo foi feito.

## Divergências documentais

README ainda afirma em seção de “Ainda não implementado” que PostgreSQL/API nova não existe, embora a seção inicial descreva a migração e os arquivos Python/Compose já implementem uma versão inicial. README também lista agenda/avaliações/portal como funcionais no legado, mas isso não equivale a validação de produção. Docs de arquitetura-alvo e planos descrevem intenções que não foram contadas como implementação.

## Áreas não verificadas

Não foram inspecionados conteúdos gerados/dependências, `.env` (por conter configuração potencialmente sensível), estado de serviços externos, domínio/produção, comportamento de navegador real, concorrência multi-processo, desempenho, restauração de backup nem segurança dinâmica. Os testes não foram executados. Não se conclui que as rotas funcionam integralmente apenas por estarem presentes.



