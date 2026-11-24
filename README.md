# NutriTrack

## Preparação de produção — branch hardening/production-readiness

A API Node continua sendo o backend principal, preservando os fluxos individuais e de equipe. O perfil de produção usa `STORE_BACKEND=sqlite`, WAL, transações, sessões persistidas, controle de origem e confirmação de e-mail. Requer Node 24.15+. JSON permanece somente para desenvolvimento/importação; a API Python continua alternativa em migração e não é o destino do cutover comercial.

Consulte [o guia de implantação](docs/audit/PRODUCTION_DEPLOYMENT_GUIDE.md), [as ações externas obrigatórias](docs/audit/MANUAL_ACTIONS_REQUIRED.md) e [a avaliação final](docs/audit/FINAL_PRODUCTION_READINESS_REPORT.md). Nenhum deploy foi realizado e os gates de infraestrutura/privacidade externos continuam necessários antes de clientes reais.

Checks locais: `pnpm lint`, `pnpm typecheck`, `pnpm build`, `pnpm test`, `pnpm test:e2e`. A verificação de tipos é estrita nos novos módulos de segurança/persistência; o legado não foi convertido integralmente para TypeScript.

O perfil SQLite admite uma instância da API com volume local persistente. Não use armazenamento de rede nem escale réplicas sem uma nova validação arquitetural/carga. Backups são executados por `pnpm storage`; e-mails usam fila criptografada e `pnpm mail:worker` com relay SMTP autorizado. Configurar chaves, documentos legais e relay está descrito no guia; não existem credenciais privadas no exemplo.


## API Python (migração em andamento)

Há uma implementação FastAPI/SQLAlchemy/PostgreSQL inicial em `apps/api-python`. Ela inclui cadastro/login profissional, cookies de sessão persistidos, pacientes e atribuições, avaliações, agenda, metas, planos alimentares com publicação, convites e autenticação básica do portal. A interface continua HTML/CSS/JavaScript e aceita a configuração da URL da API em `apps/web/public/config.js`.

O backend Node existente continua preservado e é o único backend que reproduz integralmente os fluxos atuais de equipe/workspaces e compatibilidade visual. A API Python ainda não é substituta completa nem está pronta para dados de produção. Consulte [docs/PYTHON_MIGRATION_STATUS.md](docs/PYTHON_MIGRATION_STATUS.md) antes de usar.

### Desenvolvimento com Docker

Requer Docker Compose. Copie `.env.example` para `.env`, defina uma senha local longa e URL-safe em `POSTGRES_PASSWORD`, e então:

```sh
docker compose up -d db
pnpm db:migrate
pnpm dev:python
```

Em outro terminal, inicie a interface em `http://localhost:8080`, apontando para a API Python:

```sh
export API_BASE_URL=http://localhost:8000
pnpm dev:web
```

No PowerShell: `$env:API_BASE_URL='http://localhost:8000'; pnpm dev:web`. Sem essa variável, o servidor web usa a mesma origem, o que mantém compatibilidade com o servidor Node legado.

`pnpm test:python` executa os testes contra o PostgreSQL do Compose. Use somente um banco descartável de teste; a suíte não deve apontar para produção. A API não aplica migrações automaticamente ao iniciar. Para verificação de prontidão: `GET http://localhost:8000/health`.

Para hospedagem, aplique migrations como etapa explícita (`alembic upgrade head`) e use PostgreSQL, origens CORS, HTTPS e `SESSION_COOKIE_SECURE=true` exclusivos daquele ambiente. O frontend deve usar proxy same-site para a API ou configurar `NUTRITRACK_API_BASE` em `apps/web/public/config.js` e revisar cookies/CORS do domínio final.

### Backup local PostgreSQL

```sh
docker compose exec -T db pg_dump -U nutritrack -Fc nutritrack > nutritrack.dump
```

Restaure em um banco novo e vazio, após verificar o arquivo e a versão do schema:

```sh
docker compose exec -T db pg_restore -U nutritrack -d NOVO_BANCO_VAZIO < nutritrack.dump
```

Não use `--clean` contra a base ativa. Em hospedagem, use o mecanismo de backup do provedor, teste restauração em uma base isolada e documente RPO/RTO antes do corte.

NutriTrack é uma plataforma em desenvolvimento para nutricionistas que atendem individualmente. O produto comercial será direcionado a nutricionistas, com um espaço profissional próprio para acompanhar pacientes, consultas, avaliações, metas e planos alimentares. A implementação de clínica permanece disponível por feature flag para desenvolvimento e validação.

## Estado atual

O primeiro passo estrutural separou servidor/API e interface web em workspaces pnpm, preservando a implementação existente. O runtime principal continua em JavaScript/Node, com SQLite nativo e Nodemailer para SMTP. ESLint, Prettier, TypeScript, Playwright e Axe são ferramentas de desenvolvimento/validação.

