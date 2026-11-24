# Resultados de testes, comandos e limites

Referência: 24/11/2026, America/Sao_Paulo. Commit `987d6926f9f385474c5db4c53fea37e6b1ed550e` mais working tree já modificado antes da auditoria. Sem correções no runtime, testes existentes, manifests ou dados locais. Foram acrescentados relatórios e reproduções em docs/audit/. Nenhum comando de formatação com escrita, instalação de dependência, migração real ou teste destrutivo foi executado.

## Ambiente

| Verificação | Resultado observado |
|---|---|
| node --version | v24.21.0 |
| pnpm --version | 11.25.0 |
| python --version | Python 3.12.10 |
| python -m pip --version | pip 25.0.1 no Python global |
| .venv/Scripts/python.exe -m pip --version | No module named pip |
| docker --version | Docker 29.8.1, CLI presente |
| docker info --format '{{.ServerVersion}}' | Falha: pipe dockerDesktopLinuxEngine inexistente; daemon indisponível |
| gh auth status | gh não encontrado; sem autenticação GitHub para coletor |
| uv --version | uv não encontrado; scripts do coletor executados com Python disponível |
| agent-browser via Get-Command | Não localizado; sem instalação de browser nesta auditoria |

## Testes Node existentes

### Execução no sandbox

Comando: `pnpm test` na raiz.

- Exit 1; 3 testes, 2 passaram e 1 falhou.
- Falha na asserção de prontidão em `apps/api/test/application.test.js:54`: servidor deve iniciar / fetch failed.
- Diagnóstico com processo filho isolado, DATA_DIR em `docs/audit/.probe-data`, HOST=127.0.0.1 e porta 45839: stdout confirmou servidor escutando; filho continuou ativo; fetch falhou `connect EACCES 127.0.0.1:45839`.
- Filho encerrado e diretório sintético removido ao terminar. Não foi usado o store padrão.

Isso separa startup da conectividade: falha inicial causada por bloqueio de loopback, não demonstra regressão da aplicação. O aviso pnpm de node_modules ausente no pacote API não é causa: runtime usa somente módulos nativos.

### Execução com loopback permitido

Comando: `pnpm test`, mesma suíte, executado fora da restrição de rede do sandbox após revisão automática de permissão.

```text
✔ papéis não concedem acesso clínico sem capacidade e atribuição explícita
✔ membership encerrado ou workspace adulterado não autoriza operação
✔ autenticação, cadastro, avaliação, isolamento e conflito de agenda
tests 3
pass 3
fail 0
cancelled 0
skipped 0
todo 0
exit 0
```

Dois testes unitários de access-control e um teste amplo de integração. O teste de integração tem muitas assertions de autenticação, cadastro, clínica/equipe, isolamento, portal/publicação, suspensão/revogação, logout, restart, migração sintética e TTL; não interpretar três testes como apenas três endpoints cobertos. A suíte não cobre todas as combinações por rota/papel nem as corridas confirmadas aqui.

Comando adicional `node --test apps/api/test/access-control.test.js`: 2 testes, 2 passaram, 0 falhas, exit 0.

## Reproduções locais adicionais

Comandos reproduzíveis na raiz:

```powershell
node docs/audit/evidence/local-probes.cjs
python docs/audit/evidence/python-projection.py
```

Os arquivos são instrumentos de auditoria, não correções nem testes de regressão de comportamento desejado. **Suas assertions esperam os defeitos atuais**; exit 0 significa que a reprodução confirmou os defeitos. Ao corrigir a aplicação, essas assertions precisarão ser invertidas/substituídas por testes de regressão apropriados.

### Handler Node original

O script lê server.js como texto, omite o bloco de startup HTTP, exporta o handler dentro de VM e substitui writeFile/rename por funções sem efeito. O store é sintético em memória. Cookies/tokens são criados pelo handler e não impressos. A reprodução não prova flush de disco, proxy, browser ou multi-processo.

```text
REGISTER_RACE {"statuses":[201,201],"sameEmailAccounts":2}
INVALID_PATCH {"status":400,"inMemoryName":""}
UNAUTH_PATIENTS 401
ORIGIN_DEFAULT 201
RESET_RACE {"statuses":[200,200]}
AUDIT_PROBES_CONFIRMED: assertions expect current defects, not desired behavior
exit 0
```

Correspondência:

- AUD-003: cadastros simultâneos com mesmo e-mail geram duas identidades.
- AUD-005: nome vazio modifica memória apesar de 400.
- Controle negativo: GET /api/patients sem cookie retorna 401.
- AUD-016: sem allowlist configurada, handler aceita Origin arbitrário com cookie fornecido. Isso não prova que browser cross-site enviaria cookie Strict.
- AUD-002: mesmo reset conclui duas vezes em paralelo.

### Projeção Python original

