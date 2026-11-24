# Resultados finais — versão main endurecida

24/11/2026. Windows, Node24, PostgreSQL16.16 local em127.0.0.1:55489, banco `nutritrack_remediation_test`; schemas UUID descartáveis. Nenhum banco real ou caixa de e-mail de terceiros utilizado. As evidências históricas de main-2026-11-24 foram preservadas.

| Verificação | Antes | Depois |
|---|---|---|
| Suíte Node com PG |10pass |28pass,0fail,0skip |
| Default sem PG |3pass/7skip |Modo local continua possível; CI recusa ausência de PG |
| Lint semântico |Ausente |ESLint aprovado em API/TS/testes/frontend/scripts |
| Formatação |12 arquivos falhavam |Prettier aprovado |
| Tipos/build |TS não estrito passava |TS legado + módulos novos estritos aprovados; compilação real |
| E2E |Ausente |2pass: Chromium1440x900 e390x900 |
| Migração |Testes de importação/rollback |Upgrade v1→hardening preserva dados, repete e CLI inicializa vazio |
| Backup/restore |GCM/destino vazio já testados |Novas entidades incluídas; tokens/outbox não reativados |
| Dependências |Zero advisories conhecidos |Zero conhecidos no pnpm audit final |
| CI Linux/Vercel novo release |Não executado |Workflow preparado, execução remota/deploy NÃO realizados |

28 são casos reportados pelo runner, incluindo subtestes; não28 fluxos independentes nem porcentagem de cobertura. Helpers não são casos. Nenhum percentual global foi obtido. Código legado não ficou integralmente tipado/reescrito.

## Comandos e logs

```text
pnpm install --frozen-lockfile --ignore-scripts
pnpm lint
pnpm typecheck
pnpm build
# Configurar SOMENTE banco sintético *_test e TEST_DATABASE_CONFIRM=disposable:
pnpm test:ci
pnpm test:e2e
pnpm audit --json
node scripts/benchmark.cjs
```

Os testes incluem unitários de RFC6238/replay e GCM, integração PostgreSQL/outbox, HTTP direto entre dois profissionais, domínio/inputs/erros/atomicidade, revisão concorrente, agenda, senha/verify/reset/MFA/recovery, expiração/revogação, permissões sem DDL, upgrade/restore e E2E. Alterações de contrato nos happy paths mantêm asserções anteriores. Cinco regressões novas falharam na baseline e passaram depois (remediation-red.log). A nova corrida de MFA foi tratada com epoch de segurança e teste de duas instâncias.

Logs finais em evidence/final-tests.log, final-e2e.log, final-lint.log, final-typecheck.log, final-build.log e final-dependencies.json. Provas históricas que esperam defeitos não são a suite atual e não foram adulteradas. O teste SMTP usa transport stub exclusivamente no teste; runtime usa Nodemailer/TLS real. O teste produtivo usa documentos sintéticos em pasta descartável e relay loopback indisponível para confirmar outbox/fail-safe; não comprova entrega externa.

Houve falhas corrigidas durante o trabalho: tipos desconhecidos no parser, grants das novas tabelas, fixtures sem novas coleções, lint e um seletor E2E que chamava o botão mobile pelo nome desktop. Não houve desativação de segurança. Harness de benchmark inicialmente fechava o pool duas vezes; corrigido e repetido. Warnings NO_COLOR/FORCE_COLOR não afetam resultado.

## Performance antes/depois

Mesma fixture PostgreSQL:10 profissionais,100 pacientes e100 metas cada, um usuário/sessão autenticado;7 amostras e4 aberturas simultâneas. Baseline b759e77 compilada em worktree isolada; mesma base física local em schemas distintos. Antes101 requisições/tela, mediana1.825,98ms/máximo1.871,67ms. Depois1 requisição/tela, mediana10,43ms/máximo13,45ms. Quatro aberturas: mediana6.893,22→26,65ms, máximo6.918,11→40,18ms. Dados brutos em performance-comparison.json.

É comparação pequena/controlada, não SLO/p95, carga distribuída ou capacidade de clientes. Não foram inventadas capacidades de100/1000/10000 usuários. Outras correções posteriores ao benchmark foram auth/health/test harness e não alteraram a consulta de metas; valores representam aquele snapshot de implementação, não uma garantia de cada release futuro.

## Limitações

Sem SMTP real, CI remoto, deploy novo, scan de imagem/host, disaster recovery do Neon/Vercel ou homologação clínica. Browser cobre fluxos citados e Axe na conta, sem revisão humana assistiva, todos os navegadores ou todas as telas. Testes de exclusão não removem prontuários reais; políticas/retencão clínica e restauração após pedidos de exclusão exigem responsável. Novos gates produtivos devem ser configurados antes de publicar, ou a inicialização recusará execução.

A reauditoria acrescentou também um teste de sobreposição de agenda em duas conexões, com audit vazio, para provar que o lock/consulta de conflito no commit não dependem de colisão incidental de eventos de auditoria.
