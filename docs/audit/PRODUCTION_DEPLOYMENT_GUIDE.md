# Guia de implantação — PostgreSQL/Neon e Vercel

Este guia prepara uma publicação futura autorizada. Não houve deploy das correções. A main online continua na revisão anterior; push na main pode disparar Vercel automaticamente. Não publicar antes dos gates de MANUAL_ACTIONS_REQUIRED. Manter dados fictícios até homologação operacional/jurídica.

## Pré-requisitos e variáveis

Node24/pnpm11.25, banco PostgreSQL dedicado, conexão TLS validada, usuário runtime restrito e conta separada de migração/backup. Preservar Vercel/Neon/região/configuração existentes; não migrar para SQLite ou criar serviço pago. Definir ambientes distintos para local, preview/staging e produção, com bancos/secrets separados; preview nunca usa dados clínicos de produção.

Variáveis obrigatórias: DATABASE_URL do login runtime; NODE_ENV=production; APP_ORIGIN=https://dominio exato; DB_AUTO_MIGRATE=false; MAIL_ENCRYPTION_KEY32bytes hex; SMTP_HOST/PORT/USER/PASSWORD conforme relay autorizado e MAIL_FROM. Usar TLS no PostgreSQL e verificar certificado (preferir sslmode=verify-full segundo configuração do provedor). Não colocar DDL credentials na Vercel. Nenhum segredo NEXT_PUBLIC/VITE/config frontend.

Chave MAIL_ENCRYPTION_KEY protege outbox/MFA com finalidades separadas. Guardar cópia offline privada; rotação exige recifragem/re-enrollment e esvaziamento controlado da fila, não trocar sem plano. BACKUP_KEY existente tem32bytes em base64 e fica separado dos backups; BACKUP_DATABASE_URL é somente leitura. MIGRATION_DATABASE_URL existe somente no comando do operador. CRON_SECRET opcional, aleatório>=32caracteres, autoriza GET /api/jobs/mail; não é credencial do frontend. AUDIT_RETENTION_DAYS default90 é retenção técnica de eventos a revisar com responsável. .env.example só contém exemplos/vazios; Node nativo não carrega .env automaticamente.

