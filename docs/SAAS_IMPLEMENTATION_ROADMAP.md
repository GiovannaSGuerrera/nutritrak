# Roadmap de implementação SaaS — NutriTrack

**Status:** sequência proposta, não autorização para implementar.  
**Princípio:** preservar fluxos atuais, reduzir risco de integridade/autorização antes de comercializar e manter entregas reversíveis.

## Princípios e portas

1. Não usar dados reais de saúde antes de cumprir critérios de piloto da auditoria e revisão competente de segurança/privacidade.
2. Decisões de tenant, papel, vínculo de paciente e retenção são gates de schema, não defaults técnicos implícitos.
3. Não trocar Node/framework/frontend em conjunto com persistência. API permanece autoridade.
4. Cada fase tem migration reversível ou estratégia forward-fix aprovada; nunca descartar JSON automaticamente.
5. Testes listados são testes a criar quando a fase for autorizada; nenhum foi executado por este plano.

## Fase 0 — Decisões de produto e domínio

- **Objetivo:** aprovar o modelo de SaaS necessário para schema e autorização.
- **Módulos/documentos:** ADRs em `docs/decisions/`, `docs/DATABASE_DESIGN.md`, políticas do portal.
- **Dependências:** proprietária e responsáveis por produto/privacidade/operação.
- **Alterações previstas:** definir tenant, cobrança, papéis, múltiplos consultórios, pacientes compartilhados/transferidos, ciclo de vínculo, acesso do paciente, retenção/exportação/exclusão, autenticação profissional e escopo do piloto.
- **Testes/verificação:** walkthrough de matriz recurso × papel × operação; cenários de transferência, cancelamento e conta encerrada.
- **Riscos:** decisões incompletas geram schema incompatível ou privilégio excessivo.
- **Aceitação:** ADRs aprovados e regras sem ambiguidade; nenhum `tenant_id` assumido a partir de payload.
- **Rollback:** não há migração; revisar ADR e bloquear fases dependentes.

## Fase 1 — Baseline de comportamento e ameaça

- **Objetivo:** tornar os fluxos existentes verificáveis antes de trocar armazenamento.
- **Arquivos:** `apps/api/test/application.test.js`; módulos novos de teste; `docs/SAAS_READINESS_AUDIT.md` como baseline.
- **Dependências:** pode iniciar parcialmente antes da fase 0; matriz final espera as decisões.
- **Alterações previstas:** cobertura por rota/método/papel para profissional e paciente; IDs de outra pessoa; paciente incompatible; portal sem rascunhos/notas; convite/reset expirado/reusado; concorrência em agenda e e-mail; falha de persistência; validação de entrada; logs. Não mudar comportamento sem fix documentado.
- **Testes necessários:** testes de integração com fixtures fictícias e `node:test`; baseline dos fluxos de cadastro, avaliação, metas, agenda, publicação/versionamento, convite e portal.
- **Riscos:** testes podem consolidar comportamento inseguro; revisar threat model antes de tratar legado como contrato.
- **Aceitação:** matriz cobre todas as rotas atuais, casos positivos/negativos e lacunas registradas; execução reproduzível local/CI planejada.
- **Rollback:** testes são removíveis/revisáveis; mudanças de comportamento ainda separadas e reversíveis.

## Fase 2 — Modularização incremental da API

- **Objetivo:** separar responsabilidades sem alterar protocolo/fluxos deliberadamente.
- **Arquivos:** extrair de `apps/api/src/server.js` para `http/`, `auth/`, `domain/`, `application/`, `persistence/`, `audit/` conforme tamanho real; manter bootstrap e roteamento simples.
- **Dependências:** baseline fase 1; decisões de papéis orientam autorização.
- **Alterações previstas:** primeiro funções puras (antropometria, agenda, versão de plano); depois casos de uso; criar um ponto único de autorização contextual e interface de repositório; JSON implementa adaptador temporário. Não criar pacote compartilhado vazio.
- **Testes necessários:** equivalência de comportamento; testes unitários de domínio; negativos de propriedade; regressões de DTO portal.
- **Riscos:** extração parcial duplica lógica ou muda semântica; evitar troca de armazenamento dentro da mesma mudança.
- **Aceitação:** handlers não acessam arrays/store diretamente após a fase; regras de domínio testáveis; contratos HTTP essenciais preservados.
- **Rollback:** reverter extrações por módulo, mantendo testes e decisões aprovadas.

## Fase 3 — Segurança de identidade e abuso