O script extrai a função patient_dto pelo AST, executa somente essa função original com objeto sintético e clinical=False, sem framework/banco. Também faz ast.parse dos arquivos Python de aplicação, testes e migrações.

```text
{'test': 'python_administrative_projection', 'clinicalNotes_exposed': True, 'objective_exposed': False}
Python AST: all source/test/migration files parsed
exit 0
```

AUD-001 confirmado na projeção. Invocação dessa projeção para papéis administrativos foi rastreada nos handlers; não foi executada por HTTP contra PostgreSQL.

## Sintaxe, formato e build/configuração

| Comando/verificação | Resultado | Limite |
|---|---|---|
| node --check apps/api/src/server.js | Exit 0 | Sintaxe, não semântica |
| node --check apps/api/src/access-control.js | Exit 0 | Idem |
| node --check apps/web/server.mjs | Exit 0 | Idem |
| node --check apps/web/public/app.js | Exit 0 | Não executa DOM |
| node --check apps/web/public/portal.js | Exit 0 | Não executa DOM |
| Python ast.parse em app/test/migrations | Exit 0 | Sem imports/dependências/DB |
| pnpm exec prettier --check "apps/api/src/*.js" "apps/api/test/*.js" "apps/web/public/*.{js,html,css}" "apps/web/server.mjs" | Exit 1 | Quatro arquivos fora do formato: server.js, application.test.js, styles.css, server.mjs |
| Check amplo inicial de Prettier apps/**/* e raiz/workspace | Encontrou cinco avisos, incluindo dois stores sintéticos preexistentes | Resultado refinado acima exclui stores e inclui server.mjs; não expõe conteúdo |
| docker compose config --quiet | Exit 0 | Valida interpolação/configuração local, não sobe serviços; saída detalhada omitida para não expor .env |
| Build frontend/Node | Não aplicável a bundler | Nenhum script build definido; arquivos estáticos e Node nativo |
| Docker build Python | Não executado | Daemon indisponível; não declarar imagem construída |

Não há linter semântico/type-checker configurado. Não executar `pnpm format`, que escreve arquivos e contrariaria a etapa solicitada.

## Testes Python e banco

`python -m pytest --version` e `.venv/Scripts/python.exe -m pytest --version` falharam com No module named pytest. Import de fastapi/SQLAlchemy no Python global falhou em fastapi. Não foram instalados módulos para esta auditoria.

`pnpm test:python` requer Compose e PostgreSQL descartável; não foi executado devido ao daemon ausente. Não foi fornecida DATABASE_URL real ao pytest. A suíte contém cinco testes: cadastro/cookie/paciente/logout; senha incorreta; sessão expirada; isolamento/conflito; portal/publicação/revogação terminal. Cria tabelas se houver DB; isso reforça a exigência de banco descartável.

O resultado histórico “5 passaram” de PYTHON_MIGRATION_STATUS não é resultado atual. Não foram executados migration fresh/upgrade, EXPLAIN, queries de RLS/grants, concorrência multi-conexão, restore ou teste de falha. AUD-006/011/014/017/022 são avaliações estáticas; AUD-012/023 permanecem riscos a reproduzir.

## Dependências e supply chain

### Npm exato

`pnpm audit --json` inicialmente falhou no sandbox: fetch failed, exit 1. Reexecução autorizada com acesso de rede retornou exit 0:

```json
{"advisories":{},"metadata":{"vulnerabilities":{"info":0,"low":0,"moderate":0,"high":0,"critical":0},"dependencies":0,"devDependencies":1,"optionalDependencies":0,"totalDependencies":1}}
```

Isto se aplica ao lockfile atual com Prettier 3.9.10; não é declaração sobre Node binário/OS ou qualquer pacote futuro.

### Coletor de risco de dependências

Comandos equivalentes executados, com saídas temporárias fora do repositório e cópias de evidência em docs/audit/evidence:

```powershell
python C:/Users/giuse/.codex/skills/supply-chain-risk-auditor/scripts/collect.py . --json <temp>/nutricare-audit-npm.json
python C:/Users/giuse/.codex/skills/supply-chain-risk-auditor/scripts/collect.py apps/api-python --json <temp>/nutricare-audit-python.json
python C:/Users/giuse/.codex/skills/supply-chain-risk-auditor/scripts/render.py <temp>/nutricare-audit-npm.json --out <temp>/nutricare-audit-npm.md
python C:/Users/giuse/.codex/skills/supply-chain-risk-auditor/scripts/render.py <temp>/nutricare-audit-python.json --out <temp>/nutricare-audit-python.md
```

Primeiras consultas sem rede disponível terminaram exit 1 com: `this run cannot be reported: no Tier A criterion was assessable for any dependency, so this run measured nothing; every source was unavailable`. Não foram interpretadas como “sem vulnerabilidades”. Após permitir consultas públicas de metadados, os coletores concluíram exit 0. A primeira tentativa de render usou TEMP diferente entre contextos e falhou FileNotFoundError; corrigir para o caminho absoluto retornado pelo coletor permitiu renderizar ambos. Nenhum manifest foi alterado.

