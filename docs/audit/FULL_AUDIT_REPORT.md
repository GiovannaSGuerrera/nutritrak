# Auditoria técnica completa — NutriTrack

Referência: 24/11/2026, America/Sao_Paulo. Commit `987d6926f9f385474c5db4c53fea37e6b1ed550e` **mais alterações locais preexistentes**. Parecer: **INTERNAL ALPHA**. Nenhuma correção de aplicação foi realizada.

## Escopo, método e limites

Revisados os dois backends, frontend estático, autenticação/autorização, persistência, modelos/migração, configuração, dependências e testes. Testes Node executados com dados sintéticos e diretório descartável. Provas adicionais executaram o handler original em VM, omitindo startup HTTP e substituindo somente escrita em disco por no-op. Isso verifica a lógica em processo único, não durabilidade, ingress ou múltiplas instâncias. A projeção Python foi executada pelo AST da função original, sem importar framework/banco. Outros caminhos Python têm validação estática explicitamente identificada.

Docker daemon indisponível e ambiente Python sem fastapi/pytest impediram testes atuais com PostgreSQL. Sem pentest externo, browser, teste de carga, deploy, TLS/cloud, restore ou revisão jurídica. Resultados históricos não substituem validação atual. Dados de `data/store.json`, stores de teste preexistentes e logs pessoais não foram despejados ou usados. Valores de `.env` não foram emitidos.