Fornecer legal/privacy.md e legal/terms.md aprovados. Build copia somente documentos reais para apps/api/dist/legal, já incluído no pacote serverless dist/**. Alternativamente PRIVACY_POLICY_FILE/TERMS_FILE podem indicar arquivos públicos aprovados presentes no runtime. Build remove cópia compilada obsoleta se fonte ausente; startup produtivo recusa ausência/vazio, chave/origem/SMTP inválidos ou DDL automático. Não colocar dados pessoais nesses textos públicos. Verificar /privacy e /terms e a versão SHA256 retornada pela API.

## Migração segura

1. Antes de qualquer ação real: autorização do titular, janela, backup cifrado/snapshot e release anterior identificados; nenhuma operação real foi executada nesta tarefa.
2. Ensaiar cópia isolada preservando dados/contagens/IDs/versões/hash/salt. `0001-baseline.sql` é referência congelada da main anterior; não reaplicar como substituição de dados vivos.
3. Executar `pnpm install --frozen-lockfile --ignore-scripts` e `pnpm build`. Fornecer MIGRATION_DATABASE_URL somente ao processo do operador e executar `pnpm db:migrate`. CLI aplica0002-hardening em transação/advisory lock e marca versão2; em banco realmente vazio também cria marcador1. Refusa legado sem versão com dados e duplicatas de identidade entre profissionais/portal. Investigar/reconciliar em cópia autorizada, sem apagar registros para fazer migrar.
4. A expansão cria tabelas de tokens/outbox/privacidade/identidades, revisões e triggers; não remove tabelas/colunas. Tempo de locks/volume real ainda precisa ensaio. Schema testado localmente, nenhum downgrade destrutivo deve ocorrer em produção.
5. Aplicar grants atualizados em docs/security/runtime-grants.sql com proprietário autorizado, criar/vincular login runtime sem DDL/propriedade/superusuário, guardar senha no cofre. Código não cria credenciais. Testar CRUD/negação DDL com esse login em staging; conta de migração sai do runtime.
6. Confirmar marcadores1/2, constraints, identidade única, contagens por profissional e consultas tenant-scoped. Não usar DB_AUTO_MIGRATE=true em produção. JSON/legado permanece cópia histórica e precisa política de retenção; não é automaticamente reimportado ou apagado.

## Build/publicação e e-mail

Rodar todos os comandos de FINAL_TEST_RESULTS. A Vercel mantém instalação frozen-lockfile e compilação direta local via scripts/build.cjs, preservando a correção de build anterior. api/index.js continua exportando o mesmo handler. Rewrites privacy/terms acrescentados; CSP sem unsafe-inline. Conferir configuração oficial de [funções/includeFiles](https://vercel.com/docs/project-configuration/vercel-json). Não pressupor que build local valida o pacote Vercel remoto.

Configurar DNS/HTTPS no projeto existente e conferir certificado/cadeia, domínio/origem exatos, cookies Secure, redirect e headers. SMTP465 usa TLS direto,587 STARTTLS obrigatório. Configurar remetente/SPF/DKIM/DMARC segundo relay, testar entrega/verificação/reset/expiração/MFA em caixas autorizadas. Cadastro produtivo responde202 sem cookie; login de conta não verificada tem acesso somente à conta, sem clínica. Usuários legados precisam verificar e-mail; não marcar todos como verificados por SQL para contornar rollout. Comunicação/suporte e testes do canal vêm antes da migração de clientes reais.

Outbox é cifrado e persistido antes de tentar envio. Primeira tentativa ocorre após commit, fora da fila clínica; falha não perde mensagem. Preparar executor existente para retry: CLI `pnpm mail:worker` com banco runtime/key/SMTP ou GET /api/jobs/mail com Authorization: Bearer CRON_SECRET. Não foi criado agendamento/serviço externo. Frequência deve entregar dentro de1h de TTL de links; observar limites do plano [Vercel](https://vercel.com/docs/limits). Endpoint processa lote curto e recusa chamada anônima. Mensagens expiram em24h, tentativas limitadas8; erro persistente precisa alerta/reenvio humano. Entrega at-least-once pode duplicar mesma mensagem/token, sem efeito financeiro.

Somente após gates e autorização explícita promover commit/release para main/produção. Nesta execução não foi feito push na main nem deploy. Não contar a autorização antiga de publicar relatórios como autorização de alterar infraestrutura/banco.

## Backup, restore e rollback

Preservada CLI existente: `node apps/api/dist/backup.js create backups/NOVO.ntbackup`, com BACKUP_DATABASE_URL somente leitura e BACKUP_KEY no ambiente seguro. GCM autentica dados, arquivo novo/permissão restrita, leitura consistente. Copiar para destino privado independente e agendar no executor existente; retenção/RPO/RTO ainda precisam decisão e medição. Não guardar backup no Git/artefato público. Cópia inclui prontuários/hash/snapshots legados e requer controle mesmo cifrada.

Restore somente em NOVO banco/schema vazio isolado, RESTORE_DATABASE_URL correto, CONFIRM_EMPTY_RESTORE=yes e mesma BACKUP_KEY: `node apps/api/dist/backup.js restore backups/COPIA.ntbackup`. Ferramenta recusa dados existentes, usa transação/locks/constraints e invalida links de portal/tokens profissionais/outbox; não restaura sessões. Conferir contagens/IDs/ownership/planos e reemitir links necessários. Reconciliar solicitações de exclusão posteriores ao backup antes de reabrir; isso não é resolvido apenas por criptografia. Ensaio sintético passou; recuperação de host/provedor real não comprovada.

Rollback de código: guardar deployment/commit anterior e configuração compatível. Expansão não remove colunas/tabelas antigas, mas novas contas dependem de verificação/MFA/outbox: não voltar ao código antigo e deixar proteção MFA bypassada. Para emergência, interromper tráfego/autenticação e avaliar compatibilidade antes de promover release anterior. Não apagar authVersion/MFA/tokens nem executar DROP/down automático. Se precisar restaurar dados, usar destino novo e reconciliar delta com titular; perda posterior ao backup é possível. Nenhuma restauração/downgrade real foi autorizada/executada.

## Pós-deploy e monitoramento

/api/live confirma processo; /api/ready e /api/health verificam inicialização/banco com resposta mínima. Monitor externo/alertas ainda não configurados. Alertar indisponibilidade,5xx/429/503, timeout SQL, falhas/idade de outbox, backup atrasado, uso/custo do banco/limites de plano. Logs JSON têm método/status/duração/requestId, sem URL/body/cookie/PII; trilha clínica separada exige acesso/retencão.

Smoke em staging e depois no release autorizado: dois profissionais com GET/PATCH/DELETE/export cruzados negados; cookie antigo após reset/MFA/revoke negado; Origin inválida e body excessivo; plano stale428/409, publicação correta, conflito de agenda, páginas/metas, privacidade/termos, SMTP e restore. Não declarar capacidade de clientes sem carga representativa. Record1MB/orçamento32MiB por profissional/páginas200 são limites técnicos, não SLA ou plano comercial. Liberação comercial depende do parecer final e das ações externas.

CI da branch de correções: git.deploymentEnabled desabilita deploy automático apenas em hardening/production-readiness-main, conforme [configuração oficial](https://vercel.com/docs/project-configuration/git-configuration). A main mantém o comportamento anterior. Isso permite validar CI sem criar Preview com segredos/banco do ambiente.

## Estado atual da publicação — 24/11/2026

Publicado na main (código 927dc36) e na Vercel, deploy com runtime restrito dpl_64ufV5ibN1ZMXp7UGkFRy6a7k5Fc READY. Migração Neon 2 aplicada, 11 profissionais/6 pacientes preservados. SMTP, documentos e operação de backups adiados pelo responsável. 31 testes Node/PG, 2 E2E e 15 verificações HTTP externas aprovados. Consulte [NO_EMAIL_RELEASE_STATUS.md](NO_EMAIL_RELEASE_STATUS.md) e evidence/production-smoke-2026-11-24.json. As seções anteriores sobre produção intocada/pedidos de autorização são histórico anterior à publicação, não o estado atual. A nota 83,5 pertence ao pacote anterior com e-mail previsto, não foi recalculada para este modo. MAIN-002 fica BLOCKED no ambiente sem SMTP, embora MFA/senha/revogação e implementação de envio estejam testados; MAIN-008/009 continuam parciais e adiados. Estado consolidado: 11 VALIDATED, 3 BLOCKED (funcionalidades/operação/privacidade adiadas); não significa três falhas exploráveis confirmadas. Classificação INTERNAL ALPHA, sem aprovação comercial integral.