Resultados preservados:

- [Coletor npm](evidence/supply-chain-npm.md), [dados npm](evidence/supply-chain-npm.json): 1 dependência direta; zero flags. Não lê pnpm-lock, usa latest no range do manifest; audit npm exato acima complementa. Nenhuma flag de publisher/install/depreciação/arquivo/atividade nos critérios medidos.
- [Coletor Python](evidence/supply-chain-python.md), [dados Python](evidence/supply-chain-python.json): 9 diretas avaliadas em advisory/yanked/archive/activity; 1 pacote afetado (pytest 8.3.5), dois registros. ACL de publicação e install-time não mensuráveis para 9/9; upstream Scorecard sem relatório para fastapi/uvicorn, conforme cobertura original.
- GET público da API OSV para GHSA-6w46-j5rx-g56g e PYSEC-2026-1845 confirmou aliases do mesmo **CVE-2025-71176**. Um CVE deduplicado, tmpdir Unix, corrigido em **9.0.3**. Presença na imagem confirmada pelo Dockerfile/requirements, exploração por HTTP não demonstrada. [Advisory](https://github.com/advisories/GHSA-6w46-j5rx-g56g).
- Árvore transitiva Python, extras resolvidos, SO/base de imagem e SBOM **não avaliados**; não declarar “dependências seguras” globalmente. Não houve medição manual de download/maintainers para substituir o coletor.

## Segredos, histórico e integridade do escopo

Comandos/fonte: `git status --short`, `git ls-files`, `git rev-list --all`, `git ls-tree -r <commit>`, `git cat-file blob <sha>`, leitura local com saída reduzida a arquivos/linhas e nomes de variáveis.

- 12 commits, 88 blobs únicos alcançáveis pesquisados por padrões de private keys, tokens GitHub, AWS AKIA e sk_live; zero correspondências nos padrões. Arquivos versionados também pesquisados. Não foi usado scanner universal/alta entropia; resultados não garantem ausência de segredo genérico ou em objeto inalcançável.
- `.env.example` é o único arquivo .env versionado. `.env` ignorado; somente nomes de variáveis inventariados, sem registrar valores. DATABASE_URL/defaults de teste/development não foram classificados como segredo real de produção.
- Não houve leitura de conteúdo de `data/store.json`, dump de stores preexistentes ou logs pessoais para o relatório. O arquivo de teste existente foi lido como código; formatter apenas verificou stores sem emitir conteúdo.
- [Inventário versionado](evidence/tracked-files.txt) registra caminhos. [Hashes dos fontes revisados](evidence/reviewed-source-sha256.json) delimitam snapshot de fonte/configuração no fechamento; são hashes dos arquivos disponíveis, não prova criptográfica do estado anterior à auditoria.
- Working tree inicial já tinha README.md, apps/api/src/server.js, apps/web/public/app.js e index.html modificados; também stores sintéticos e SECURITY_HEALTH_CHECK.md não versionados. Não foram revertidos nem atribuídos à auditoria.

## UX, browser e verificações não executadas

Revisão estática de HTML/JS/CSS e [Web Interface Guidelines](https://raw.githubusercontent.com/vercel-labs/web-interface-guidelines/main/command.md). Identificados labels sem associação e conflito CSP/styles. Toast com role=status/aria-live, foco visível e media queries presentes. Não houve screenshot, axe, leitura assistiva, teste de contraste, mobile ou Safari/Firefox/Chrome. agent-browser não localizado; nenhum ambiente visual foi declarado validado.

Também não executados: produção/ataques externos, carga/DoS, recuperação de disco, backup/restore, failover, pentest de domínio real, TLS/IAM/cloud, financeiro/webhooks inexistentes, exclusão/exportação inexistentes e importação de dados reais. Ausência de teste não é resultado positivo nem vulnerabilidade confirmada.

## Conferência dos entregáveis

Contagens esperadas: 23 achados = 8 HIGH + 12 MEDIUM + 3 LOW; 0 CRITICAL/INFO. Rubrica: pesos somam 100 e resultado ponderado 42,7/100. Inventário: 35 operações compartilhadas + 12 exclusivas Node = 47 Node; 35 compartilhadas + health = 36 Python. Rotas automáticas/estáticos são adicionais e não duplicam esses números.

As seis entregas são EXECUTIVE_SUMMARY.md, FULL_AUDIT_REPORT.md, API_SECURITY_REPORT.md, PRODUCTION_READINESS_CHECKLIST.md, REMEDIATION_PLAN.md e TEST_RESULTS.md. Scripts/saídas em evidence são anexos de auditoria. Verificação final deve conferir existência, referências locais, IDs/severidades/notas, hashes de fontes e git status; não equivale a aprovar implementação ou deploy.
