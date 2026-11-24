# Relatório de remediação

24/11/2026. Branch `hardening/production-readiness`. Implementação local realizada; lançamento permanece bloqueado pelas dependências externas AUD-009/010. Sem deploy, serviço pago ou operação em banco real. Alterações locais anteriores preservadas no patch/hashes de evidence/pre-remediation-*; dados preexistentes não foram migrados.

## Correções e arquitetura

O rastreador individualiza todos os achados. Corrigidos DTO administrativo sem notas clínicas, reset/cadastro concorrentes, PATCH atômico, arquivamento/portal, ciclo profissional de credenciais, controle de abuso, publicação/edição concorrente, metas/dashboard, contratos, paginação, acessibilidade/CSP e reativação de agenda. A reauditoria encontrou e corrigiu também perda de metadados no editor e starvation de mensagens prontas atrás de retries SMTP.

A API Node continua principal, preservando fluxos e flag original de clínica. SQLite substitui JSON em produção: WAL/FULL, constraints/índices, transação por request, rollback e respostas somente após commit. Escritas incrementais e carga clínica por workspace evitam snapshots globais. Sessões com tokens hash são persistidas/revogadas entre reinícios. Limiter usa conexão/banco separados. Fila máxima64; registro1MiB, workspace32MiB e metadata global32MiB são limites técnicos de proteção, não planos comerciais ou capacidade demonstrada. Exige uma instância API e volume local; não suporta escala horizontal/NFS/multi-host.

Módulos novos isolam persistência, conta, SMTP, TOTP, backup e documentos legais. Verificação de e-mail exige escolher senha e limpa MFA anterior, reduzindo pre-account hijack. Reset expira/consome uma vez; troca de senha/revogação global invalidam cookies antigos. MFA TOTP usa segredo cifrado, contador antirreplay e recovery codes de uso único. Outbox SMTP cifrado oferece retry limitado e seleção de mensagens elegíveis; runtime Nodemailer real, sem envio externo nesta execução. Entrega at-least-once pode reenviar o mesmo token/messageId.

Exportações pessoal/clínica validam propriedade e minimizam campos. Exclusão imediata somente para conta sem vínculos; demais pedidos ficam rastreáveis para decisão de retenção clínica. Documentos públicos aprovados são obrigatórios no startup produtivo. Não há declaração de conformidade LGPD integral.

Python experimental recebeu DTO/status seguros, inputs estritos, locks/revisão otimista, filtros SQL/paginação, dashboard real e campos de metas persistidos. Não substitui Node comercial: equipe e novo ciclo completo de conta não têm paridade integral; perfil produtivo não usa Python.

## Dependências e migrações

Nodemailer é a nova dependência de runtime Node necessária à entrega SMTP. Ferramentas dev adicionam ESLint/TypeScript/Playwright/Axe. FastAPI/Starlette/pytest foram atualizados; testes separados do runtime Python e locks com hashes. Oito IDs únicos de advisory Python não permanecem nas árvores auditadas. Npm e pip-audit finais sem vulnerabilidades conhecidas; imagens/OS não escaneados sem Docker daemon.

SQLite schema versão1 inicializa sem apagar dados. Importador JSON aceita coleções conhecidas, IDs/referências/identidades e somente destino novo; origem intocada. Credenciais/consistência clínica legadas exigem ensaio com cópia autorizada. PostgreSQL: DDL0001 congelado;0002 campos de metas;0003 revisão de plano;0004 índices. Alembic e preservação de registro pré-migração validados em PostgreSQL16 descartável. Nenhuma migração real aplicada.

## Qualidade, performance e funções

Endpoint agregado elimina N+1 HTTP de metas; frontend segue paginação, impõe timeout e preserva revisão/metadados. UI mantém identidade visual e adiciona controles reais de conta/privacidade/MFA. Labels, contraste, reduced motion e estilos compatíveis com CSP corrigidos. Chromium1440/390 testa onboarding/paciente/metas/plano/conta; sem erros JS/CSP/overflow e sem Axe serious/critical na tela examinada. Não representa todos os dispositivos nem acessibilidade integral.

Resultado:17 Node,14 Python e2 E2E aprovados; lint/tipos/build sintático aprovados. Backup/restore cifrado e adulteração, concorrência, isolamento direto, origem, limites e sessões têm regressões. Performance exata e comandos em FINAL_TEST_RESULTS. CI com ações SHA, permissões mínimas e checkout sem credenciais persistidas; Dockerfiles nonroot/Compose/Caddy preparados, mas execução remota/imagens não comprovadas.

## Arquivos e pendências

Lista completa em evidence/changed-files.txt; patch inicial diferencia mudanças anteriores. Relatórios originais permanecem históricos. MANUAL_ACTIONS_REQUIRED contém tarefas externas não realizadas. Permanecem gates de operação, SMTP, privacidade clínica e CI/imagens. Legado não foi integralmente reescrito/tipado. Não existe billing/assinatura/webhook financeiro no produto atual: fase financeira NOT_APPLICABLE, sem criação de regras comerciais.
