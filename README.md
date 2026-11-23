# NutriTrack

NutriTrack é uma plataforma em desenvolvimento para apoiar nutricionistas no acompanhamento de pacientes. O objetivo é evoluir, em etapas compreensíveis e testáveis, de uma base funcional para um produto com aplicações web e móveis e uma API central.

## Backend TypeScript

A API usa Node.js e TypeScript. Execute `pnpm build` para gerar `apps/api/dist`, `pnpm typecheck` para verificar os tipos e `pnpm start` para compilar e iniciar. Os testes compilam a API antes de executá-la. Para desenvolvimento, execute `pnpm --filter @nutritrack/api dev:build` em um terminal e `pnpm dev` em outro.

A migração de tipos é incremental. Os limites HTTP, sessões e o cliente PostgreSQL já recebem tipos, e a configuração ainda permite parâmetros com tipos implícitos.

## Estado atual

O primeiro passo estrutural separou servidor/API e interface web em workspaces pnpm, preservando a implementação existente. O código de runtime continua em JavaScript e usa Node.js e aceita PostgreSQL como armazenamento. Prettier é uma dependência de desenvolvimento usada para manter a formatação consistente.

**Implementado:** cadastro/login profissional, pacientes e perfis, avaliações antropométricas parciais, cálculos de IMC e composição estimada, agenda com detecção de conflitos, metas, dashboard com dados persistidos, rascunhos e versionamento de planos alimentares, publicação profissional com validações e portal separado do paciente. O portal usa convite de uso único e mostra somente versões publicadas. O profissional também pode gerar um link manual de redefinição de senha para a paciente; esse link expira em 24 horas e só pode ser usado uma vez.

**Ainda não implementado:** Prisma, API NestJS, frontend Next.js, apps Expo, consultas clínicas completas, recuperação automática por e-mail, limitação de tentativas, notificações de novas publicações, relatórios exportáveis e preparação para produção. Não use dados reais de saúde nesta versão.

## Requisitos e execução

Requer Node.js 20 ou superior e pnpm 11.25 ou compatível com `packageManager`.

```sh
pnpm install
pnpm dev
```

Abra http://localhost:3000. Crie uma conta profissional de desenvolvimento com senha de pelo menos 12 caracteres. `pnpm start` inicia o servidor; `pnpm test` executa os testes da API; `pnpm format` formata o código com Prettier. Os dados ficam em `data/store.json`, ignorado pelo Git. Sessões são mantidas em memória e terminam ao reiniciar. `.env.example` registra as variáveis lidas pelo servidor; Node.js nativo não carrega esse arquivo automaticamente.

## PostgreSQL

Crie um banco dedicado para o NutriTrack e configure `DATABASE_URL` no ambiente da API. A conta do banco precisa poder criar a tabela inicial e ler e gravar seus registros. Depois execute `pnpm start`.

Na primeira execução com o banco vazio, a API importa `data/store.json` se ele existir. Use `DATA_DIR` para indicar outra pasta que contenha esse arquivo. Pare o servidor que grava no JSON antes de iniciar a migração. O arquivo original fica disponível como cópia e não é reimportado nas próximas inicializações.

O PostgreSQL organiza profissionais, pacientes, avaliações, consultas, metas, planos, versões, contas do portal, convites, redefinições de senha e auditoria em tabelas próprias. Refeições, itens e anotações de progresso permanecem como documentos JSONB dentro do registro correspondente. Com PostgreSQL, as sessões são compartilhadas entre instâncias, expiram após oito horas e guardam somente o hash do token. Logout e troca de senha revogam o acesso. Sem `DATABASE_URL`, o ambiente de desenvolvimento continua usando o arquivo local. Em produção, configure `DATABASE_URL`.

### Migração do banco existente

