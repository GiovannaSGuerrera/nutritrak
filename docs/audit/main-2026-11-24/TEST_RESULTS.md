# Testes da nova baseline main

24/11/2026. Código b759e77 intacto; apenas documentos/probes criados na worktree. Node24, PostgreSQL16.16 local descartável `nutritrack_main_reaudit_test` em127.0.0.1:55489. Nenhum DATABASE_URL real foi utilizado. Probes fixam explicitamente banco de teste e usam schemas com UUID.

| Check | Resultado |
|---|---|
| pnpm install --frozen-lockfile --ignore-scripts | Aprovado |
| pnpm typecheck | Aprovado com strict:false |
| pnpm build | Compilação TS aprovada |
| pnpm test sem banco |3pass,7skip |
| pnpm test com TEST_DATABASE_URL sintético |10pass,0fail,0skip;7,9s nesta execução |
| Probes adicionais PostgreSQL e JSON |Defeitos demonstrados; resultados observacionais, não testes de aceitação aprovados |
| Browser Chromium desktop |Cadastro/paciente/plano/salvar/reabrir executados; metadados vazios confirmados |
| pnpm audit --json |0advisories conhecidos na árvore travada/instalada |
| Prettier --check TS/testes/web |Falhou em12 arquivos |
| Lint semântico/CI/E2E completo |Ausentes na baseline; não declarar aprovação |
| Neon/Vercel/domínio/SMTP/alertas |Não acessados nesta revisão |

Houve uma tentativa inicial de suíte PG com ECONNREFUSED porque o cluster sintético iniciou em5432 enquanto o runner usava55489. Investigação confirmou a porta nos logs; cluster foi reiniciado explicitamente em55489. A segunda execução passou10/10. A primeira falha está em baseline-tests.log e não é defeito do produto. Nenhum teste foi alterado para aceitar falha.

## Reprodução

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm typecheck
pnpm build
# Apenas banco descartável, nunca credencial de produção:
TEST_DATABASE_URL=postgresql://audit_test@127.0.0.1:55489/nutritrack_main_reaudit_test pnpm test
node docs/audit/main-2026-11-24/evidence/probes.cjs
pnpm audit --json
pnpm exec prettier --check "apps/api/src/*.ts" "apps/api/test/*.js" "apps/web/public/*.{js,html,css}"
```

PowerShell: definir `$env:TEST_DATABASE_URL` antes do teste. Os testes existentes removem schemas temporários criados por eles; não têm guard suficiente contra URL de banco real. Executá-los somente como acima; endurecer o guard antes de CI. Não editar esses testes sem investigar a causa de qualquer falha.

Probes retornam: cadastro duplicado duas instâncias201/409; cross-tenant GET/PATCH404; reset paralelo PG200/409 e JSON200/410; PATCH400 preserva nome PG mas altera JSON; update de plano200/200, publish revisão inválida200; conflito reativado200; cintura NaN/data impossível201; meals null500; status arbitrário200; POST incompleto bloqueia health200ms. Todos os dados sintéticos. Relatório completo em probe-results.json, sem cookies/tokens.

## Limitações

Sem percentual de cobertura, carga real, p95/SLO, promessa de escala, browser mobile/Safari/Firefox, auditoria assistiva integral ou CI remoto. Os runners não são comparáveis aos17+14+2 da arquitetura anterior. Coletores supply-chain não interpretam pnpm-lock e usam fallback latest nas diretas; pnpm audit cobre a árvore exata. Sem gh CLI, alguns sinais upstream não puderam ser consultados. Sem exposição de segredos nos resultados.
