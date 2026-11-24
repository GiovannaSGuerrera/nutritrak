# Resultados finais dos testes

24/11/2026. Windows local, Node24.21.0, PostgreSQL16.16 descartável em127.0.0.1:55489 e Python em .hardening-venv. Dados exclusivamente sintéticos. Docker CLI sem daemon.

| Verificação | Resultado |
|---|---|
| Baseline Node |3 aprovados; quatro falhas de formatação; sem scripts dedicados lint/tipos/build |
| pnpm lint |ESLint e Prettier aprovados |
| pnpm typecheck |checkJs estrito dos sete módulos novos aprovado |
| pnpm build |Sintaxe Node/web aprovada; não é bundle compilado |
| pnpm test |17 aprovados,0 reprovados/ignorados |
| pnpm test:e2e |2 aprovados; Chromium1440x1000 e390x844 |
| Python pytest |14 aprovados;1 warning de depreciação TestClient/httpx |
| Black/ruff/compileall |Formatação e regras críticas aprovadas |
| mypy |security.py/database.py aprovados; não cobre todo Python |
| Alembic |0001→0004 em banco novo, check sem drift |
| verify-migrations.py |Registro pré0002 preservado até0004 |
| Backup/restore |SQLite online, AES-GCM, integridade/FKs e adulteração testados |
| npm/pip-audit |Zero advisories conhecidos nas árvores auditadas |
| Compose produção config |Validado com variáveis sintéticas |
| CI remoto/imagens Linux |Preparados, NÃO EXECUTADOS localmente |

Comandos executados e reproduzíveis:

```text
pnpm lint
pnpm typecheck
pnpm build
pnpm test
pnpm test:e2e
pnpm audit --json
python -m pip_audit -r apps/api-python/requirements-dev.lock --format json
python -m black --check apps/api-python/app apps/api-python/migrations apps/api-python/tests
python -m ruff check apps/api-python --select E9,F63,F7,F82
python -m compileall -q apps/api-python
python -m mypy apps/api-python/app/security.py apps/api-python/app/database.py --check-untyped-defs --ignore-missing-imports
python -m pytest apps/api-python/tests -q
# Em apps/api-python com DATABASE_URL descartável:
python -m alembic upgrade head
python -m alembic check
# Raiz, banco NOVO vazio terminado em _test e TEST_DATABASE_CONFIRM=disposable:
python scripts/verify-migrations.py
node scripts/benchmark.cjs
docker compose -f docker-compose.production.yml config --quiet
```

Logs em evidence/final-*.log, e2e-results.json e *audit-after.json. Conftest recusa banco sem confirmação/nome_test. Probes históricos local-probes.cjs/python-projection.py demonstram defeitos anteriores; não foram alterados para aceitar o resultado novo.

## Cobertura e limitações

33 casos reportados pelos runners (17+14+2), não33 fluxos independentes. Sem percentual global confiável: subprocessos HTTP e legado sem instrumentação integrada. Há unitários (crypto/TOTP/ACL), integração DB/outbox, HTTP direto auth/tenant/concorrência/erros, migrações e E2E. SMTP stub somente nos testes; runtime usa SMTP real. Axe cobre tela de conta; não substitui revisão assistiva humana. Portal e cenários clínicos têm HTTP, mas nem todos os caminhos têm E2E. Tipos/checks são escopados, não certificam todo o legado.

## Performance controlada

Baseline reconstruído com patch local inicial preservado.100 pacientes/100 metas, um usuário/uma sessão,7 amostras locais:101→1 requisições/tela; mediana40,77→4,36ms; máximo70,94→6,02ms. Oito aberturas simultâneas da mesma tela/sessão: mediana187,5→22,09ms; máximo187,6→32,99ms. Artefato performance-comparison.json contém todas as amostras. Não comprova carga multi-tenant, p95/SLO nem capacidade de100/1000/10000 clientes. Requer staging representativo antes de promessas de escala.