Pare as instâncias antigas da API antes de iniciar esta versão. Na inicialização, a API cria as tabelas e importa o documento da tabela `nutritrack_store`. Em um banco novo, importa o arquivo `store.json` da pasta indicada por `DATA_DIR`. A migração é transacional e executada uma vez. O documento original é mantido e uma cópia também fica em `storage_migrations.legacy_snapshot`. Depois da migração, as tabelas relacionais são a fonte dos dados.

As chaves estrangeiras validam a associação entre paciente e profissional. Planos publicados referenciam versões do mesmo plano. A API grava somente os registros alterados e verifica a revisão antes de confirmar a transação. Uma gravação com revisão desatualizada recebe HTTP 409 e pode ser repetida após recarregar os dados.

A camada de compatibilidade ainda carrega o conjunto de registros para atender os endpoints existentes. Consultas por profissional com paginação são uma etapa posterior.

Para testar o banco, configure `TEST_DATABASE_URL` apontando para um PostgreSQL de testes e execute `pnpm --filter @nutritrack/api test:postgres`. A suíte cria schemas isolados com nomes aleatórios e os remove ao terminar. Ela verifica importação, reinicialização, versões, isolamento relacional, conflitos e rollback, além dos fluxos originais da API.

## Publicação na Vercel com Neon

A Vercel serve os arquivos de `apps/web/public` e encaminha `/api/*` para `api/index.js`. A entrada reutiliza a mesma API compilada, com inicialização sob demanda e controle das requisições concorrentes dentro de cada instância. As sessões ficam no PostgreSQL.

Crie um projeto PostgreSQL no Neon e configure `DATABASE_URL` na Vercel usando a conexão com TLS fornecida pelo Neon. Para várias instâncias, use o endereço pooled do Neon. Guarde a URL somente no ambiente da hospedagem.

Importe o repositório na Vercel, selecione a raiz do monorepo e mantenha as configurações de `vercel.json`. O build instala as dependências de desenvolvimento para compilar TypeScript. O runtime precisa de Node.js 24. A primeira requisição à API aplica a migração do banco.

Os planos gratuitos têm cotas e podem apresentar inicialização a frio. O ambiente de avaliação deve usar dados fictícios.

## Estrutura atual

```text
apps/
  api/                 servidor HTTP, endpoints e teste
    src/server.ts
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

- [Diagnóstico do estado atual](docs/architecture/current-state.md)
- [Arquitetura alvo](docs/architecture/target.md)
- [Plano incremental de migração](docs/development/migration-plan.md)
- [ADR 0001 — monorepositório incremental](docs/decisions/0001-incremental-monorepo.md)
- [Módulo de planos alimentares — fluxo e conceitos](docs/development/meal-plans.md)
- [Portal do paciente — convite, sincronização e privacidade](docs/development/patient-portal.md)

## Segurança e limitações

A API verifica a identidade e associa os registros ao profissional autenticado. Senhas são derivadas por scrypt; o cookie de sessão é HttpOnly e SameSite=Strict. A redefinição de senha do portal é iniciada pelo profissional e compartilhada manualmente; não há envio automático por e-mail. Faltam controles necessários à produção: rate limiting, recuperação automática por e-mail, sessões persistentes/revogáveis, banco relacional, gestão de segredos, backups, retenção e revisão profissional de segurança e privacidade. O projeto não declara conformidade automática com a LGPD.

Store JSON e sessões em memória são somente para desenvolvimento de uma instância; não há garantias de concorrência, disponibilidade ou retenção apropriada. Consulte a arquitetura antes de ampliar o uso.

## Aprendizado

Fluxo atual: navegador chama endpoints HTTP no mesmo servidor; o servidor valida a entrada, identifica o profissional pelo cookie, filtra registros pelo identificador autenticado, atualiza o arquivo JSON e devolve JSON. O teste de integração valida cadastro, cálculo, isolamento entre profissionais e conflito na agenda. A documentação de diagnóstico e o ADR explicam a primeira transição e suas consequências.
