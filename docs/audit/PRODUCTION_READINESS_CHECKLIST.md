# Checklist de prontidão para produção

24/11/2026. Parecer atual: **INTERNAL ALPHA**. “Validado” refere-se apenas ao escopo e método da evidência citada, não a certificação. “Não verificado” não significa falha confirmada. Gates condicionais aplicam-se ao backend exposto.

## Segurança da aplicação

| Requisito | Estado | Evidência / condição de aprovação |
|---|---|---|
| SQL parametrizado nos caminhos Python observados | Validado | Revisão SQLAlchemy; sem SQL dinâmico identificado. Execução DB não verificada |
| NoSQL/command injection | Não aplicável | Sem NoSQL/shell com entrada HTTP identificado |
| SSRF por URL fornecida pelo usuário | Não aplicável | Proxy usa destino do operador; reavaliar se integrações adicionadas |
| Encoding de texto/atributos na UI | Parcialmente implementado | esc/portalEsc presentes; nenhum XSS confirmado, browser não exercitado |
| Proteção de caminho estático | Validado | resolve + prefixo com separador, revisão estática |
| Upload/buckets de arquivos | Não aplicável | Nenhum fluxo implementado |
| Origem/CSRF | Parcialmente implementado | Strict + P Origin; N configuração opcional, AUD-016 |
| Headers de segurança | Parcialmente implementado | Node JSON/estáticos distintos; P depende de ingress; AUD-019 |
| Rate limit/força bruta/abuso | Parcialmente implementado | Limites locais/não atômicos, AUD-008 |
| Quotas, limite de corpo e custo por tenant | Parcialmente implementado | Node body limitado; Python dict/JSONB sem budget equivalente comprovado |
| Erros sem stack/segredo | Parcialmente implementado | Node genérico; P debug não explícito, mas HTTP/ingress não validados |
| Monitoramento de abuso e alertas de segurança | Não implementado | Não encontrado no repositório; provedor não verificado |

## APIs, autorização e isolamento

| Requisito | Estado | Evidência / condição de aprovação |
|---|---|---|
| Inventário de métodos/rotas | Validado | 47 N / 36 P de domínio/health; automáticas/estáticos separados |
| Autenticação backend das APIs privadas | Validado | Guardas revisadas; Node testes passam |
| Membership/workspace no Node | Validado | access-control + integração atual; não cobre todos os payloads possíveis |
| Isolamento dinâmico Python | Não verificado | Testes escritos, execução atual indisponível |
| Projeção administrativa sem prontuário | Parcialmente implementado | Node omite; Python falha AUD-001 |
| Clínica desligada por padrão de produção | Parcialmente implementado | Node flag existe; Python não replica gate |
| Assignment/papéis revalidados no backend | Parcialmente implementado | Node presente/testado; P estático, matriz completa pendente |
| Arquivamento bloqueia portal | Parcialmente implementado | N presente; P status divergente AUD-006 |
| Replay/consumo único transacional | Parcialmente implementado | N reset corrida confirmada; P concorrência pendente |
| Exposição de OpenAPI/docs intencional | Parcialmente implementado | P desliga /docs, deixa /redoc e /openapi.json defaults |
| Exportações, arquivos, jobs e caches isolados | Não aplicável | Fluxos não implementados; não confundir com segurança futura comprovada |

## Identidade e conta

| Requisito | Estado | Evidência / condição de aprovação |
|---|---|---|
| Senhas derivadas com salt | Validado | N scrypt; P Argon2id, revisão estática |
| Token/sessão com entropia adequada | Validado | 32 bytes aleatórios e separação de principal |
| TTL absoluto no servidor Node | Validado | Teste de expiração integra suíte que passou |
| TTL/revogação persistente Python | Parcialmente implementado | Código/testes presentes; execução atual não verificada |
| Cookie HttpOnly/Strict | Validado | Código de ambos; configuração real do domínio não verificada |
| Secure/HTTPS em produção | Não verificado | Defaults/gates existem; TLS/ingress externo pendente |
| Logout/revogação de sessão corrente Node | Validado | Integração atual, inclusive idempotência |
| Reset paciente | Parcialmente implementado | Manual, AUD-002/012, sem e-mail automático |
| Recuperação/troca de senha profissional | Não implementado | AUD-007 |
| Prova de propriedade do e-mail | Não implementado | AUD-007 |
| MFA e recuperação correspondente | Não implementado | Priorizar clínico/admin segundo gate aprovado |
| Revogação global profissional operável | Não implementado | AUD-007 |
| Identidade única sob concorrência | Parcialmente implementado | Constraint Python; N duplicação confirmada AUD-003 |
| Exclusão de conta e dados | Não implementado | Definir retenção de prontuário antes de exclusão indiscriminada |

## Banco, persistência e migração

