# NutriTrack

NutriTrack é uma plataforma em desenvolvimento para apoiar nutricionistas no acompanhamento de pacientes. O objetivo é evoluir, em etapas compreensíveis e testáveis, de uma base funcional para um produto com aplicações web e móveis e uma API central.

## Estado atual

O primeiro passo estrutural separou servidor/API e interface web em workspaces pnpm, preservando a implementação existente. O código de runtime continua em JavaScript e usa apenas APIs nativas do Node.js. Prettier é uma dependência de desenvolvimento usada para manter a formatação consistente.

**Implementado:** cadastro/login profissional, pacientes e perfis, avaliações antropométricas parciais, cálculos de IMC e composição estimada, agenda com detecção de conflitos, metas, dashboard com dados persistidos, rascunhos e versionamento de planos alimentares, publicação profissional com validações e portal separado do paciente. O portal usa convite de uso único e mostra somente versões publicadas. O profissional também pode gerar um link manual de redefinição de senha para a paciente; esse link expira em 24 horas e só pode ser usado uma vez.

**Ainda não implementado:** PostgreSQL/Prisma, API NestJS, frontend Next.js, apps Expo, consultas clínicas completas, recuperação automática por e-mail, limitação de tentativas, notificações de novas publicações, relatórios exportáveis e preparação para produção. Não use dados reais de saúde nesta versão.

## Requisitos e execução

Requer Node.js 20 ou superior e pnpm 11.25 ou compatível com `packageManager`.

```sh
pnpm install
pnpm dev
```

Abra http://localhost:3000. Crie uma conta profissional de desenvolvimento com senha de pelo menos 12 caracteres. `pnpm start` inicia o servidor; `pnpm test` executa os testes da API; `pnpm format` formata o código com Prettier. Os dados ficam em `data/store.json`, ignorado pelo Git. Sessões são mantidas em memória e terminam ao reiniciar. `.env.example` registra as variáveis lidas pelo servidor; Node.js nativo não carrega esse arquivo automaticamente.

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
