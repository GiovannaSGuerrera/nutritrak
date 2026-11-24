# Resumo executivo — NutriTrack

24/11/2026 · Snapshot 987d6926f9f3 + alterações locais anteriores à auditoria.

**Parecer: INTERNAL ALPHA. Não receber clientes reais ou dados reais de saúde hoje.** O Node possui fluxos individuais e controles de workspace/atribuição. A alternativa Python/PostgreSQL ainda exige correções e paridade. A suíte Node passou **3/3** após permitir conexões loopback. Nenhuma correção de aplicação foi realizada.

**Prontidão ponderada: 42,7/100**, com critérios, pesos e cobertura explícitos no relatório completo. Nota de triagem de implementação/evidência, não certificação; bloqueadores não são compensados pela média.

| Severidade | Quantidade |
|---|---:|
| CRITICAL | 0 |
| HIGH | 8 |
| MEDIUM | 12 |
| LOW | 3 |
| INFO | 0 |
| Total | 23 |

Os totais incluem defeitos confirmados, riscos potenciais/condicionais e lacunas de prontidão. Não significam 23 vulnerabilidades exploradas. Status e pré-condições estão individualizados.

## Principais riscos e bloqueadores

1. **Python expõe notas clínicas a papéis administrativos do mesmo tenant (AUD-001).** Arquivamento pela UI também não é reconhecido pelo portal devido ao status capitalizado (AUD-006). Não foi confirmado acesso entre organizações.
2. **Node aceita cadastro duplicado e duas conclusões simultâneas de reset (AUD-002/003).** PATCH inválido modifica memória apesar de retornar 400 (AUD-005). Provas sintéticas confirmaram esses caminhos.
3. **Persistência JSON e sessões locais Node não oferecem garantias operacionais suficientes (AUD-004).** PostgreSQL alternativo exige contratos/importação/migração ensaiados (AUD-014/017).
4. **Recuperação profissional, privacidade técnica e operação/restore/pipeline estão incompletos ou não demonstrados (AUD-007/009/010/020).** TLS/cloud/backup externos não foram validados.
5. **Abuso, concorrência, publicação e payloads Python precisam gates antes da exposição pública (AUD-008/011/012/016/022).** Reativação de agenda sem nova validação de conflito precisa reprodução/correção (AUD-023).

## Respostas objetivas

- **Clientes reais hoje?** Não; testes internos com dados fictícios.
- **APIs indevidamente expostas?** Nenhuma rota clínica anônima confirmada; campo clínico exposto em resposta administrativa privada Python. APIs públicas intencionais e metadata estão discriminadas no inventário.
- **Vazamento possível?** Sim, notas para papéis administrativos Python; nenhum incidente real foi investigado.
- **Acesso entre clientes?** Não confirmado. Node passou os cenários existentes; Python/banco precisam testes dinâmicos abrangentes.
- **Vulnerabilidades críticas?** Nenhuma CRITICAL confirmada; HIGH e gates operacionais bloqueiam oferta comercial.
- **Funcionalidades incompletas?** Paridade/importação Python, métricas/dashboard e campos de metas Python, recuperação/verificação profissional, direitos/retenção, operação de produção. Billing automático, e-mail e notificações não existem.
- **Esforço restante?** Estimativa de planejamento de **30–50 dias-pessoa técnicos** para escopo individual, com sobreposição entre itens. Exclui clínica/billing completos e prazos jurídicos/provedor; não é prazo garantido.
- **Caminho mais curto?** Backend único + escopo individual → correções de dados/autenticação → persistência/contratos/importação → staging com CI/TLS/restore → privacidade/suporte → piloto fechado monitorado → nova avaliação comercial.

## Limitações e evidências

Python não foi executado com PostgreSQL: daemon Docker indisponível e ambiente sem fastapi/pytest. Projeção foi validada pelo AST original; demais achados Python têm validação estática explícita. Sem browser, carga, produção ou restore. Dependências diretas Python avaliadas, árvore transitiva/imagem não auditadas integralmente. Npm audit exato retornou zero advisories; pytest 8.3.5 tem um CVE local Unix deduplicado, sem exploração HTTP demonstrada. Busca de formatos de segredo cobriu 12 commits/88 blobs sem correspondências, sem garantir ausência universal. Dados pessoais e valores de .env não foram expostos.

## Entregáveis

- [Relatório completo e evidências por achado](FULL_AUDIT_REPORT.md)
- [Inventário e segurança das APIs](API_SECURITY_REPORT.md)
- [Checklist de produção](PRODUCTION_READINESS_CHECKLIST.md)
- [Plano priorizado](REMEDIATION_PLAN.md)
- [Resultados dos testes e limitações](TEST_RESULTS.md)

Nenhuma aprovação de correção/deploy é presumida por estes documentos.