**Implementado:** cadastro/login profissional, pacientes e perfis, avaliações antropométricas parciais, cálculos de IMC e composição estimada, agenda com detecção de conflitos, metas, dashboard com dados persistidos, rascunhos e versionamento de planos alimentares, publicação profissional com validações e portal separado do paciente. O portal usa convite de uso único e mostra somente versões publicadas. O profissional também pode gerar um link manual de redefinição de senha para a paciente; esse link expira em 24 horas e só pode ser usado uma vez.

**Fora do escopo atual:** Prisma/NestJS/Next.js/Expo, consultas clínicas completas, notificações de novas publicações e cobrança automática. Recuperação profissional por e-mail, limites de tentativas e exportações técnicas foram implementados; entrega SMTP real e prontidão operacional/privacidade continuam pendentes. Não use dados reais de saúde antes de resolver os gates dos relatórios finais.

## Requisitos e execução

Requer Node.js 24.15 ou superior e pnpm 11.25 ou compatível com `packageManager`.

```sh
pnpm install
pnpm dev
```

Abra http://localhost:3000. Crie uma conta profissional de desenvolvimento com senha de pelo menos 12 caracteres. `pnpm start` inicia o servidor; `pnpm test` executa os testes da API; `pnpm format` formata o código com Prettier. Os dados ficam em `data/store.json`, ignorado pelo Git. Sessões separadas de profissionais e pacientes são mantidas em memória, expiram após oito horas e terminam ao reiniciar; o servidor também valida esse prazo. `.env.example` registra as variáveis lidas pelo servidor; Node.js nativo não carrega esse arquivo automaticamente.

## Estrutura atual

```text
apps/
  api/                 servidor HTTP, endpoints e teste
    src/server.js
    test/application.test.js
  web/public/           HTML, CSS e JavaScript da interface
    portal.js           experiência separada do paciente
docs/
  architecture/        diagnóstico e arquitetura alvo
  decisions/           decisões arquiteturais
  development/         plano incremental de transição
```

A API ainda serve os arquivos estáticos da web. A separação em pastas é um limite lógico inicial; os deploys ainda não são independentes.

## Documentação

- [Estado da implementação do MVP e decisões bloqueadoras](docs/MVP_IMPLEMENTATION_STATUS.md)
- [Diagnóstico do estado atual](docs/architecture/current-state.md)
- [Arquitetura alvo](docs/architecture/target.md)
- [Plano incremental de migração](docs/development/migration-plan.md)
- [ADR 0001 — monorepositório incremental](docs/decisions/0001-incremental-monorepo.md)
- [Módulo de planos alimentares — fluxo e conceitos](docs/development/meal-plans.md)
- [Portal do paciente — convite, sincronização e privacidade](docs/development/patient-portal.md)

## Segurança e limitações

A API exige membership ativo no workspace selecionado e aplica papéis e atribuições clínicas por paciente. Após cadastro, uma etapa anterior ao painel pergunta se a pessoa criará consultório próprio (com nome e escolha de papel clínico) ou entrará por convite; só a proprietária recebe gestão do workspace. Contas antigas precisam confirmar uma migração explícita com backup local. Convites de equipe e do portal são links de uso único compartilhados manualmente; não há envio automático por e-mail. Senhas são derivadas por scrypt; cookies são HttpOnly/SameSite e as sessões expiram no servidor após oito horas.

O modo publicado atende nutricionistas individualmente. A seleção de perfis, gestão de clínica/equipe e rotas administrativas ficam desativadas no frontend e na API, sem remover sua implementação nem os dados associados. Em produção, a flag `NUTRITRACK_CLINIC_ADMIN_ENABLED` é desativada por padrão; para reativar a experiência administrativa de forma coordenada, configure-a como `true` na API e no servidor web. Fora de produção, o modo administrativo existente continua habilitado por padrão e pode ser desativado com `NUTRITRACK_CLINIC_ADMIN_ENABLED=false`.

Store JSON e sessões em memória são somente para desenvolvimento. Produção exige SQLite transacional com sessões duráveis; rate limiting e MFA foram adicionados. Operação real, revisão jurídica/privacidade, TLS, SMTP e backups externos ainda precisam homologação. O projeto não declara conformidade automática com a LGPD nem prontidão para dados clínicos reais. Consulte [o estado da implementação multi-tenant](docs/MVP_IMPLEMENTATION_STATUS.md) e a arquitetura antes de ampliar o uso.

## Aprendizado

Fluxo atual: navegador chama endpoints HTTP no mesmo servidor; o servidor identifica a conta pelo cookie, valida o membership e o workspace ativo, checa papel/atribuição quando a operação é clínica, grava a transação SQLite (ou JSON somente em desenvolvimento) e devolve uma projeção compatível com o papel. A suíte de integração cobre cadastro e fluxos anteriores, convite/aceite de equipe, atribuição, assistente sem prontuário, isolamento entre workspaces e conflito de agenda. A documentação de diagnóstico e o ADR explicam a evolução incremental e suas consequências.