- **Objetivo:** eliminar bloqueios P0/P1 de sessão e endpoints públicos antes do piloto.
- **Arquivos/módulos:** `auth/`, sessões, middleware HTTP, configuração, logs e adaptadores e-mail; futuras migrations de sessão/token.
- **Dependências:** threat model e escolha de ambiente; pode correr em paralelo com fase 2, mas requer banco compartilhado para multi-instância.
- **Alterações previstas:** sessão opaca persistente com hash do token, expiração server-side absoluta/ociosa, revogação e rotação; limite login/cadastro/convite/reset; respostas uniformes; comparação de credencial segura, limite de senha; recuperação de profissional e e-mail se aprovados; CSRF/Origin/CORS segundo domínio; logs sem query sensível; configuração fail-fast. Rate limit deve sobreviver a múltiplas instâncias.
- **Testes necessários:** expiração/revogação/restart/duas instâncias, limites e concorrência, conta inexistente/existente, token único simultâneo, cookies de produção, CSRF/origin, logs sem segredo.
- **Riscos:** perda de sessão planejada ao migrar; fornecedor de e-mail indisponível; rate limit mal configurado bloqueia usuários legítimos.
- **Aceitação:** controles testados e operacionais; sessões não vivem apenas em `Map`; rotas públicas monitoradas.
- **Rollback:** migration aditiva, versão anterior compatível durante rollout; rollback de código sem remover/reverter dados de sessão. Plano de login novamente se política exigir.

## Fase 4 — PostgreSQL e schema tenant-aware

- **Objetivo:** substituir JSON por persistência transacional.
- **Arquivos/módulos:** `apps/api/src/persistence/`, migrations versionadas, config, repositórios; eventual ferramenta de dev/CI. `docs/DATABASE_DESIGN.md` guia a revisão.
- **Dependências:** decisão de tenant (fase 0), repositórios modularizados (fase 2), escolha documentada de driver/ORM, ambiente PostgreSQL efêmero.
- **Alterações previstas:** criar schema com FK/unique/checks tenant-aware; pools com limites; transações para convite, reset, publicação e agenda; constraints para e-mail e conflitos; seeds exclusivamente sintéticos. Não alterar stack de frontend/runtime.
- **Testes necessários:** migrations do zero e upgrade, constraints, rollback transacional, isolamento tenant, conexão pooled/RLS se adotada, concorrência e falha DB.
- **Riscos:** schema errado força migração futura; lock/índice afeta disponibilidade; RLS mal configurada cria falso senso de segurança.
- **Aceitação:** todos os fluxos em staging usam PostgreSQL; constraints impedem referência cruzada; teste multi-instância; backup/restore técnico validado.
- **Rollback:** migrations aditivas compatíveis; retorno de release somente se código pode ler versão anterior; não fazer downgrade destrutivo de dados.

## Fase 5 — Importação e cutover

- **Objetivo:** migrar apenas dados cuja origem e destino foram reconciliados.
- **Arquivos:** ferramenta isolada de importação, relatórios protegidos/runbook; `docs/MIGRATION_PLAN.md`.
- **Dependências:** fase 4, origem autorizada, backup restaurado, regra de credencial/token e janela aprovados.
- **Alterações previstas:** dry-run, import idempotente com UUIDs, expansão de versões/metas, exceções explícitas, import final sob congelamento de escrita. Sessões em memória não migram; tokens pendentes tratados conforme decisão.
- **Testes necessários:** fixtures sintéticas com órfãos/duplicatas, segunda execução, checksum/contagens, versão publicada, restauração e rollback praticado.
- **Riscos:** arquivo incompleto/inconsistente, conflito de email, apontador de versão perdido, rollback com escrita divergente.
- **Aceitação:** relatório conciliado e aprovado; FKs sem órfãos; backup antes/depois; restore dentro de RPO/RTO; nenhum dado descartado sem aceite.
- **Rollback:** gatilhos predefinidos; antes de escrita, reabrir origem preservada; após escrita, corrigir para frente ou reconciliar delta, nunca voltar silenciosamente ao snapshot antigo.

## Fase 6 — Operação de produção e privacidade

- **Objetivo:** demonstrar que o serviço pode operar, recuperar-se e responder a incidentes.
- **Arquivos:** pipeline CI/CD, configuração de deploy/IaC conforme escolha, runbooks, alertas, política de logs/backups e documentação de privacidade.
- **Dependências:** fases 3–5; seleção de provedor baseada em critérios e aprovação de região/custos.
- **Alterações previstas:** dev/staging/prod separados; segredos geridos; HTTPS/TLS; backups criptografados/PITR; restore periódico; health/readiness checks; logs estruturados minimizados; alertas e inventário de dependências; resposta a incidente; controles de acesso operador.
- **Testes necessários:** restore cronometrado, falha de DB/email, rotação de segredo, rollback de release, alerta de backup, smoke por ambiente, revisão de acesso.
- **Riscos:** configuração externa divergente da documentação; alertas sem responsável; custo de retenção.
- **Aceitação:** runbooks exercitados, RPO/RTO aprovados e cumpridos, pessoas de plantão/responsabilidade definidas; configuração real auditável.
- **Rollback:** deploy canário/gradual quando suportado; release anterior compatível com schema; restauração isolada e plano de comunicação aprovado.

