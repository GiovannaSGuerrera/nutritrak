# Guia de implantação e recuperação

Preparação para futura implantação autorizada. Nenhum deploy realizado. Resolver MANUAL_ACTIONS_REQUIRED antes de dados reais.

## Pré-requisitos e configuração

Host Linux com Docker Compose, disco local persistente protegido, backup independente e domínio controlado. Arquitetura: uma API Node>=24.15, worker SMTP e Caddy. API não publica porta no host; somente Caddy80/443. Não usar NFS, múltiplos hosts ou réplicas API. Limites768MiB/API e128MiB/worker são configuração inicial a medir, não capacidade garantida. Python/PostgreSQL permanece experimental fora deste perfil.

Copiar .env.example para ambiente protegido/secret manager, nunca commitar valores. Definir DOMAIN, MAIL_ENCRYPTION_KEY32bytes hex, SMTP_HOST/PORT/USER/PASSWORD e MAIL_FROM.465 TLS direto;587 STARTTLS obrigatório. Guardar chave offline: MFA/outbox dependem dela; rotação exige recifragem/re-enrollment planejado. BACKUP_ENCRYPTION_KEY distinta,32bytes hex, fora dos backups; perda impede recuperação. Nunca imprimir chaves em logs CI.

Compose fixa NODE_ENV=production, STORE_BACKEND=sqlite, DATA_DIR=/srv/data, PUBLIC_ORIGIN/CORS_ORIGINS=https://DOMAIN e TRUST_PROXY=1. Somente usar com app inacessível diretamente e um proxy confiável; sem proxy usar TRUST_PROXY=0. AUDIT_RETENTION_DAYS default90 requer decisão do controlador. Fornecer legal/privacy.md e terms.md aprovados, montados read-only. Ausência impede startup. Não colocar dados privados em políticas públicas.

## Dados e migrações

1. Congelar escrita, preservar JSON original com hash e release anterior em cópia protegida.
2. Ensaiar cópia isolada: `pnpm storage import-json CAMINHO_JSON NOVO_DIRETORIO`. Não sobrescreve DB existente; valida coleções/IDs/referências/identidades. Falhas exigem reconciliação autorizada, não excluir registros automaticamente. Nenhum dado real foi importado nesta execução.
3. Iniciar Node isolado na cópia SQLite. Comparar contagens por coleção/tenant, credenciais, atribuições, planos publicados e exportações. Validar formatos legados de credenciais; sessões JSON não são importadas e usuários relogam.
4. Executar backup/restore cifrado, checks e smoke. Conferir ACL/owner UIDnode; named volume vazio herda diretório preparado da imagem, volume existente requer revisão de permissões sem acesso global.
5. Só após autorização transferir conjunto validado para clinical_data com serviço parado. Não copiar apenas .sqlite durante escrita: WAL contém transações recentes. Usar backup online ou parada/checkpoint controlados.

SQLite schema_version1 inicializa sem drops. Mudança futura exige migração versionada, ensaio e backup. Não trocar backend sem homologação. Python experimental usa banco separado e `alembic upgrade head`0001–0004; não usar autogenerate/create_all em produção. Downgrades que removem campos perdem informações: preferir restore em banco novo e reconciliação; não executar downgrade destrutivo em banco real.

## Build, domínio e serviços externos

Executar `pnpm install --frozen-lockfile --ignore-scripts` e comandos do FINAL_TEST_RESULTS. Em Linux isolado executar `docker compose -f docker-compose.production.yml config --quiet` e `docker compose -f docker-compose.production.yml build`. Escanear imagens/OS e fixar tags/digests do release aprovado. Validar staging antes de promover. Somente com autorização explícita executar `docker compose -f docker-compose.production.yml up -d`; não foi executado aqui. Tags base Node24/Caddy2 exigem revisão por release.

DNS A/AAAA para host e80/443 liberadas permitem Caddy emitir/renovar HTTPS. Demais portas privadas. Confirmar cadeia/certificado, redirect/HSTS e ausência de bypass. Configurar SMTP/remetente/SPF/DKIM/DMARC conforme relay. Testar verificação/reset/expiração/MFA em caixas autorizadas; não enviar mensagens a clientes reais em homologação.

## Backup e restauração

`pnpm storage backup-encrypted DIRETORIO_DADOS NOVO_ARQUIVO.enc`, com BACKUP_ENCRYPTION_KEY no ambiente seguro, cria backup online autenticado. Copiar para destino independente com acesso mínimo; agendar na infraestrutura existente e alertar falha/idade. Retenção/RPO/RTO ainda são decisões operacionais, não garantias. Backup plaintext existe para diagnóstico e precisa volume protegido e descarte controlado.

`pnpm storage restore-encrypted BACKUP.enc NOVO_DIRETORIO` recusa destino existente e valida GCM/integridade/FKs. Conferir com `pnpm storage verify NOVO_DIRETORIO/nutritrack.sqlite`. Validar contagens/tenant/login/portal/publicação em isolamento. Sessões/tokens estão na cópia: invalidá-los antes de reabrir evita reativar credenciais antigas. Reconciliar exclusões ocorridas após backup e reenviar links novos. Guardar backup/volume anterior. limits.sqlite é recriado; reforçar ingress na recuperação. Ensaio sintético local aprovado; host real não ensaiado.

O restore-encrypted invalida automaticamente sessões e credenciais efêmeras (authTokens, patientInvitations, patientPasswordResets, workspaceInvitations e mailOutbox) somente na NOVA cópia restaurada, em transação, após validar integridade. Teste de regressão confirma remoção de tokens antigos e preservação do paciente. Não remove usuários, memberships ou prontuários. A origem/produção nunca é alterada pelo restore. Reemitir convites/links necessários após homologação.

## Rollback e pós-deploy

Guardar imagem/configuração anterior compatível com schema. Interromper ingresso de escrita, criar backup atual, executar imagem anterior somente se compatível; caso contrário restaurar backup em volume novo isolado e reconciliar delta com responsável. Pode haver perda de dados posteriores ao backup: não automatizar rollback destrutivo. Nunca substituir volume vivo ou executar drop/down -v. Ensaiar staging e obter autorização para ações reais.

Verificar /health, /ready (SQLite), worker heartbeat<60s, logs JSON sem PII, disco/memória/filas e idade de backups. Ligar alertas existentes para indisponibilidade, reinícios, falhas SMTP, disco baixo e backup atrasado. Monitoramento externo não configurado. Smoke pós-deploy: usuárioA/B, ownership GET/PATCH/DELETE, origem rejeitada, conta não verificada negada, cookies Secure, reset/MFA/recovery, expectedRevision, agenda e recuperação. Qualquer falha bloqueadora fecha gate. Avaliação técnica não substitui jurídica/clínica.