| Requisito | Estado | Evidência / condição de aprovação |
|---|---|---|
| Backend transacional único de produção | Parcialmente implementado | P paralelo incompleto; N JSON ativo |
| FKs/unicidade/índices PostgreSQL | Parcialmente implementado | Modelos presentes, schema efetivo não verificado |
| RLS/grants/usuário mínimo DB | Não verificado | Não declarados no schema do repo; estado real desconhecido |
| Migrações reproduzíveis | Parcialmente implementado | Metadata mutável AUD-017 |
| Importação/reconciliação de dados Node → Python | Não implementado | AUD-014; nenhum dado real migrado nesta auditoria |
| Mutação inválida sem efeitos | Parcialmente implementado | N PATCH falha AUD-005 |
| Edição/publicação concorrentes sem lost update | Não verificado | AUD-012; testes multi-conexão necessários |
| Conflito de criação de agenda | Parcialmente implementado | Node integração passa; P advisory lock estático |
| Conflito ao reativar e prestador em clínica | Parcialmente implementado | AUD-023 e ausência de prestador explícito ao agendar por assistente |
| Criptografia de volume/backup e TLS DB | Não verificado | Depende de infraestrutura |
| Backup periódico externo e restore | Não verificado | Só instruções/cópia local; AUD-009 |
| Retenção/expurgo de sessões/tokens/hits | Não implementado | Sem job/política identificados |

## Funcionalidades e experiência

| Requisito | Estado | Evidência / condição de aprovação |
|---|---|---|
| Fluxos individuais Node por integração | Validado | Suíte atual 3/3; não valida browser |
| Paridade frontend/Python | Parcialmente implementado | AUD-006/014/022 |
| Dashboard Python com dados reais | Parcialmente implementado | Métricas/histórico fixos AUD-014 |
| Metas preservam campos aceitos Python | Parcialmente implementado | Prazo/categoria descartados AUD-014 |
| Publicação completa do plano | Parcialmente implementado | N every; P any, AUD-011 |
| Estados vazios/loading/retry | Validado | Código da UI; comportamento visual não verificado |
| Erros úteis e contratos consistentes | Parcialmente implementado | error vs detail; AUD-022 |
| Acessibilidade de formulários/foco | Parcialmente implementado | AUD-018; toast/focus CSS já presentes |
| Responsividade/cross-browser/contraste | Não verificado | Breakpoints presentes, sem exercício visual |
| CSP compatível com layout/gráficos | Parcialmente implementado | AUD-019 |
| Links críticos e guardas de rascunho em browser | Não verificado | Navegação real/unsaved changes pendentes |
| Gateway/assinaturas/webhooks/entitlements | Não aplicável | Não implementados; não vender automação financeira inexistente |
| E-mail/notificações automáticas | Não implementado | Convites/reset compartilhados manualmente |

## Dependências, qualidade e operação

| Requisito | Estado | Evidência / condição de aprovação |
|---|---|---|
| Audit npm exato do lockfile | Validado | 0 advisories; uma dependência dev |
| Auditoria direta Python | Validado | 9/9 avaliadas, um CVE deduplicado em pytest; validado não significa sem achados |
| Transitivas Python/imagem/SBOM | Não verificado | Sem lock resolvido/imagem construída |
| Runtime sem ferramentas de teste | Não implementado | requirements único e COPY tests no Dockerfile |
| Busca de segredos/variáveis/histórico | Parcialmente implementado | Busca limitada 12 commits/88 blobs; sem correspondências; não scanner universal |
| Lint/formatação | Parcialmente implementado | Prettier presente, check falha; sem lint semântico |
| Testes unitários Node | Validado | 2/2 |
| Integração Node | Validado | 1/1 com muitas assertions |
| Integração/migration Python atual | Não verificado | Docker daemon ausente e módulos não instalados |
| Concorrência/replay/regressão por achado | Parcialmente implementado | Probes confirmam defeitos; faltam testes permanentes/gates |
| E2E, carga, failover, restore | Não verificado | Não executados |
| CI/CD obrigatório e rollback | Não implementado | Nenhum workflow/pipeline no repo; deploy externo não verificado |
| Monitoramento, alertas e logs centrais | Não verificado | Sem implementação/configuração encontrada |
| Healthcheck | Parcialmente implementado | P /health SELECT 1; N sem readiness próprio; schema não checado |
| Política, termos, direitos e terceiros | Não implementado | Ciclo técnico ausente; jurídico não avaliado |

## Gate de decisão

Para CLOSED BETA com dados reais, todos os P0 e os P1 aplicáveis ao escopo precisam passar em staging, com evidências de isolamento, recuperação, privacidade, suporte e monitoramento. Para PRODUCTION READY, validar também SLO/carga do escopo vendido, operação recorrente e fluxo comercial efetivo. A auditoria atual não autoriza mudar código ou publicar.
