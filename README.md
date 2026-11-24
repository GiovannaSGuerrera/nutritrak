# NutriTrack

O NutriTrack ajuda nutricionistas a organizar pacientes, registrar avaliações, cuidar da agenda, acompanhar metas e publicar planos alimentares. O paciente acessa um portal separado para consultar o plano publicado pelo profissional.

- [Abrir o NutriTrack](https://nutritrack-eta-ten.vercel.app/)
- [Acessar o portal do paciente](https://nutritrack-eta-ten.vercel.app/paciente)

## Estado da publicação

Atualizado em **24 de novembro de 2026**. As correções de segurança e os ajustes da interface já estão na `main` e publicados na Vercel. O banco PostgreSQL do Neon recebeu a migração de hardening, com preservação dos registros existentes e conexão de produção com permissões restritas.

**Classificação: INTERNAL ALPHA.** Estar publicado não equivale a ter prontidão comercial completa. SMTP, documentos legais aprovados, operação de backups e recuperação real continuam pendentes. Para avaliação, utilize dados fictícios; o projeto não declara conformidade integral com a LGPD nem capacidade comercial comprovada.

## Funcionalidades disponíveis

- Cadastro e login profissional com senha de 12 a 200 caracteres.
- Cadastro de pacientes, perfis, avaliações e estimativas de composição corporal.
- Agenda com verificação de conflitos de horário e metas com acompanhamento de progresso.
- Planos alimentares com rascunhos, versões, publicação e controle de revisão para evitar sobrescritas.
- Portal do paciente com convite de uso único e acesso apenas aos planos publicados.
- Link manual de redefinição da senha do portal, gerado pelo profissional.
- Exportação de dados da conta e de pacientes, respeitando a propriedade dos registros.
- Troca de senha com encerramento de sessões e solicitação de exclusão sujeita à retenção clínica.
- Autenticação em duas etapas opcional por aplicativo autenticador, com códigos de recuperação.

No login comum, os campos do autenticador ficam ocultos. Só aparecem após a validação da senha de uma conta que já exige segundo fator. Na página de segurança, a configuração adicional fica recolhida por padrão para contas sem MFA.

## Envio de e-mail e pendências

A produção opera com `EMAIL_ENABLED=false`: **não há envio de e-mails, verificação de endereço ou recuperação de senha profissional por e-mail**. Os endereços cadastrados não são marcados automaticamente como verificados. Mantenha sua senha guardada; se ativar MFA, guarde também os códigos de recuperação. A redefinição manual do portal do paciente é um fluxo separado.

Os documentos legais foram adiados (`LEGAL_DOCUMENTS_REQUIRED=false`). As rotas de documentos ausentes retornam indisponibilidade explícita. Também estão adiados backups independentes agendados e restauração real. Essas decisões não eliminam os riscos de privacidade, perda de acesso e recuperação de dados.

Veja o [estado da publicação sem SMTP](docs/audit/NO_EMAIL_RELEASE_STATUS.md) e as [ações manuais remanescentes](docs/audit/MANUAL_ACTIONS_REQUIRED.md).

## Arquitetura e proteções

| Camada | Tecnologia / comportamento |
|---|---|
| Interface | HTML, CSS e JavaScript, com layout responsivo |
| API | Node.js e TypeScript; mesma implementação local e serverless |
| Persistência online | PostgreSQL no Neon, conexão pooled com TLS |
| Hospedagem | Vercel; arquivos estáticos e função `api/index.js` |
| Sessões | PostgreSQL, tokens armazenados por hash, expiração e revogação |
| Isolamento | Autorização no servidor e consultas filtradas pelo profissional |
| Integridade | Chaves estrangeiras, transações e revisão otimista por registro |
| Proteções HTTP | Validação de origem/entrada, limites de corpo e tentativas, timeouts e cabeçalhos de segurança |

Os cookies de produção usam `HttpOnly`, `Secure` e `SameSite=Strict`. Senhas são derivadas com scrypt. Os testes incluem chamadas diretas à API com profissionais distintos. O isolamento atual é aplicado na API e nos relacionamentos; não se afirma RLS por profissional.

## Executar localmente

Requisitos declarados no projeto: **Node.js 24.x** e **pnpm 11.25.0**.

```sh
corepack pnpm install --frozen-lockfile
pnpm dev
```

Abra [localhost:3000](http://localhost:3000). Sem `DATABASE_URL`, o modo de desenvolvimento usa `data/store.json` e sessões em memória. Esse modo não é aceito em produção.

Consulte [.env.example](.env.example) e configure as variáveis no ambiente do processo. O servidor não carrega `.env` automaticamente. O exemplo não contém credenciais reais. Para usar um arquivo local, carregue-o explicitamente com um mecanismo compatível com seu ambiente e mantenha-o fora do Git.

## Banco e produção

A produção usa `DB_AUTO_MIGRATE=false`: **a API não aplica migrações na primeira requisição**. Execute a migração com uma conexão administrativa separada, em ambiente autorizado, após validar os dados e o procedimento em ambiente isolado:

```sh
pnpm db:migrate
```

Esse comando exige `MIGRATION_DATABASE_URL`. A aplicação usa `DATABASE_URL` de um login restrito; nunca disponibilize a conexão administrativa ao frontend ou ao runtime. Migração não substitui backup.

| Variável | Uso |
|---|---|
| `DATABASE_URL` | Conexão protegida do runtime PostgreSQL |
| `APP_ORIGIN` | Origem HTTPS autorizada em produção |
| `DB_AUTO_MIGRATE` | `false` em produção; migrações explícitas |
| `MAIL_ENCRYPTION_KEY` | Chave privada de 32 bytes em hexadecimal; também protege os segredos de MFA, mesmo sem SMTP |
| `EMAIL_ENABLED` | `false` na publicação atual; o padrão do código é habilitado |
| `LEGAL_DOCUMENTS_REQUIRED` | `false` na publicação atual; o padrão exige documentos |
| `MIGRATION_DATABASE_URL` | Somente para o processo autorizado de migração |

Para habilitar e-mail futuramente, configure o relay, remetente e demais variáveis SMTP descritas no exemplo, teste a entrega e planeje a verificação das contas existentes antes de alterar `EMAIL_ENABLED`. Para exigir documentos, forneça `legal/privacy.md` e `legal/terms.md` aprovados antes de ativar `LEGAL_DOCUMENTS_REQUIRED`.

A Vercel serve `apps/web/public` e encaminha `/api/*` à função Node.js. A `main` dispara publicação automática; a branch `hardening/production-readiness-main` tem deploy automático desativado. Não compartilhe o banco produtivo com previews. As rotas `/api/live`, `/api/health` e `/api/ready` permitem verificar vida e disponibilidade da API/banco.

## Verificações

```sh
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
```

Para executar todos os testes PostgreSQL, use **exclusivamente um banco descartável com nome terminado em `_test`**. Configure `TEST_DATABASE_URL` e `TEST_DATABASE_CONFIRM=disposable`, e execute:

```sh
pnpm test:ci
```

A suíte cria e remove schemas de teste; nunca aponte essas variáveis para produção. Sem banco de testes, `pnpm test` ignora os casos PostgreSQL; `pnpm test:ci` exige a configuração.

Validações registradas em 24/11/2026: **31 testes Node/PostgreSQL**, **4 fluxos E2E** em larguras de 1440, 1024, 768 e 390 pixels, lint, tipos e build aprovados. Os fluxos E2E verificam cadastro, paciente, edição/publicação de plano e conta, incluindo ausência de overflow e verificações Axe/CSP. As **15 verificações HTTP anônimas em produção** passaram; elas não substituem homologação clínica ou uma sessão autenticada real.

Para repetir o smoke anônimo, sem cadastrar contas ou acessar prontuários:

```sh
node scripts/production-smoke.cjs https://nutritrack-eta-ten.vercel.app
```

## Documentação

- [Guia de implantação](docs/audit/PRODUCTION_DEPLOYMENT_GUIDE.md)
- [Correções e acompanhamento](docs/audit/REMEDIATION_TRACKER.md)
- [Relatório de segurança](docs/audit/FINAL_SECURITY_REPORT.md)
- [Resultados dos testes](docs/audit/FINAL_TEST_RESULTS.md)
- [Parecer de prontidão](docs/audit/FINAL_PRODUCTION_READINESS_REPORT.md)
- [Manual SQL](docs/development/manual-sql.md)
- [Planos alimentares](docs/development/meal-plans.md)
- [Portal do paciente](docs/development/patient-portal.md)

Os relatórios preservam o histórico da auditoria. Consulte as atualizações finais e o estado da publicação sem SMTP para distinguir a implementação disponível das pendências operacionais atuais.
