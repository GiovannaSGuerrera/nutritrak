# Estado da migração para FastAPI/PostgreSQL

Atualizado em 2026-10-30. A migração foi iniciada em uma nova pasta; a API Node, os testes e o store JSON foram mantidos intactos.

## Entregue nesta etapa

- FastAPI, Pydantic, SQLAlchemy 2, driver psycopg, Alembic e pytest em `apps/api-python`.
- PostgreSQL 16 e API em Docker Compose; health check HTTP; configurações de ambiente e pool.
- Tabelas para identidade, workspaces/memberships, paciente/atribuição, avaliação, agenda, meta, plano versionado, conta de portal, sessão, token de uso único e rate-limit.
- Hash de senha Argon2id; sessões opacas persistidas no PostgreSQL, cookie HttpOnly/SameSite Strict, expiração server-side, logout e rotação no login.
- Rotas iniciais para cadastro/login, pacientes, avaliações, agenda e conflitos, metas, dashboard, planos, publicação, convite/ativação do portal, login/logout portal, recuperação de senha manual e suspensão/reativação/revogação terminal.
- Servidor estático independente e configuração de URL da API no frontend.
- Migração inicial Alembic sem downgrade destrutivo.

## Validação executada

- Docker build da API e aplicação da migration `0001_initial` em PostgreSQL local concluídos.
- `pnpm test:python`: 5 testes passaram em banco descartável.
- Health check da API respondeu `{"status":"ok"}`; frontend respondeu HTTP 200 com `API_BASE_URL` apontando para a API.
- Compilação sintática Python, verificações JavaScript e `docker compose config` passaram.

## Limites que impedem o cutover/hospedagem

- A API Python não implementa os contratos atuais de workspaces/equipe (convites, membros, permissões, atribuição e troca de workspace completas), nem todos os DTOs/consultas de dashboard e histórico. Por isso o frontend completo ainda não pode trocar de backend sem falhas.
- Não há importador executável do JSON nem reconciliação de referências/hash. `data/store.json` contém dados existentes; a inspeção foi limitada às coleções e contagens, sem imprimir valores. Nenhuma linha foi importada, alterada ou removida. O backend Python começa com banco vazio.
- A migration inicial cria tabelas a partir do metadata ORM. Mudanças futuras devem gerar migrations Alembic explícitas, revisadas em diff SQL e testadas em banco limpo e com dados sintéticos.
- A suíte Python ainda é curta: passou cadastro/login/logout, expiração, isolamento entre workspaces, conflito de agenda, publicação e regras básicas do portal; ainda faltam cenários amplos de CSRF, recuperação, replays, concorrência real e persistência após restart.
- Versões/conteúdo de refeições usam JSONB dentro do plano; normalizar versões, refeições e itens em tabelas próprias continua pendente para constraints e consultas relacionais completas.
- O limitador de tentativas é persistente no PostgreSQL, mas a contagem concorrente ainda precisa de teste/garantia atômica para abuso distribuído.
- O desenvolvimento local foi iniciado em `http://localhost:8080` (web) e `http://localhost:8000` (API), com CORS e cookies testados no ambiente local. A implantação ainda precisa de proxy/reverse proxy, CORS/cookies dos domínios reais e HTTPS.
- Backup/restauração foi documentado, mas não ensaiado. Não há implantação hospedada, teste de carga para 100 usuários, revisão independente de segurança/privacidade ou validação legal.

## Dados locais

`data/store.json` permanece exatamente como estava. A inspeção de estrutura contou 4 usuários, 3 pacientes, 5 avaliações, 3 compromissos, 1 meta, 3 planos, 5 workspaces, 5 memberships, 1 conta de portal, 2 convites de portal, 7 convites de workspace e 39 eventos de auditoria. Valores de nomes, e-mails, credenciais e dados clínicos não foram incluídos neste relatório. As contagens já demonstram que o store não está vazio; a distribuição entre entidades exige reconciliação.

É necessário preparar um importador com manifesto sem PII, validar IDs/FKs/hash de senhas, reconciliar workspaces e conferir totais. A importação não foi declarada concluída e não deve ser feita por uma inicialização automática. Os hashes atuais usam scrypt; a continuidade de login exige verificar e rehash da senha no primeiro login ou exigir redefinição autorizada, conforme decisão explícita.

## Comandos

```sh
cp .env.example .env
docker compose up -d db
pnpm db:migrate
pnpm dev:python
pnpm dev:web
pnpm test:python
```

No PowerShell, use `Copy-Item .env.example .env`. Para apontar o servidor estático à API local, inicie-o com `API_BASE_URL=http://localhost:8000` (PowerShell: `$env:API_BASE_URL='http://localhost:8000'`).

Em Linux/macOS, use `cp .env.example .env` no lugar de `Copy-Item`.
