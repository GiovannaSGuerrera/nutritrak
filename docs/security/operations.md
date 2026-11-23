# Operação e recuperação

## Situação em 23/11/2026

O Neon mostrou janela de histórico de seis horas. Foi criado um snapshot manual de `production`, identificado por `2026-11-23 22:06:33 UTC`. O painel confirmou um snapshot e nenhum agendamento; o plano gratuito exige upgrade para agendar snapshots. Nenhuma restauração ou exclusão foi feita em produção.

Os grupos `nutritrack_runtime` e `nutritrack_backup` foram aplicados em produção com autorização do titular. A consulta no Neon confirmou NOLOGIN, sem superusuário, criação de bancos, criação de papéis ou CREATE no schema public. A aplicação ainda usa a conexão anterior: faltam os logins dedicados e a troca de DATABASE_URL. MFA das contas administrativas e alertas externos não foram confirmados.

## Separar execução e migração

1. Aplicar a versão nova com a credencial atual para criar `auth_rate_limits`.
2. Com o proprietário, aplicar `runtime-grants.sql`. Criar logins dedicados, com senhas guardadas em cofre, e vincular os grupos correspondentes. Não criar logins pelo console Neon que herdem privilégios administrativos sem revisar a herança.
3. Conferir que o login da aplicação não é proprietário, não tem CREATE no schema, não é membro de `neon_superuser` e não acessa outros bancos. Testar CRUD e negação de DDL em homologação.
4. Trocar `DATABASE_URL` na Vercel pelo login restrito; definir `DB_AUTO_MIGRATE=false` e `APP_ORIGIN=https://nutritrack-eta-ten.vercel.app`. Nunca expor essas URLs no frontend.
5. Publicar, conferir `/api/health` e testar login. Guardar a credencial de migração fora do runtime. Novas alterações de schema devem ser aplicadas antes da publicação correspondente.

`DB_AUTO_MIGRATE=false` deixa a inicialização somente com leitura dos dados; não tenta criar tabelas. Isso não substitui a restrição real dos privilégios.

## Backup independente

Ferramenta: `apps/api/src/backup.ts`, compilada para `apps/api/dist/backup.js`.

Configurar `BACKUP_DATABASE_URL` com conta somente leitura e `BACKUP_KEY` com chave aleatória de 32 bytes em base64. Guardar a chave em cofre separado dos arquivos; perdê-la impede recuperar as cópias. Nunca imprimir a chave em logs. Criar uma pasta protegida fora do repositório ou `backups/`, que é ignorada pelo Git.

```sh
pnpm build
node apps/api/dist/backup.js create backups/copia.ntbackup
```

A ferramenta usa uma transação de leitura consistente e criptografia autenticada AES-256-GCM. O arquivo contém dados pessoais e hashes de senha, mesmo criptografado. Não enviar como artefato público ou guardar em GitHub. Não inclui sessões nem limites de acesso. A restauração revoga convites e links de recuperação; usuários precisam entrar novamente e solicitar novos links.

Para ensaio, criar banco isolado vazio, definir `RESTORE_DATABASE_URL`, a mesma `BACKUP_KEY` e `CONFIRM_EMPTY_RESTORE=yes`. Nunca usar o endereço de produção.

```sh
node apps/api/dist/backup.js restore backups/copia.ntbackup
```

A restauração recusa tabelas com dados e faz rollback em erro. É uma cópia lógica das tabelas conhecidas desta versão, não um dump completo de papéis, extensões ou infraestrutura. Ao adicionar tabelas ou alterar o schema, atualizar e testar a ferramenta.

Proposta operacional a aprovar: cópia diária criptografada em armazenamento privado externo, retenção de 30 dias e ensaio mensal de restauração. Por decisão do titular nesta etapa, manter o snapshot manual e definir o armazenamento automático depois. A rotina não está agendada; falta escolher o armazenamento e configurar um executor que funcione sem este computador ligado. Meta inicial de perda máxima de 24 horas depende desse agendamento, e o tempo de recuperação precisa ser medido no volume real.

## Monitoramento e manutenção

`GET /api/health` responde apenas `{ "ok": true }` depois de verificar o banco. Logs estruturados registram código HTTP, método, duração e ID de requisição, sem URL, corpo, cookie, e-mail, IP ou informação clínica. O evento `auth_rate_limited` identifica bloqueios. Os eventos clínicos existentes continuam limitados aos últimos 500 registros; ainda não são uma trilha imutável de longa duração.

Configurar um monitor externo autorizado para o endpoint a cada cinco minutos, com alerta após duas falhas. Não incluir tokens nem dados pessoais no monitor. Definir destinatário e confirmar entrega de um alerta de teste; ainda pendente. A disponibilidade não depende de usar o monitor para impedir suspensão do plano gratuito.

Revisar semanalmente erros 5xx, picos de 429, membros das contas e avisos de dependências. O arquivo Dependabot propõe revisões semanais; alertas e atualizações de segurança também devem ser habilitados nas configurações do GitHub. `pnpm audit --prod --json` consultado nesta etapa retornou zero avisos, o que não garante ausência de vulnerabilidades.

MFA: o titular deve ativar um autenticador ou chave de segurança no GitHub, Vercel e Neon ou no provedor de identidade utilizado. Guardar códigos de recuperação em cofre e remover acessos antigos. Não compartilhar senhas, códigos temporários ou QR codes no chat.

Referências: [Neon, histórico de recuperação](https://github.com/neondatabase/website/blob/main/content/docs/postgres/backup-restore/history-window.md), [Neon, planos](https://github.com/neondatabase/website/blob/main/content/docs/introduction/plans.md).
