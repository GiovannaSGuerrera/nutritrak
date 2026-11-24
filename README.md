# NutriTrack

O NutriTrack ajuda nutricionistas a organizar o acompanhamento dos seus pacientes. Em um só lugar, dá para registrar avaliações, cuidar da agenda, acompanhar metas e montar planos alimentares. Cada paciente também tem seu espaço para consultar o plano publicado pelo profissional.

O projeto está em desenvolvimento e já pode ser acessado pelo navegador, no computador ou no celular.

## Conheça o projeto

- [Abrir o NutriTrack](https://nutritrack-eta-ten.vercel.app/)
- [Acessar o portal do paciente](https://nutritrack-eta-ten.vercel.app/paciente)

Para experimentar, crie uma conta profissional com uma senha de pelo menos 12 caracteres. O acesso do paciente começa com um convite gerado pelo nutricionista dentro do sistema. Você pode usar a versão online sem instalar nada.

Nesta fase, use apenas dados fictícios. A hospedagem usa planos gratuitos e pode levar alguns instantes para responder após um período sem acesso.

## O que já dá para fazer

- Cadastrar pacientes e consultar seus perfis.
- Registrar avaliações e calcular IMC e estimativas de composição corporal.
- Organizar consultas e identificar conflitos de horário.
- Definir metas e acompanhar o progresso.
- Criar, revisar e publicar planos alimentares.
- Compartilhar os planos publicados pelo portal do paciente.

Os dados da versão online ficam no PostgreSQL do Neon. A aplicação está hospedada na Vercel, com backend em Node.js e TypeScript.

## O que vem pela frente

Ainda estamos trabalhando para preparar o projeto para uso com dados reais. Entre os próximos passos estão melhorias de segurança e desempenho, recuperação de acesso por e-mail e relatórios para exportação.

## Proteção dos dados

As proteções e pendências estão registradas no [guia de operação](docs/security/operations.md) e no [rascunho de privacidade](docs/security/privacy.md). Continue usando dados fictícios enquanto a preparação para uso real estiver em andamento.

## Para quem quer mexer no código

O [manual de SQL](docs/development/manual-sql.md) explica as tabelas e traz exemplos para consultar pacientes, avaliações, agenda e planos alimentares.

As instruções para rodar uma cópia local, configurar o banco e executar os testes estão abaixo.

<details>
<summary>Ver documentação técnica</summary>

## Backend TypeScript

A API usa Node.js e TypeScript. Execute `pnpm build` para gerar `apps/api/dist`, `pnpm typecheck` para verificar os tipos e `pnpm start` para compilar e iniciar. Os testes compilam a API antes de executá-la. Para desenvolvimento, execute `pnpm --filter @nutritrack/api dev:build` em um terminal e `pnpm dev` em outro.

A migração de tipos é incremental. Os limites HTTP, sessões e o cliente PostgreSQL já recebem tipos, e a configuração ainda permite parâmetros com tipos implícitos.

## Estado atual

O projeto usa workspaces pnpm para separar API e interface. A API é escrita em TypeScript e compilada para Node.js. A interface usa HTML, CSS e JavaScript, com layout responsivo para desktop e celular. A mesma API atende a execução local e a função serverless publicada na Vercel.

**Implementado:** cadastro/login profissional, pacientes e perfis, avaliações antropométricas parciais, cálculos de IMC e composição estimada, agenda com detecção de conflitos, metas, dashboard com dados persistidos, rascunhos e versionamento de planos alimentares, publicação profissional com validações e portal separado do paciente. O portal usa convite de uso único e mostra somente versões publicadas. O profissional também pode gerar um link manual de redefinição de senha para a paciente; esse link expira em 24 horas e só pode ser usado uma vez.

**Próximas etapas:** consultas ao banco filtradas por profissional com paginação, ampliação da tipagem estrita, recuperação de acesso por e-mail, notificações de publicação, relatórios exportáveis e preparação operacional para dados clínicos reais.

## Desenvolvimento local (opcional, para desenvolvedores)

As instruções desta seção servem apenas para executar uma cópia do projeto no seu computador. Para acessar o sistema publicado, use os links da seção **Acesse o NutriTrack online**.

O ambiente de desenvolvimento requer Node.js 24.x e pnpm 11.25.0, conforme `packageManager`.

```sh
pnpm install
pnpm dev
```

Após iniciar o servidor local, abra http://localhost:3000. Esse endereço funciona somente no computador que executa o projeto e não é necessário para usar a versão online. Crie uma conta profissional de desenvolvimento com senha de pelo menos 12 caracteres. `pnpm start` inicia o servidor; `pnpm test` executa os testes da API; `pnpm format` formata o código com Prettier. Sem `DATABASE_URL`, os dados locais ficam em `data/store.json`, ignorado pelo Git, e as sessões ficam em memória. Com PostgreSQL, os dados e as sessões persistem no banco, e as sessões podem ser utilizadas por diferentes instâncias da API. `.env.example` registra as variáveis lidas pelo servidor; Node.js nativo não carrega esse arquivo automaticamente.

## PostgreSQL

A versão online já utiliza PostgreSQL no Neon. Os passos abaixo são destinados a desenvolvedores que desejam configurar outro ambiente ou migrar dados.

Crie um banco dedicado para o NutriTrack e configure `DATABASE_URL` no ambiente da API. A conta do banco precisa poder criar as tabelas, índices e relacionamentos da migração, além de ler e gravar seus registros. Depois execute `pnpm start`.

Na primeira execução com o banco vazio, a API importa `data/store.json` se ele existir. Use `DATA_DIR` para indicar outra pasta que contenha esse arquivo. Pare o servidor que grava no JSON antes de iniciar a migração. O arquivo original fica disponível como cópia e não é reimportado nas próximas inicializações.

O PostgreSQL organiza profissionais, pacientes, avaliações, consultas, metas, planos, versões, contas do portal, convites, redefinições de senha e auditoria em tabelas próprias. Refeições, itens e anotações de progresso permanecem como documentos JSONB dentro do registro correspondente. Com PostgreSQL, as sessões são compartilhadas entre instâncias, expiram após oito horas e guardam somente o hash do token. Logout e troca de senha revogam o acesso. Sem `DATABASE_URL`, o ambiente de desenvolvimento continua usando o arquivo local. Em produção, configure `DATABASE_URL`.

### Migração do banco existente

Pare as instâncias antigas da API antes de iniciar esta versão. Na inicialização, a API cria as tabelas e importa o documento da tabela `nutritrack_store`. Em um banco novo, importa o arquivo `store.json` da pasta indicada por `DATA_DIR`. A migração é transacional e executada uma vez. O documento original é mantido e uma cópia também fica em `storage_migrations.legacy_snapshot`. Depois da migração, as tabelas relacionais são a fonte dos dados.

As chaves estrangeiras validam a associação entre paciente e profissional. Planos publicados referenciam versões do mesmo plano. A API grava somente os registros alterados e verifica a revisão antes de confirmar a transação. Uma gravação com revisão desatualizada recebe HTTP 409 e pode ser repetida após recarregar os dados.

A camada de compatibilidade ainda carrega o conjunto de registros para atender os endpoints existentes. Consultas por profissional com paginação são uma etapa posterior.

Para testar o banco, configure `TEST_DATABASE_URL` apontando para um PostgreSQL de testes e execute `pnpm --filter @nutritrack/api test:postgres`. A suíte cria schemas isolados com nomes aleatórios e os remove ao terminar. Ela verifica importação, reinicialização, versões, isolamento relacional, conflitos e rollback, além dos fluxos originais da API.

## Publicação na Vercel com Neon

A Vercel serve os arquivos de `apps/web/public` e encaminha `/api/*` para `api/index.js`. As rotas `/paciente`, `/paciente/ativar` e `/paciente/redefinir` carregam a interface do portal. A entrada reutiliza a mesma API compilada, com inicialização sob demanda e controle das requisições concorrentes dentro de cada instância. As sessões ficam no PostgreSQL.

Crie um projeto PostgreSQL no Neon e configure `DATABASE_URL` na Vercel usando a conexão com TLS fornecida pelo Neon. Para várias instâncias, use o endereço pooled do Neon. Guarde a URL somente no ambiente da hospedagem.

Importe o repositório na Vercel, selecione a raiz do monorepo e mantenha as configurações de `vercel.json`. O build instala as dependências de desenvolvimento com Corepack e executa diretamente o compilador TypeScript instalado no projeto. Isso evita conflito com a versão global do pnpm na hospedagem. O runtime precisa de Node.js 24. A primeira requisição à API aplica a migração do banco.

Os planos gratuitos têm cotas e podem apresentar inicialização a frio. O ambiente de avaliação deve usar dados fictícios.

## Estrutura atual

```text
api/
  index.js                      entrada serverless da Vercel
apps/
  api/
    src/server.ts               endpoints e servidor HTTP local
    src/postgres-store.ts       persistência, migração e sessões
    src/relational-schema.ts    tabelas, índices e chaves estrangeiras
    test/application.test.js    fluxos originais da API
    test/postgres.test.js       migração, sessões e execução serverless
  web/public/                   interface profissional e portal do paciente
docs/                           decisões e histórico de arquitetura
vercel.json                     build, rotas e cabeçalhos da hospedagem
```

Localmente, a API também serve os arquivos estáticos. Na Vercel, os arquivos da interface são servidos pela hospedagem e as requisições da API são encaminhadas para a função Node.js.

## Verificações realizadas

Na publicação de 22 de novembro de 2026, foram verificados:

- Compilação TypeScript e verificação de tipos.
- Teste original da API com autenticação, cadastro, avaliação, isolamento entre profissionais, planos e conflito de agenda.
- Cinco testes de integração com PostgreSQL, cobrindo migração do JSONB, preservação de versões, reinicialização, conflitos de revisão, rollback, relacionamentos por profissional, sessões e entrada serverless.
- No endereço público, cadastro de profissional, criação de paciente fictício e preservação da sessão e dos registros após recarregar a página.

Execute `pnpm typecheck` e `pnpm test` na raiz do projeto. Os testes PostgreSQL são ignorados quando `TEST_DATABASE_URL` está ausente. Para executá-los, configure um banco de testes e rode `pnpm --filter @nutritrack/api test:postgres`.

## Documentação

Os documentos abaixo registram decisões e etapas anteriores do projeto. Este README descreve o estado atual da publicação.

- [Diagnóstico do estado atual](docs/architecture/current-state.md)
- [Arquitetura alvo](docs/architecture/target.md)
- [Plano incremental de migração](docs/development/migration-plan.md)
- [ADR 0001 — monorepositório incremental](docs/decisions/0001-incremental-monorepo.md)
- [Módulo de planos alimentares — fluxo e conceitos](docs/development/meal-plans.md)
- [Portal do paciente — convite, sincronização e privacidade](docs/development/patient-portal.md)

## Segurança e limitações

A API verifica a identidade e associa os registros ao profissional autenticado. Senhas são derivadas por scrypt; o cookie de sessão é HttpOnly e SameSite=Strict. A redefinição de senha do portal é iniciada pelo profissional e compartilhada manualmente; não há envio automático por e-mail. Com PostgreSQL, as sessões são persistentes e revogáveis, com expiração de oito horas e tokens armazenados por hash. A conexão com o Neon usa TLS e é configurada em uma variável protegida na Vercel. A API inclui limite de tentativas de autenticação, validação de origem e logs sem conteúdo clínico. A ferramenta de backup criptografado foi testada com restauração em banco isolado. A ativação de backups automáticos, MFA administrativo, credenciais restritas em produção e a definição final de privacidade ainda dependem da configuração operacional. O projeto não declara conformidade automática com a LGPD.

O modo JSON é destinado ao desenvolvimento local. A demonstração pública usa PostgreSQL relacional e controle de revisão nas gravações. A API ainda carrega o conjunto de registros para preservar os endpoints existentes, e os planos gratuitos têm limites de capacidade e disponibilidade.

## Aprendizado

Fluxo atual: o navegador chama endpoints HTTP no mesmo domínio. A API valida a entrada, identifica a sessão pelo cookie, aplica o acesso do profissional ou paciente e devolve JSON. Na publicação, os registros são gravados em tabelas PostgreSQL no Neon. O teste de integração valida cadastro, cálculo, isolamento entre profissionais e conflito na agenda. A documentação de diagnóstico e o ADR explicam a primeira transição e suas consequências.

</details>