## Fase 7 — Piloto fechado

- **Objetivo:** observar uma população e escopo limitados antes de abrir onboarding.
- **Arquivos/módulos:** onboarding, suporte, telemetria, políticas e runbooks; sem mudança obrigatória de framework.
- **Dependências:** todas as portas anteriores e avaliação de segurança/privacidade/jurídica por pessoas competentes.
- **Alterações previstas:** acesso restrito, suporte e exportação/correção/encerramento; monitorar confiabilidade, abuso e feedback; revisar incidente e controle de acesso.
- **Testes necessários:** checklist de prontidão da auditoria, simulação de incidente, retirada de acesso/membership, exportação e recuperação.
- **Riscos:** volume/fluxos reais revelam políticas ausentes; dados de saúde elevam impacto de erro.
- **Aceitação:** métricas e critérios de saída definidos antes; nenhum problema de isolamento aberto; sponsor aprova expansão com evidência.
- **Rollback:** suspender onboarding, preservar acesso/exportação conforme política, revogar credenciais se necessário, recuperar serviço sem apagar registros.

## Fase 8 — Assinaturas e expansão comercial

- **Objetivo:** cobrar sem acoplar pagamento às entidades clínicas.
- **Arquivos/módulos:** `billing/`, subscriptions, webhooks idempotentes, configuração de provedor e páginas de conta.
- **Dependências:** modelo de cobrança e cancelamento aprovado; piloto estável; seleção de provedor por critérios.
- **Alterações previstas:** checkout hospedado/tokenizado, referência externa, processamento idempotente de eventos, estados de período/cancelamento, reconciliação e suporte.
- **Testes necessários:** assinatura criada/alterada/cancelada, evento duplicado/fora de ordem/falsificado, indisponibilidade, inadimplência e exportação de dados.
- **Riscos:** webhook duplicado, estado financeiro divergente, suspensão indevida de acesso ou retenção mal definida.
- **Aceitação:** reconciliação financeira e comportamento de cancelamento testados; cartão não armazenado; inadimplência não apaga dados clínicos.
- **Rollback:** desativar novo checkout/webhooks sem remover assinaturas existentes; reconciliação manual auditada.

## Backlog transversal de segurança

- Matriz de autorização por rota e papel, incluindo IDs manipulados e relação de paciente inválida.
- Testes de sessão, convites/reset de uso único, rate limit e concorrência.
- Validação por operação: texto/tamanho, enum, valor, data calendárica, unidade, relação e payload máximo.
- Testes de renderização segura/XSS e DTO do portal; não expor rascunhos/notas.
- Nenhum token, cookie, hash ou conteúdo clínico em logs/métricas/traces.
- Revisão de runtime e dependências; monitoramento de avisos de segurança e atualização planejada.
- Backups/restores e simulado de incidente; responsáveis e contatos definidos.
- Avaliação jurídica/privacidade separada; não declarar LGPD atendida apenas por implementação técnica.

## Gates para dados reais e venda

Não iniciar piloto até atender os critérios da seção 11 de `docs/SAAS_READINESS_AUDIT.md`: tenant/portal aprovados; testes de cada rota; banco com transações/constraints; sessão/rate limit; HTTPS e segredos; importação/rollback; restore dentro do RPO/RTO; logs minimizados; CI; monitoramento; suporte e processo de titular; avaliação competente de privacidade; piloto restrito. Assinaturas e expansão só após políticas de cobrança, cancelamento, suporte e retenção aprovadas.

## Decisões humanas requeridas

- Profissional ou consultório como tenant; equipe e papéis.
- Paciente multi-vínculo, identidade, transferência e histórico acessível.
- Conteúdo/versões do portal, revogação e notificações.
- Escopo, região, provedor, custo, disponibilidade, RPO/RTO.
- Retenção, exportação, correção, exclusão e auditoria.
- MFA/recuperação e suporte privilegiado.
- Provedor e fluxo de e-mail; provedor e regras de pagamento.
- Responsáveis por produto, banco, deploy, incidentes, backups e privacidade.
- Legitimidade e finalidade do conteúdo local antes de qualquer migração.