Referências temáticas: [OWASP Top 10:2025](https://top10.owasp.org/), [API Security Top 10:2023](https://owasp.org/projects/api-security-project), [ASVS 5.0.0](https://asvs.owasp.org/). Não se declara certificação ASVS nem verificação integral de cada requisito numerado.

## Arquitetura e fluxos

`pnpm start/dev` inicia API Node nativa, que serve web e API na mesma origem, carrega JSON em memória e persiste snapshots em `DATA_DIR/store.json`. Não há dependência npm de runtime. Cookies profissionais e pacientes são separados; senhas usam scrypt, salt aleatório e sessões opacas de 32 bytes com expiração absoluta no servidor. `HttpOnly`/`SameSite=Strict`; `Secure` depende de `NODE_ENV=production`. Há limiter local para quatro rotas.

Compose inicia alternativa FastAPI/SQLAlchemy/psycopg/PostgreSQL 16. Web separado pode proxyar `/api/` para `API_BASE_URL`. Python usa Argon2id com 64 MiB, três iterações e duas lanes, sessões persistidas e validação de origem em mutações com cookie. Produção exige `DATABASE_URL`, `CORS_ORIGINS` explícito e cookie seguro. `APP_ENV` controla Python; `NODE_ENV` controla Node/web: não são intercambiáveis.

Autorização clínica: sessão → membership ativo → workspace → papel/capacidade → atribuição → paciente. Portal: convite com hash/expiração → ativação → cookie próprio → somente versão publicada. Node valida papéis e atribuições no backend; proprietário não recebe prontuário automaticamente. Python tem filtros tenant-aware e FKs compostas, mas apresenta falha de projeção administrativa. Flag de clínica desativa rotas administrativas Node por padrão de produção; Python não aplica a mesma flag.

## Registro dos achados

IDs são estáveis entre documentos. Severidade não equivale a prioridade: lacuna operacional HIGH não é denominada CVE. “Confirmado estaticamente” significa caminho e comportamento identificáveis no código, sem afirmar exploração HTTP. “Risco potencial” exige validação adicional. Bloqueios condicionais aplicam-se ao backend/escopo disponibilizado; backend fora do escopo deve permanecer inacessível.

### AUD-001 — Notas clínicas expostas a perfis administrativos Python

- **Severidade:** HIGH.
- **Status:** confirmado em função original isolada; caminho HTTP rastreado estaticamente, sem PostgreSQL.
- **Categoria:** autorização por propriedade; API3:2023.
- **Arquivo/linha:** `apps/api-python/app/main.py:240`, `:248`, `:229`, `:254`.
- **Descrição:** `patient_dto(p, False)` exclui `objective` e `notes`; persistência usa `clinicalNotes`. Listagem/detalhe administrativo recebem essa projeção.
- **Evidência:** AST original com objeto sintético retornou `clinicalNotes_exposed=True`, `objective_exposed=False`.
- **Impacto:** dados de saúde acessíveis por membros administrativos do mesmo cliente.
- **Cenário:** assistant/operations_admin/owner_admin sem acesso clínico lista pacientes ou abre cadastro. Não demonstra acesso entre workspaces.
- **Correção:** DTO administrativo por allowlist, modelos de resposta e revisão de todos os retornos.
- **Complexidade:** baixa, 0,5–1 dia.
- **Aceitação:** notas, objetivo e medidas ausentes de qualquer resposta administrativa.
- **Testes:** quatro papéis, pacientes atribuídos/não atribuídos, assertions de campos em GET/POST/PATCH.
- **Bloqueia:** sim, caso Python seja disponibilizado.

### AUD-002 — Reset Node aceita duas conclusões simultâneas

- **Severidade:** HIGH.
- **Status:** confirmado no handler original com persistência no-op.
- **Categoria:** replay/autenticação.
- **Arquivo/linha:** `apps/api/src/server.js:617`, `:636`, `:644`.
- **Descrição:** validade é checada antes de `await scrypt`; `usedAt` só muda depois. Duas chamadas podem passar pelo mesmo token.
- **Evidência:** `Promise.all` de conclusões com mesmo token e senhas diferentes retornou `[200,200]`.
- **Impacto:** quebra de uso único; senha final depende da corrida.
- **Cenário:** detentor de um link válido envia duas conclusões; não foi demonstrada adivinhação de token.
- **Correção:** consumo atômico na transação da senha e revogação; evitar read-check-await-write.
- **Complexidade:** média, 1–2 dias após persistência transacional.
- **Aceitação:** exatamente uma conclusão aceita; replay falha; sessões anteriores revogadas.
- **Testes:** concorrência com barreira, replay sequencial, falha de commit, várias instâncias.
- **Bloqueia:** sim no Node.

### AUD-003 — Cadastro concorrente duplica identidade no Node

- **Severidade:** HIGH.
- **Status:** confirmado no handler original isolado.
- **Categoria:** integridade da identidade.
- **Arquivo/linha:** `apps/api/src/server.js:686`, `:693`, `:703`, `:733`.
- **Descrição:** unicidade é checada antes de `await scrypt`; não há constraint/rechecagem no push. Login usa primeira correspondência.
- **Evidência:** dois cadastros do mesmo e-mail retornaram `[201,201]`; store sintético tinha duas contas desse endereço.
- **Impacto:** login/recuperação ambíguos e possível preempção de identidade; acesso a workspace alheio não demonstrado.
- **Cenário:** requisições simultâneas com mesmo endereço e senhas diferentes.
- **Correção:** unicidade normalizada no banco, transação e reconciliação autorizada de duplicados existentes.
- **Complexidade:** média, 1–2 dias além da migração.
- **Aceitação:** uma identidade por e-mail conforme contrato, conflito concorrente 409 genérico.
- **Testes:** cadastros concorrentes, normalização e concorrência com ativação do portal.
- **Bloqueia:** sim no Node.

### AUD-004 — Store JSON e sessões locais não sustentam operação resiliente

- **Severidade:** HIGH.
- **Status:** arquitetura confirmada; cenários de perda multi-processo/falha não ensaiados.
- **Categoria:** persistência/disponibilidade.
- **Arquivo/linha:** `apps/api/src/server.js:17`, `:34`, `:61`, `:92`, `:99`.
- **Descrição:** snapshot integral e fila local protegem ordem de um processo; não coordenam processos nem garantem rollback geral ou fsync. Sessões desaparecem no restart.
- **Evidência:** `JSON.stringify(store)`, escrita temporária + rename, sessions/patientSessions em Map.
- **Impacto:** risco de sobrescrita, inconsistência memória/disco, indisponibilidade e escala insegura.
- **Cenário:** dois processos gravam snapshots divergentes ou volume falha após mutação; não executado contra dados reais.
- **Correção:** backend transacional, sessões compartilhadas, importação reconciliada e recuperação ensaiada.
- **Complexidade:** alta, 8–15 dias para migração mínima e ensaio; sobrepõe AUD-014/017.
- **Aceitação:** durabilidade, constraints, comportamento de restart/falha e restore comprovados.
- **Testes:** falha de disco sintética, múltiplos processos, restart e restore com conferência de referências.
- **Bloqueia:** sim para dados reais.

### AUD-005 — PATCH recusado altera paciente em memória

- **Severidade:** MEDIUM.
- **Status:** confirmado no handler original isolado.
- **Categoria:** validação/atomicidade.
- **Arquivo/linha:** `apps/api/src/server.js:1322`, `:1339`, `:1341`; `apps/web/public/app.js:508`.
- **Descrição:** campos são aplicados antes da validação do nome. Resposta 400 não desfaz a alteração.
- **Evidência:** PATCH com nome vazio retornou `400`; `inMemoryName` ficou vazio.
- **Impacto:** cadastro inválido pode persistir numa gravação posterior; perfil chama `p.name[0].toUpperCase()`.
- **Cenário:** usuário autorizado envia nome vazio e depois executa outra operação que grava o store.
- **Correção:** validar cópia/DTO completo antes da mutação; aplicar somente no commit.
- **Complexidade:** baixa, 0,5–1 dia.
- **Aceitação:** 4xx não altera memória nem disco, inclusive payload misto.
- **Testes:** comparar objeto antes/depois de 400, após persistência posterior e abertura de perfil.
- **Bloqueia:** sim antes de dados reais no Node, pela integridade.

### AUD-006 — Arquivamento pela UI não bloqueia portal Python

- **Severidade:** HIGH.
- **Status:** confirmado estaticamente pela comparação dos contratos; sem HTTP/PostgreSQL.
- **Categoria:** revogação/regra de negócio.
- **Arquivo/linha:** `apps/web/public/app.js:432`; `apps/api-python/app/main.py:249`, `:278`, `:137`, `:351`.
- **Descrição:** UI envia `Arquivado`; Python persiste sem normalizar e bloqueia apenas `status == "arquivado"`.
- **Evidência:** enum capitalizado da UI versus comparação case-sensitive em portal_principal/patient_login.
- **Impacto:** paciente arquivado pode continuar lendo planos publicados.
- **Cenário:** arquivar pelo formulário atual e reapresentar cookie ou fazer login no portal Python.
- **Correção:** enum canônico, migração dos estados e revogação na transição.
- **Complexidade:** baixa/média, 1–2 dias.
- **Aceitação:** arquivar por qualquer cliente impede login/me com cookie anterior.
- **Testes:** payload real da UI, grafias inválidas, sessão anterior e reativação conforme política.
- **Bloqueia:** sim para disponibilizar Python.

### AUD-007 — Ciclo profissional de credenciais incompleto

- **Severidade:** HIGH.
- **Status:** ausências confirmadas no código/inventário.
- **Categoria:** autenticação/suporte.
- **Arquivo/linha:** `apps/api/src/server.js:667`, `:730`; `apps/api-python/app/main.py:153`, `:166`; `apps/web/public/index.html:30`.
- **Descrição:** sem recuperação profissional, troca de senha, prova de e-mail ou mecanismo operável de revogação global profissional. MFA também ausente.
- **Evidência:** reset existente é exclusivo de paciente; cadastro emite sessão sem confirmação externa.
- **Impacto:** perda de senha interrompe trabalho; resposta a comprometimento e identidade de endereço não demonstradas.
- **Cenário:** profissional perde senha ou precisa encerrar sessões suspeitas.
- **Correção:** recuperação por canal verificado, tokens atômicos, troca autenticada e revogação; priorizar MFA clínico/admin.
- **Complexidade:** média, 4–7 dias.
- **Aceitação:** recuperação sem enumeração, prova do endereço e revogação verificável.
- **Testes:** expiração/replay/concorrência, restart, mudança de senha e recuperação MFA quando adotada.
- **Bloqueia:** sim antes da oferta comercial; MFA conforme gate de risco aprovado.

### AUD-008 — Controle de abuso parcial e não atômico

- **Severidade:** MEDIUM.
- **Status:** implementação confirmada; abuso distribuído não ensaiado.
- **Categoria:** API4/API6:2023.
- **Arquivo/linha:** `apps/api/src/server.js:181`, `:199`; `apps/api-python/app/main.py:96`, `:156`, `:348`; `apps/web/server.mjs:15`.
- **Descrição:** Node limita quatro rotas por IP/rota em memória; resets não entram. Python count/insert não é atômico, conta por e-mail em login e não limpa hits antigos. Proxy concentra endereços.
- **Evidência:** Node 10/15min por remoteAddress; Python count seguido de add/commit, sem cleanup.
- **Impacto:** força bruta distribuída, bloqueio coletivo atrás de proxy, consumo de hash e crescimento de tabela.
- **Cenário:** variar e-mail no cadastro ou fazer chamadas paralelas; IP do proxy pode bloquear usuários legítimos.
- **Correção:** limiter compartilhado atômico por conta/IP confiável/fluxo, budgets globais e TTL.
- **Complexidade:** média, 2–4 dias.
- **Aceitação:** limites mantidos sob concorrência/réplicas e sem IP spoofing ou bloqueio coletivo indevido.
- **Testes:** proxy real, identidades variadas, reset, concorrência, Retry-After e falha do limiter.
- **Bloqueia:** gate antes de acesso público.

### AUD-009 — Operação, backups e recuperação não demonstrados

- **Severidade:** HIGH.
- **Status:** lacunas de repositório confirmadas; ambiente externo não verificado.
- **Categoria:** DevOps/continuidade.
- **Arquivo/linha:** `docker-compose.yml:1`; `apps/api-python/Dockerfile:1`; `README.md:39`.
- **Descrição:** sem pipeline, ingress TLS, alertas ou restore ensaiado. Dockerfile sem USER e inclui testes. Compose é configuração local, não prova de produção.
- **Evidência:** volume/healthcheck e instrução de pg_dump existem; execução de backup/restore não foi comprovada. Health Python só faz SELECT 1.
- **Impacto:** risco de indisponibilidade prolongada e perda de dados sem recuperação validada.
- **Cenário:** falha de volume ou deploy/schema incompatível sem rollback/restore comprovados.
- **Correção:** staging/produção separados, secrets/TLS, usuário mínimo, deploy/migração explícitos, alertas, backup criptografado e RPO/RTO.
- **Complexidade:** alta, 5–8 dias, depende do backend alvo.
- **Aceitação:** HTTPS real, restore dentro do RTO e rollback/alertas exercitados.
- **Testes:** smoke, falha DB, restore isolado, rollback e alertas.
- **Bloqueia:** sim; gate por falta de evidência, sem alegar falha do provedor.

### AUD-010 — Ciclo técnico de privacidade ausente

- **Severidade:** HIGH.
- **Status:** ausências no código; avaliação jurídica não realizada.
- **Categoria:** privacidade/LGPD técnica.
- **Arquivo/linha:** `apps/api/src/server.js:44`; `apps/api-python/app/models.py:34`; `apps/web/public/index.html:63`.
- **Descrição:** coleta contatos, nascimento, notas e medidas de saúde; sem exportação pessoal, exclusão de conta/dados, retenção ou políticas apresentadas no produto. Arquivar não exclui.
- **Evidência:** inventário sem account-delete/export; modelos e formulários guardam dados clínicos.
- **Impacto:** direitos e prazos de tratamento não são operáveis/demonstráveis.
- **Cenário:** pedido de exportação/exclusão ou backup conserva dados sem política definida.
- **Correção:** definir bases/papéis/prazos com responsável jurídico; exportação tenant-scoped, retenção/exclusão auditadas e procedimento de backup.
- **Complexidade:** alta, 4–8 dias técnicos mais prazo jurídico.
- **Aceitação:** fluxos aprovados de direitos, retenção e compartilhamento; avisos acessíveis.
- **Testes:** exportar/excluir sintéticos, isolamento, dependentes, retenção e restore sem reativar excluídos.
- **Bloqueia:** sim para dados clínicos reais; não é parecer legal de infração.

### AUD-011 — Python publica plano parcialmente incompleto

- **Severidade:** MEDIUM.
- **Status:** confirmado estaticamente.
- **Categoria:** integridade clínica/regras de negócio.
- **Arquivo/linha:** `apps/api-python/app/main.py:494`; `apps/api/src/server.js:428`.
- **Descrição:** Python usa any refeição/any alimento completo; Node exige every refeição/every alimento completo.
- **Evidência:** um item com quantidade/unidade satisfaz o predicado mesmo com outros incompletos.
- **Impacto:** paciente recebe conteúdo que a validação Node recusaria.
- **Cenário:** publicar dois itens, um completo e outro sem quantidade/unidade.
- **Correção:** alinhar contrato clínico e validar todos os itens antes de publicar.
- **Complexidade:** baixa, 0,5–1 dia.
- **Aceitação:** nenhum plano com item obrigatório incompleto publica; rascunho continua permitido.
- **Testes:** nenhum/um/vários itens inválidos, unidade com espaços e comparação de contrato.
- **Bloqueia:** sim antes de uso clínico Python.

### AUD-012 — Concorrência Python sem controle explícito em versões e reset

- **Severidade:** MEDIUM.
- **Status:** risco potencial, não reproduzido em PostgreSQL.
- **Categoria:** integridade/concorrência.
- **Arquivo/linha:** `apps/api-python/app/main.py:372`, `:477`, `:489`.
- **Descrição:** versões JSONB são lidas e sobrescritas sem revision/lock; reset checa used_at antes de hash/commit sem consumo condicional.
- **Evidência:** ausência de lock/UPDATE condicional nesses caminhos. Agenda usa advisory lock e foi diferenciada.
- **Impacto:** possível perda de edição, disputa publish/draft ou replay concorrente.
- **Cenário:** duas transações leem mesma versão/token e confirmam resultados conflitantes.
- **Correção:** controle otimista/transacional, token atômico e conflito 409 definido.
- **Complexidade:** média, 2–3 dias.
- **Aceitação:** publicado imutável, edição não perdida silenciosamente e token consumido uma vez.
- **Testes:** duas conexões com barreiras, draft/draft, publish/draft, reset/reset e rollback.
- **Bloqueia:** validar/corrigir antes de disponibilizar Python.

### AUD-013 — Listagens integrais e N+1

- **Severidade:** MEDIUM.
- **Status:** confirmado no código; capacidade não medida.
- **Categoria:** performance/escalabilidade.
- **Arquivo/linha:** `apps/web/public/app.js:808`; `apps/api-python/app/main.py:208`, `:215`, `:237`, `:411`; `apps/api/src/server.js:92`, `:1255`.
- **Descrição:** Metas faz GET sequencial por paciente; Python carrega coleções e filtra em memória; dashboard consulta por paciente; Node reserializa store global.
- **Evidência:** for...of com await, chamadas .all() antes de filtro e JSON.stringify integral.
- **Impacto:** latência/custo crescem com histórico; tenant grande pressiona processo Node compartilhado.
- **Cenário:** muitos pacientes/metas/versões ou mutações frequentes.
- **Correção:** paginação tenant-scoped, endpoint agregado de metas, filtros SQL e persistência incremental.
- **Complexidade:** média, 3–5 dias.
- **Aceitação:** listas limitadas, queries por tela limitadas, p95/erro definidos e medidos.
- **Testes:** carga com cardinalidade e simultaneidade separadas; EXPLAIN e budgets.
- **Bloqueia:** não isoladamente para piloto pequeno; medir antes de promessa de escala.

### AUD-014 — Paridade Python incompleta e campos aceitos descartados

- **Severidade:** MEDIUM.
- **Status:** confirmado por comparação de contratos.
- **Categoria:** funcionalidade/migração.
- **Arquivo/linha:** `apps/api-python/app/main.py:188`, `:215`, `:404`, `:440`, `:453`; `apps/api-python/app/models.py:87`; `apps/web/public/app.js:706`.
- **Descrição:** dashboard retorna zeros/recent vazio; metas aceitam categoria/prazo mas não os persistem/modelam; faltam rotas atuais de equipe/workspaces, DTOs diferem e não há importador JSON.
- **Evidência:** legacy-preview falso constante; newThisMonth=0; Goal sem categoria/prazo; latestVersion sem mealCount esperado na UI.
- **Impacto:** métricas falsas, perda silenciosa de campos, falhas no cutover/onboarding.
- **Cenário:** apontar frontend atual para Python esperando substituição completa.
- **Correção:** backend/escopo único, contratos alinhados, métricas reais e migração reconciliada.
- **Complexidade:** alta, 5–10 dias para escopo individual, sem clínica completa.
- **Aceitação:** todos os fluxos vendidos funcionam; campos aceitos não desaparecem; dados reconciliados.
- **Testes:** contratos com payloads reais da UI, onboarding, metas/dashboard e importação sintética.
- **Bloqueia:** sim para cutover Python; clínica pode ficar fora da oferta.

### AUD-015 — Dependência de teste vulnerável na imagem e árvore transitiva não travada

- **Severidade:** MEDIUM.
- **Status:** versão afetada confirmada por OSV; exploração HTTP não demonstrada.
- **Categoria:** supply chain.
- **Arquivo/linha:** `apps/api-python/requirements.txt:8`; `apps/api-python/Dockerfile:5`.
- **Descrição:** pytest 8.3.5 é instalado na imagem. GHSA-6w46-j5rx-g56g e PYSEC-2026-1845 são aliases de CVE-2025-71176, tmpdir em Unix. Sem lock transitivo/hash Python.
- **Evidência:** coletor avaliou 9/9 diretas; dois registros deduplicados em um CVE. OSV indica correção em 9.0.3. Transitivas não examinadas.
- **Impacto:** risco local quando pytest executa em Unix e builds não reprodutíveis; nenhum endpoint executa pytest identificado.
- **Cenário:** atacante local interfere no diretório temporário durante testes Unix; presença na imagem não prova acesso remoto.
- **Correção:** separar teste/runtime, remover testes da imagem final, atualizar pytest com validação do salto major e gerar lock/SBOM.
- **Complexidade:** baixa/média, 1–2 dias.
- **Aceitação:** runtime sem pytest; ferramenta de teste corrigida; árvore final auditada.
- **Testes:** build limpo, scan da imagem, testes com nova versão e audit do lock.
- **Bloqueia:** condicional ao cenário Unix; fechar cobertura antes do gate de dependências.

### AUD-016 — Origem Node permissiva sem configuração explícita

- **Severidade:** MEDIUM.
- **Status:** comportamento confirmado; exploração CSRF depende de deployment/browser.
- **Categoria:** CSRF/configuração.
- **Arquivo/linha:** `apps/api/src/server.js:199`, `:175`; `apps/api-python/app/main.py:27`.
- **Descrição:** allowlist vazia aceita Origin arbitrário. Strict reduz CSRF cross-site, mas não valida origem same-site não confiável. Não há token CSRF/validação Content-Type no Node.
- **Evidência:** handler com cookie e Origin externo sintéticos retornou 201 sem CORS_ORIGINS. Não é prova de envio de cookie cross-site pelo browser.
- **Impacto:** possível mutação por origem same-site em deployment permissivo.
- **Cenário:** subdomínio same-site comprometido; condição não validada em domínio real.
- **Correção:** exigir origens em produção, validar mutações/corpo e definir política de subdomínios/CSRF.
- **Complexidade:** baixa, 1–2 dias.
- **Aceitação:** origens ausentes/inválidas rejeitadas conforme política; origem válida funciona.
- **Testes:** browser same-site/cross-site, text/plain, preflight, cookie Strict e proxy real.
- **Bloqueia:** condicional; tratar antes da exposição pública.

### AUD-017 — Migração inicial depende de metadata mutável

- **Severidade:** MEDIUM.
- **Status:** confirmado estaticamente.
- **Categoria:** banco/deploy.
- **Arquivo/linha:** `apps/api-python/migrations/versions/0001_initial.py:3`, `:11`; `apps/api-python/migrations/env.py:6`.
- **Descrição:** revisão importa modelos atuais e chama create_all; se modelos mudarem, bases novas/antigas em mesmo head podem ter schemas distintos. Downgrade é bloqueado deliberadamente.
- **Evidência:** única revisão usa metadata corrente; create_all não altera tabela existente.
- **Impacto:** schema drift e rollback/deploy inconsistentes.
- **Cenário:** adicionar coluna sem revisão explícita e comparar fresh install com base existente.
- **Correção:** DDL congelado e revisões explícitas; estratégia forward fix/restore compatível.
- **Complexidade:** média, 1–2 dias.
- **Aceitação:** mesma revisão produz schema equivalente e upgrades preservam dados.
- **Testes:** comparar catálogo fresh/upgrade, alembic check e restore isolado.
- **Bloqueia:** sim antes do cutover/migração com clientes.

### AUD-018 — Rótulos de formulários dinâmicos sem associação

- **Severidade:** LOW.
- **Status:** markup confirmado; leitor de tela não exercitado.
- **Categoria:** acessibilidade/UX.
- **Arquivo/linha:** `apps/web/public/app.js:97`, `:234`, `:237`, `:476`.
- **Descrição:** label irmão sem for e input sem id; busca/filtro sem nome acessível explícito.
- **Evidência:** template field e editores de alimentos. Toast já possui role=status/aria-live e foco visível existe.
- **Impacto:** dificuldade de preenchimento por leitor de tela/controle por voz e rótulo não clicável.
- **Cenário:** uso assistivo de modal.
- **Correção:** IDs únicos, label for ou wrapping, nomes de busca/filtro e erros associados.
- **Complexidade:** baixa, 1–2 dias.
- **Aceitação:** controles nomeados e navegação/foco de modal verificáveis.
- **Testes:** axe/equivalente, teclado e leitor de tela em dois browsers.
- **Bloqueia:** não como vulnerabilidade; incluir no gate de acessibilidade do piloto.

### AUD-019 — CSP incompatível com estilos inline da UI

- **Severidade:** LOW.
- **Status:** incompatibilidade estática confirmada; aparência não exercitada em browser.
- **Categoria:** headers/UX.
- **Arquivo/linha:** `apps/api/src/server.js:1856`; `apps/web/server.mjs:40`; `apps/web/public/app.js:223`, `:508`.
- **Descrição:** style-src self não permite atributos style usados nos templates, inclusive barras de gráfico.
- **Evidência:** style="height:...%" e diversos styles de espaçamento/layout.
- **Impacto:** gráficos e apresentação podem diferir da intenção com CSP real.
- **Cenário:** dashboard com dados servido pelo Node/web atual.
- **Correção:** CSS/classes e mecanismo seguro para valores dinâmicos, preservando CSP restritiva.
- **Complexidade:** baixa, 1 dia.
- **Aceitação:** sem violações CSP, gráfico correto em desktop/mobile.
- **Testes:** console CSP e screenshots no servidor real.
- **Bloqueia:** não isoladamente; validar antes do piloto.

### AUD-020 — Gate automático e cobertura de confiabilidade insuficientes

- **Severidade:** MEDIUM.
- **Status:** confirmado no repositório; Python/infra não executados agora.
- **Categoria:** testes/DevSecOps.
- **Arquivo/linha:** `package.json:10`; `apps/api/test/application.test.js:26`; `apps/api-python/tests/test_api.py:14`.
- **Descrição:** sem CI, lint semântico, E2E browser, carga/recuperação ou casos concorrentes por fluxo. Node concentra muitas assertions num único teste de integração; Python tem cinco testes.
- **Evidência:** Node passou 3/3, mas probes adicionais acharam falhas fora dessa cobertura.
- **Impacto:** regressões de contrato/permissão chegam sem gate obrigatório.
- **Cenário:** alterar DTO ou revogação sem testes cruzados dos backends/UI.
- **Correção:** CI com PostgreSQL descartável, testes por tenant/papel, contratos UI, replay/concorrência e smoke.
- **Complexidade:** média, 3–5 dias.
- **Aceitação:** pipeline obrigatório reproduzível em ambiente limpo e cobertura dos bloqueadores.
- **Testes:** pipeline com falha controlada, evidências de execução e regressões por achado.
- **Bloqueia:** sim como gate antes de venda.

### AUD-021 — Concentração de código e formatação inconsistente

- **Severidade:** LOW.
- **Status:** confirmado por inventário e Prettier.
- **Categoria:** qualidade/manutenção.
- **Arquivo/linha:** `apps/api/src/server.js:437`; `apps/api-python/app/main.py:1`; `apps/web/public/app.js:1`.
- **Descrição:** servidor Node 1884 linhas, frontend 1383, Python 495 com múltiplas operações por linha. Regras duplicadas entre backends já divergem.
- **Evidência:** Prettier --check exit 1 em server.js, application.test.js, styles.css e server.mjs. Sem TypeScript/type-checker configurado.
- **Impacto:** custo de revisão e risco de drift/regressão.
- **Cenário:** mudar regra em uma implementação e manter outra diferente.
- **Correção:** consolidar alvo, extrair domínio/DTOs e padronizar formato/lint em mudança autorizada separada.
- **Complexidade:** média, 3–6 dias incrementais.
- **Aceitação:** regras críticas testáveis e check de formato passando após correção autorizada.
- **Testes:** regressões dos módulos extraídos, checks de formato/lint.
- **Bloqueia:** não isoladamente.

### AUD-022 — Payloads livres Python geram 500 e preservam extras

- **Severidade:** MEDIUM.
- **Status:** confirmado estaticamente; casos HTTP não executados.
- **Categoria:** validação/API8:2023.
- **Arquivo/linha:** `apps/api-python/app/main.py:460`, `:465`, `:477`, `:485`; `apps/web/public/app.js:49`.
- **Descrição:** UUID(payload["patientId"]) sem tratar ausência/formato; versões mesclam **payload e guardam extras sem contrato/tamanho. Frontend lê error; FastAPI normalmente usa detail.
- **Evidência:** KeyError/ValueError sem conversão 4xx; dicts de entrada e ausência de allowlist de versão.
- **Impacto:** mensagens genéricas, dados extras persistidos e crescimento de JSONB; não prova injection/RCE.
- **Cenário:** cliente autenticado omite patientId, envia UUID inválido ou propriedades extras grandes.
- **Correção:** Pydantic explícito, limites, extra forbid/allowlist, envelope de erro consistente e limite de corpo no ingress.
- **Complexidade:** média, 2–3 dias.
- **Aceitação:** payload inválido retorna 4xx útil, extras não persistem e stack/PII não vazam.
- **Testes:** missing/null/list/UUID inválido, extras, corpo grande e mensagens na UI.
- **Bloqueia:** sim antes de disponibilizar Python publicamente.

### AUD-023 — Reativação de consulta não revalida conflito de agenda

- **Severidade:** MEDIUM.
- **Status:** risco potencial, sequência não executada dinamicamente.
- **Categoria:** integridade/regra de negócio.
- **Arquivo/linha:** `apps/api/src/server.js:1628`, `:1639`; `apps/api-python/app/main.py:432`, `:437`.
- **Descrição:** PATCH aceita status agendada, mas não repete o teste de overlap usado na criação.
- **Evidência:** handlers de status atribuem o novo valor após checar enum/permissão; ausência do predicado de conflito nesse caminho.
- **Impacto:** possível dupla marcação de horário e prejuízo operacional.
- **Cenário:** cancelar consulta A, criar B no horário liberado e reativar A.
- **Correção:** validar transição para agendada com a mesma regra/lock da criação, excluindo a própria consulta.
- **Complexidade:** baixa/média, 1–2 dias.
- **Aceitação:** reativação conflitante retorna 409; transição válida funciona; prestador definido no escopo de clínica.
- **Testes:** sequência cancelar/preencher/reativar e duas reativações concorrentes em banco descartável.
- **Bloqueia:** sim para vender agenda confiável, após confirmar comportamento no backend alvo.

## Cobertura de segurança por vetor

| Vetor | Resultado delimitado |
|---|---|
| SQL injection | Node sem SQL; Python usa SQLAlchemy parametrizado. Nenhuma concatenação SQL controlada pelo cliente identificada. Sem execução dinâmica Python. |
| NoSQL injection | Sem banco NoSQL/query por operador. JSON/JSONB não implica NoSQL injection. N/A ao mecanismo observado. |
| XSS | esc/portalEsc escapam textos/atributos; IDs/números principais são server-side. Templates innerHTML rastreados; nenhum fluxo explorável confirmado. Sem validação browser/dados importados. |
| CSRF/CORS | Strict reduz risco cross-site; Python valida Origin com cookie. Node tem AUD-016; CORS não substitui CSRF. |
| SSRF | Destino do proxy é configurado pelo operador, não URL arbitrária recebida do cliente. Nenhum fluxo SSRF confirmado. |
| Command injection | Runtime sem shell com entrada HTTP; spawn de testes usa caminhos constantes. Shell do Docker usa configuração do operador. |
| Path traversal | Servidores usam path.resolve + prefixo root/separador. Nenhuma leitura fora de public confirmada; symlinks/volumes de deployment não validados. |
| Upload | Sem endpoint/bucket/processamento de upload; N/A hoje. |
| BOLA/privilégios | Membership/workspace/atribuição presentes. Node passou cenários existentes; Python tem AUD-001 intra-tenant. Nenhuma leitura entre tenants demonstrada. |
| Debug/schema | /health público intencional. Python desliga /docs em produção, mas /redoc e /openapi.json seguem defaults. Metadata de API não equivale a prontuário. |
| Headers | JSON Node tem no-store/nosniff/DENY/no-referrer/permissions-policy e HSTS em produção. Estáticos CSP/nosniff, HSTS não uniforme. Python depende de ingress para pacote equivalente, não validado. AUD-019. |
| Erros/logs | Node retorna erro genérico e não registra URL em request_error. Não há stack público confirmado. Python pode gerar 500 por AUD-022; debug não está habilitado explicitamente. |
| Abuso | AUD-008/013/022; sem ataque de negação de serviço. |
| Dependências/integridade | AUD-015/017/020; imagens sem digest fixado e sem SBOM final. |

ASVS temático: validação/encoding AUD-005/022; autenticação/sessão AUD-002/003/007/008; autorização/dados AUD-001/006/010/016; configuração, logging e supply chain AUD-009/015/017/020. API1/API5 revisados em ownership/papéis; API2/3/4/6/8/9 têm lacunas. API7/10 sem fluxo SSRF/consumo de API externa identificado.

## Autenticação e permissões

Login tem erro genérico; cadastro Node distingue duplicidade 409. Hash apenas quando conta existe pode permitir inferência temporal, sem medição estatística. Salt/entropia estão presentes; scrypt Node usa opções padrão, a revisar por política/benchmark. Não há JWT/refresh para auditar. Logout revoga sessão corrente no servidor. Node restart invalida por perda do Map; Python valida expires_at/revoked_at no banco. Reset paciente revoga sessões, sujeito às corridas descritas. Sem MFA, verificação de e-mail, revogação global profissional ou recuperação profissional.

Convites/reset usam tokens aleatórios com hash SHA-256 persistido e expiração. Links usam fragmento #, não enviado na URL HTTP. Compartilhamento é manual; não há e-mail automático implementado. Rotas administrativas Node protegem proprietário/último proprietário e exigem membership pelo parâmetro; demais usam X-Workspace-Id. Python usa workspace da sessão e rejeita header divergente. Login/registros em produção precisam revalidação de cookies/proxy/domínio.

## Multi-tenancy, banco e dados

Nenhum BOLA entre organizações confirmado. Testes Node cobrem isolamento, assistente sem prontuário, atribuição e remoção de membership. Python tem teste escrito de dois workspaces, não executado agora. AUD-001 é quebra entre papéis no mesmo tenant; AUD-006 é quebra de bloqueio de portal. Não renomear esses casos como vazamento entre organizações.

Modelos PostgreSQL têm UUID, unicidade, FKs e FKs compostas workspace/patient em entidades clínicas. Não há RLS/grants mínimos/papéis SQL de runtime declarados; estado real do banco não verificado. Ausência de RLS não prova BOLA. Constraints semânticas de status/medidas/overlap e relação assignment/membership dependem parcialmente da aplicação. Há índices por FK e workspace/start; EXPLAIN, locks, bloat e pool real não avaliados. Agenda Python usa pg_advisory_xact_lock por workspace/profissional antes do conflito, não testado com duas conexões.

Agenda Node conflita por userId de quem criou a consulta. Para vender clínica/equipe, definir prestador, paciente e recurso: agendamento por assistente não identifica prestador clínico explicitamente. Não há cache de registros por tenant, jobs, buckets ou relatórios exportados de runtime identificados. Maps são estado global do processo. JSONB de versões exige limites/controle concorrente.

Backup Node é cópia local apenas durante migração, não rotina periódica externa. README descreve pg_dump/restore, sem ensaio atual. Não há criptografia de campo; TLS/volume/backup dependem de infraestrutura não validada. Hash de senha não cifra prontuário. Exclusão/retensão precisam política de prontuário aprovada, não apagamento indiscriminado.

## Credenciais e Git

Busca de padrões em arquivos versionados e 12 commits/88 blobs únicos alcançáveis não encontrou private keys ou formatos pesquisados de tokens GitHub/AWS/sk_live. Não é detector universal/alta entropia; objetos Git não alcançáveis, backups, credenciais genéricas e contas externas não estão cobertos. Apenas .env.example versionado; .env ignorado, inspecionado somente para nomes de variáveis. Não se atesta força/rotação de valores locais.

Credenciais em database.py/alembic.ini e test-db são defaults de desenvolvimento, sem segredo de produção comprovado. Python exige DATABASE_URL em produção. Bundle/config frontend contém URL/flag públicas, sem token privilegiado identificado. Nenhum segredo foi reproduzido nos relatórios. Não se recomenda rotação como se um vazamento tivesse sido confirmado.

## Dependências

Npm: runtime sem pacotes externos; pnpm-lock contém somente Prettier 3.9.10 dev. `pnpm audit --json` com rede retornou zero advisories e totalDependencies=1/devDependencies=1. Coletor genérico não lê pnpm-lock e usou latest no range Prettier: sua conclusão não substitui audit exato.

Python: 9/9 diretas fixadas avaliadas; oito sem advisory conhecido na consulta e pytest com dois registros do mesmo CVE, AUD-015. Sem lock/SBOM não há versão transitiva confirmada de Starlette/pydantic-core/h11/extras. Não se atribuiu CVE transitivo com base em notícia. ACL de publicação e execução de instalação de 9/9 PyPI não são mensuráveis pelo coletor. Upstream hygiene refere-se às dependências, não ao CI do projeto. Evidências originais em evidence/.

[GHSA pytest](https://github.com/advisories/GHSA-6w46-j5rx-g56g) e [registro OSV](https://api.osv.dev/v1/vulns/GHSA-6w46-j5rx-g56g) indicam problema local Unix, corrigido em 9.0.3. Atualização de 8.3.5 para 9 é major e exige testes. Presença de ferramenta no container não prova exploração HTTP.

## Performance e escala

Tamanhos brutos, sem gzip/transferência medida: app.js 88.200 bytes; portal.js 16.110; styles.css 36.806; index.html 5.781; config.js 120. Sem bundler/build declarado. Config revalidada/no-store; assets no-cache; respostas de dados Node no-store. Proxy web sem timeout explícito de upstream; configurar ingress/budgets. Não há cache distribuído ou processamento assíncrono de jobs.

| Contas cadastradas | Hipótese, não capacidade comprovada | Simultaneidade a medir separadamente |
|---:|---|---|
| 10 | Dataset pequeno oculta N+1; falha de gravação ainda afeta integridade | 1–5 sessões com histórico representativo |
| 100 | Metas tem uma ida sequencial por paciente | 10/25 sessões, p95/erros/DB |
| 1.000 | Snapshots e listas integrais crescem com histórico; pool Python 10+10/processo | 50/100 sessões e espera de pool |
| 10.000 | CPU/memória/JSONB/quotas exigem medição e mudanças | Degraus 100/250+ em staging com limites de parada |

Quantidade de pacientes/histórico por profissional importa; contas cadastradas não são usuários simultâneos. Nenhum teste de carga executado; nenhum throughput garantido. Argon2 reserva ~64 MiB por verificação ativa antes de overhead; não inferir consumo total/throughput. Maps Node e sessões/tokens/hits Python não têm expurgo periódico geral; crescimento potencial, sem heap leak comprovado.

## Monetização e integrações

Sem gateway, checkout, assinatura, webhook ou entitlement identificado no runtime. Validação financeira, idempotência de cobrança, inadimplência, upgrade/downgrade: N/A à implementação atual, não vulnerabilidade de bypass de plano existente. Monetização automática não está entregue; cobrança manual exige escopo/limites/suporte. E-mail, analytics, notificações e workers não foram encontrados implementados. Documentação alvo não prova integração existente.

## UX, qualidade e confiabilidade

Node entrega autenticação/onboarding individual, cadastro, avaliações parciais, agenda, metas, plano versionado/publicação, portal e reset manual. Há estados vazios/loading/retry, dialog nativo e confirmações de suspensão/revogação. Toast já tem aria-live e foco CSS visível; AUD-018 identifica controles específicos. Sem guarda de alterações não salvas; submits genéricos não bloqueiam duplo envio; logout portal não trata falha localmente. Python tem lacunas AUD-006/011/014/022, portanto telas não provam backend pronto.

CSS tem breakpoints/tabelas com overflow. Contraste/zoom/layout/browser/Safari/Firefox/Chrome/leitor de tela não exercitados. agent-browser não estava instalado; não houve instalação de browser. AUD-019 não é avaliação visual por screenshot. Skills de Web Interface Guidelines e agent-browser consultadas; revisão dinâmica permaneceu não verificada.

## Maturidade demonstrável

Rubrica interna: cinco critérios por categoria; cada um 0 ausente/sem demonstração exigida, 10 parcial, 20 atendido no escopo observado. Mede implementação/evidência, não probabilidade de ataque/certificação. Categorias parcialmente verificadas são marcadas; gates externos continuam não verificados, sem afirmar falha do provedor. Não há categoria inteiramente N/A entre as 12; pagamentos N/A excluído. Qualquer gate P0 prevalece sobre a média.

| Categoria | Nota | Peso | Cinco critérios, na ordem dos pontos | Cobertura |
|---|---:|---:|---|---|
| Segurança aplicação | 50 | 12% | 20/10/10/10/0: injection, encoding, origem/headers, abuso, atomicidade | Código + Node; Python parcial |
| Segurança APIs | 50 | 10% | 20/10/10/10/0: autenticação privada, campo, schemas, limites, contrato único | Código + Node |
| Autenticação/autorização | 50 | 12% | 20/20/10/0/0: hash/entropia, TTL, autorização, recuperação profissional, e-mail/MFA | Código + Node |
| Isolamento clientes | 60 | 14% | 20/20/10/10/0: membership, ownership Node, filtros Python, FKs, defesa DB/prova Python | Node validado; banco real NV |
| Banco | 40 | 10% | 10/10/10/10/0: schema, constraints, transações, índices, migração/restore | Estático; execução NV |
| Qualidade | 60 | 5% | 20/10/10/10/10: workspaces, módulos, validação, erros, consistência | Estático + checks |
| Performance | 30 | 5% | 10/10/0/0/10: assets, pool, paginação, carga, budgets parciais | Estático; capacidade NV |
| Infra/DevOps | 20 | 10% | 10/10/0/0/0: compose, health/config, CI, restore, TLS/alertas provados | Repositório; cloud NV |
| Privacidade técnica | 20 | 8% | 10/10/0/0/0: minimização, acesso, direitos, retenção, política operável | Estático; jurídico NV |
| UX | 50 | 4% | 20/10/10/10/0: estados, formulários, responsive CSS, erros, acessibilidade dinâmica | Estático; browser NV |
| Testes/confiabilidade | 40 | 6% | 20/10/10/0/0: Node, isolamento, testes Python presentes, concorrência, CI/E2E/restore | Node executado; demais parciais |
| Comercial | 20 | 4% | 10/10/0/0/0: fluxos, escopo, operação, privacidade, recuperação/suporte | Evidência parcial |

**Geral ponderada: 42,7/100**, soma(nota × peso)/100. Heurística de triagem baseada nos critérios acima, não autorização de lançamento.

## Arquivos e componentes analisados

- Runtime: apps/api/src/{server.js,access-control.js}; apps/web/server.mjs e public/{app.js,portal.js,config.js,index.html,styles.css}; apps/api-python/app/{main.py,models.py,security.py,database.py,__init__.py}.
- Banco/deploy: migrations/{env.py,versions/0001_initial.py,script.py.mako}, alembic.ini, Dockerfile e docker-compose.yml.
- Testes/config: testes Node e Python, três package.json, requirements.txt, pnpm-lock/workspace, .env.example, .gitignore, Prettier e .vscode/tasks.json. Nenhum AGENTS.md aplicável localizado nas buscas de raiz/ancestrais.
- Documentação lida como referência: README, PYTHON_MIGRATION_STATUS, TEST_EXECUTION_DIAGNOSIS, SECURITY_HEALTH_CHECK e SESSION_AND_REVOCATION_CONTRACT. Demais docs de arquitetura/auditorias/planos foram inventariados por arquivo/títulos e consultas direcionadas, sem revalidar integralmente cada texto histórico. Código atual prevalece.
- Excluídos: dependências instaladas/binários/caches, stores/logs de desenvolvimento preexistentes e dados reais. Arquivos raiz server.js/main.py/app.js apareceram na enumeração, mas não foram resolvidos pelo Get-Content como arquivos disponíveis; não são entrypoints dos manifests. Não atribuir runtime a esses nomes.
- Não validados: PostgreSQL vivo/schema/grants/RLS, imagem construída/OS, restore, cloud/IAM/TLS/domínio/ingress/secrets reais, produção, carga, browser e acessibilidade dinâmica. Nenhum componente externo foi declarado seguro sem evidência.

## Parecer obrigatório

**O SaaS pode receber clientes reais hoje? Não. INTERNAL ALPHA, apenas dados fictícios e acesso interno controlado.**

Lançar agora expõe notas a papéis administrativos Python, mantém acesso de paciente arquivado no contrato atual e leva riscos de identidade/reset concorrentes e integridade de persistência Node. Há gates de operação/restore, suporte e privacidade não demonstrados. Nenhuma rota clínica anônima indevida foi confirmada; há exposição indevida de propriedade em rota privada Python. Não foi confirmado acesso entre tenants, incidente real ou vulnerabilidade CRITICAL.

Funcionalidades incompletas: recuperação/verificação profissional, paridade/importação Python, métricas/metas Python, exportação/exclusão/retenção, operação/restore; billing automático/e-mail/notificações não existem. Bloqueadores por backend e gates estão no plano. Estimativa de planejamento para escopo individual: **30–50 dias-pessoa técnicos**, com sobreposição entre itens; não é produtividade medida nem prazo garantido, exclui clínica/billing completos e prazo jurídico/provedor.

Caminho mínimo: backend único e escopo individual → confidencialidade/revogação/atomicidade → persistência/contratos/importação → staging com CI/TLS/backup/restore → privacidade e suporte → piloto fechado monitorado → reavaliação para comercializar no escopo validado. Não exige reescrever todo frontend ou implementar toda arquitetura futura.
