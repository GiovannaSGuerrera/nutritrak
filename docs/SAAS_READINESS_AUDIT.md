# Auditoria técnica de prontidão SaaS — NutriTrack

**Data da auditoria:** 2026-10-29  
**Escopo:** leitura do repositório disponível nesta data; nenhuma mudança funcional foi feita.  
**Conclusão:** **não apto a armazenar dados reais de saúde nem a iniciar piloto comercial**. O MVP confirma fluxos de negócio e inclui verificações úteis de propriedade no servidor, mas sua persistência e sessões são locais, não há limites contra abuso de autenticação, a concorrência não é transacional e faltam controles e evidências operacionais para um serviço de saúde multi-tenant.

## 1. Resumo executivo

O NutriTrack é um monólito pequeno em JavaScript: um servidor HTTP nativo do Node.js serve a interface estática e a API. A aplicação não depende de framework de backend, banco relacional ou biblioteca de autenticação. Os dados ficam em um único arquivo JSON; sessões profissionais e de pacientes ficam em mapas na memória do processo. O workspace usa pnpm e declara suporte a Node.js 20 ou superior.

Foram confirmados no código cadastro e login de profissionais, pacientes, avaliações, agenda, metas, dashboard, planos alimentares versionados e publicados, portal do paciente, convites e redefinição manual de senha. Para os recursos profissionais, as rotas autenticadas filtram registros pelo identificador do profissional e as operações por ID usam a função `owned`. O portal recebe um DTO explícito com planos publicados do paciente vinculado. Isso é uma base de autorização útil para a aplicação atual, mas não constitui uma garantia de isolamento em banco multi-tenant futuro.

Os bloqueadores de maior prioridade são: (1) dados clínicos e credenciais persistidos em arquivo JSON, sem transações ou estratégia comprovada de backup/recuperação; (2) sessões exclusivamente em memória e sem validade aplicada no servidor; (3) ausência de rate limiting e controles contra abuso de login/cadastro; (4) concorrência check-then-act em operações críticas; (5) ausência de infraestrutura de produção documentada e de testes suficientes para demonstrar autorização, fluxos de paciente e falhas de persistência. A pasta `data/` está ignorada pelo Git, mas isso não é criptografia nem backup.

**Recomendação:** preservar a aplicação como demonstração com dados fictícios. Antes de piloto, aprovar o modelo de consultório/equipe, migrar para PostgreSQL com schema e migrações versionadas, introduzir autorização contextual centralizada, sessões persistentes com expiração/revogação, limites de abuso, importação idempotente com reconciliação e um conjunto de testes de isolamento e recuperação. Implantação, backup restaurável, monitoramento e revisão de segurança/privacidade precisam ser demonstrados antes de inserir dados reais. Este relatório não declara conformidade com a LGPD.

### Síntese de prontidão

| Área | Estado observado | Para piloto |
| --- | --- | --- |
| Stack e execução | Node.js nativo, pnpm, servidor e UI no mesmo processo | Compatível; fixar runtime suportado e configurar ambientes/deploy |
| Domínio | Fluxos de MVP implementados, regras concentradas em um arquivo | Extrair casos de uso e formalizar contratos antes de expandir |
| Isolamento atual | Verificações por profissional em rotas profissionais; DTO separado para portal | Cobrir todas as rotas e reforçar constraints/tenant no banco |
| Persistência | `data/store.json`, escrita local serializada em processo | PostgreSQL, migrações, transações, backups e recuperação ensaiada |
| Autenticação | scrypt, cookies HttpOnly/SameSite, tokens aleatórios | Expiração/revogação servidor-side, rate limiting, CSRF/origin e operação segura |
| Operação | Sem configuração de deploy/CI/backup observada | Ambientes, gestão de segredos, observabilidade e resposta a incidentes |
| Evidência de qualidade | Um teste de integração principal | Testes unitários, autorização negativa, concorrência, migração e recuperação |

## 2. Escopo, método e limites

Foram examinados os manifests e lockfile, configuração de workspace, servidor/API, interface web, teste de integração, documentação de arquitetura e migração, `.env.example`, `.gitignore` e a estrutura de persistência. O arquivo `data/store.json` foi tratado sem imprimir valores pessoais: somente nomes das coleções, quantidades e nomes de propriedades foram consultados para confirmar o formato. Os logs locais não foram abertos nem reproduzidos. Nenhum segredo ou dado de paciente é reproduzido neste relatório.

As referências `arquivo:linha` apontam para a versão inspecionada do repositório. O arquivo de store é local e ignorado; suas contagens não devem ser interpretadas como inventário de produção ou dado confiável para migração.

**Classificação das conclusões:** “comprovado” significa diretamente observável no código/configuração; “a verificar” significa que o repositório não permite afirmar o comportamento operacional ou a política necessária. Risco descreve exposição potencial, não incidente confirmado. Probabilidade é uma estimativa qualitativa para o cenário de exposição a que o sistema atual está sujeito.

## 3. Stack e arquitetura identificadas

### Stack e ferramentas

- **Linguagem:** JavaScript CommonJS, sem TypeScript. Evidência: `apps/api/src/server.js:1-6` usa `require` e APIs nativas.
- **Runtime declarado:** Node.js `>=20` em `package.json:6-8` e `apps/api/package.json`; versão local observada no ambiente da auditoria: **v24.21.0**. A versão do ambiente não é garantia do runtime de implantação.
- **Gerenciador:** pnpm **11.25.0**, declarado em `package.json:5`; a workspace inclui `apps/*` (`pnpm-workspace.yaml`).
- **Dependências:** nenhum pacote de runtime nas aplicações; Prettier `^3.9.10` é dependência de desenvolvimento na raiz (`package.json:15-17`). O lockfile fixa a resolução. Não foi feita varredura de advisory/OSV, e a ausência de dependências externas de runtime não elimina riscos de Node, código próprio ou dependências de desenvolvimento.
- **Backend:** servidor `node:http` próprio, com roteamento manual, persistência, validação e regras em `apps/api/src/server.js`.
- **Frontend:** HTML/CSS/JavaScript estáticos em `apps/web/public/`; servido pela própria API (`apps/api/src/server.js:921-940`). Não há framework web no manifesto.
- **Testes:** `node:test` e `node:assert` em `apps/api/test/application.test.js`; um teste de integração principal.
- **Scripts:** `dev`, `start`, `test`, `format` na raiz e API (`package.json:9-13`, `apps/api/package.json`). Não há script de build.
- **Implantação:** nenhum Dockerfile, pipeline CI, manifesto de hospedagem, IaC ou configuração de deploy apareceu no inventário do repositório. Isso comprova ausência de configuração versionada examinada, não ausência de infraestrutura fora do repo.
- **Configuração:** `.env.example` lista apenas `PORT` e `NODE_ENV`. O servidor também aceita `DATA_DIR` (`server.js:8-12`); a documentação explica que Node não carrega `.env.example` automaticamente (`README.md`). Não há validação central de configuração nem gestão de segredo configurada.

### Estrutura e fluxo atual

```text
navegador → servidor HTTP Node.js
              ├── API /api/* → regras e autorização em server.js
              ├── arquivos estáticos → apps/web/public/
              └── estado local → data/store.json
sessões profissional/paciente → Map em memória do processo
```

Pastas principais: `apps/api/src` (servidor), `apps/api/test` (teste), `apps/web/public` (UI), `data` (store local ignorado) e `docs` (arquitetura, decisões e desenvolvimento). A separação API/web é organizacional: não há deploy independente confirmado.

## 4. Funcionalidades confirmadas no código

As afirmações abaixo foram conferidas no servidor, não inferidas apenas do README:

- Cadastro e login profissional, comparação de senha derivada por scrypt e logout (`server.js:440-505`).
- CRUD parcial de pacientes: criação, edição, listagem, busca/filtro no cliente e perfil; a API oferece GET/POST/PATCH, não foi identificado endpoint de exclusão (`server.js:552-608`; UI em `apps/web/public/app.js`).
- Avaliação antropométrica, validação parcial de peso/altura/gordura e cálculos de IMC, massa gorda e massa magra (`server.js:676-719`).
- Agenda: criação futura, detecção de sobreposição por profissional, listagem e alteração de status (`server.js:721-765`, `912-918`).
- Metas e registro de progresso (`server.js:767-801`).
- Dashboard derivado das coleções (`server.js:511-550`).
- Planos alimentares com rascunho, versões e publicação de snapshot. Edição de rascunho não substitui versões publicadas; a publicação valida quantidade/unidade mínimas (`server.js:188-241`, `803-910`).
- Portal de paciente autenticado separadamente. O DTO inclui nome do paciente/profissional e somente o plano publicado apontado pelo ID de versão publicado; não inclui avaliações, agenda ou notas clínicas (`server.js:113-160`, `430-438`).
- Convites de uso único, tokens aleatórios de 32 bytes, persistência do hash SHA-256, validade de sete dias e verificação do e-mail já cadastrado (`server.js:251-349`, `610-645`).
- Redefinição manual de senha do portal, token de uso único com validade de 24 horas, hash persistido e invalidação das sessões de paciente ao concluir. O profissional gera e compartilha o link; não há envio automático por e-mail (`server.js:372-422`, `647-674`).
- Trilha operacional limitada às últimas 500 ações registradas por `audit()` (`server.js:171-180`). Não é trilha imutável nem cobertura completa de acesso.
- Cabeçalhos `nosniff`, `no-store` na resposta JSON e CSP nos arquivos estáticos (`server.js:66-72`, `921-935`).

## 5. Matriz priorizada de riscos

| ID | Severidade / prioridade | Problema comprovado ou hipótese | Probabilidade estimada |
| --- | --- | --- | --- |
| R1 | **CRÍTICO — P0** | Persistência JSON local com dados clínicos e credenciais, sem transações/backup demonstrado | Alta no uso contínuo ou multi-instância |
| R2 | **ALTO — P0** | Sessão sem expiração servidor-side e somente em memória | Média-alta |
| R3 | **ALTO — P0** | Sem rate limiting/limite de tentativas em autenticação e endpoints de token | Alta sob exposição pública |
| R4 | **ALTO — P0** | Não há evidência de preparação operacional para produção; HTTPS, backups, deploy, monitoramento e gestão de segredos não estão versionados | Média-alta; consequência alta |
| R5 | **ALTO — P1** | Sem garantia de tenant no banco; modelo atual pressupõe proprietário individual e não modela consultório/equipe | Média conforme expansão |
| R6 | **ALTO — P1** | Testes de autorização, paciente, segurança e persistência são insuficientes para comprovar limites críticos | Alta probabilidade de defeito não detectado |
| R7 | **MÉDIO — P1** | Condições de corrida em verificações e gravações críticas | Média sob requisições simultâneas |
| R8 | **MÉDIO — P1** | Dados de requisição potencialmente sensíveis podem entrar em log via URL | Baixa-média; depende de URLs usadas/proxy |
| R9 | **MÉDIO — P2** | Validação de entrada é desigual entre entidades/campos | Média |
| R10 | **MÉDIO — P2** | CSRF mitigado parcialmente por SameSite, sem verificação explícita de origem/token | Baixa-média no mesmo site; depende da implantação |
| R11 | **MÉDIO — P2** | Modelo de paciente/convites é vínculo único e não resolve clínica, múltiplos responsáveis ou ciclo de vida | Média antes de expansão |
| R12 | **BAIXO — P2** | Exceções de decodificação de caminho podem ser reportadas como erro interno e logadas como URL | Baixa |

### Detalhamento dos riscos

#### R1 — Store local não é persistência segura de produção (**CRÍTICO — P0**)

- **Descrição:** o arquivo único armazena pacientes, notas clínicas, medidas, contas, hashes de senha, tokens hasheados e auditoria. Não há banco, constraints, transações, criptografia em repouso implementada pela aplicação, estratégia de backup nem restauração demonstrada.
- **Evidência:** `server.js:8-11, 22-65`; `data/store.json` está sob `data/`, excluído pelo `.gitignore`; propriedades presentes nas coleções incluem `clinicalNotes`, medidas e `hash`/`salt` (estrutura inspecionada sem expor valores). Escrita é arquivo temporário e rename, mas isso não equivale a transação ou backup.
- **Impacto:** corrupção, perda ou cópia indevida do arquivo pode expor dados pessoais sensíveis e comprometer a continuidade. Dois processos/instâncias podem sobrescrever atualizações entre si. Ausência de dados reais hoje não pode ser presumida para o futuro.
- **Probabilidade estimada:** alta se exposto a mais de uma instância ou usado como base de operação; média-alta mesmo em uma instância sem backup.
- **Mitigação recomendada:** antes de qualquer dado real, PostgreSQL gerenciado com TLS, controle de acesso mínimo, backups criptografados e retenção definida, teste regular de restauração, transações, constraints e migrações versionadas. Tratar JSON como origem legada de migração com acesso restrito e retenção definida.

#### R2 — Validade de sessão não é aplicada no servidor (**ALTO — P0**)

- **Descrição:** o cookie informa `Max-Age=28800`, mas o `Map` armazena somente token → ID, sem `expiresAt`; `userFor()` e `patientAccountFor()` aceitam qualquer token ainda presente. O limite do cookie depende do cliente e não encerra uma cópia de cookie já obtida. Reinício encerra todas as sessões.
- **Evidência:** `server.js:13-14, 94-108, 473-499`; sessão de paciente em `367-370`; logout remove só o token apresentado (`501-505` e `424-428`).
- **Impacto:** token roubado pode continuar utilizável até logout explícito ou reinício; em produção multi-instância o mapa não compartilha sessões e causa falhas inconsistentes.
- **Probabilidade estimada:** média-alta com exposição de navegador, máquina compartilhada ou implantação distribuída.
- **Mitigação recomendada:** armazenamento de sessão compartilhado, expiração absoluta e ociosa validadas no backend, rotação no login e mudança de privilégio, revogação global/por conta, política de sessão pós-alteração de senha e cookies seguros por ambiente. Definir estratégia de recuperação de indisponibilidade do store de sessão.

#### R3 — Ausência de limite de tentativas e abuso automatizado (**ALTO — P0**)

- **Descrição:** cadastro e login de profissional/paciente não mostram contador, atraso ou bloqueio por IP/conta. Endpoints públicos de validação/ativação de convite e reset também não apresentam limite. scrypt encarece cada tentativa, mas não substitui proteção de abuso.
- **Evidência:** `server.js:251-423, 440-499`; documentação do estado atual também lista rate limiting pendente em `docs/architecture/current-state.md:37-46`.
- **Impacto:** tentativa automatizada de senha, consumo de CPU, enumeração/abuso de cadastro e potencial indisponibilidade; o erro de login é genérico, o que ajuda, mas a conta inexistente não executa scrypt, permitindo diferença de custo observável.
- **Probabilidade estimada:** alta quando endpoints forem publicamente acessíveis.
- **Mitigação recomendada:** limitar por combinação de conta/IP e por operação, respostas uniformes, limitação de cadastro/convites/reset, monitorar abuso sem guardar segredo ou dado clínico, avaliar CAPTCHA progressivo e alerta operacional. Testar limites e contorno por concorrência.

#### R4 — Implantação e operação de produção não demonstradas (**ALTO — P0**)

- **Descrição:** o repositório não contém configuração versionada de deploy, CI, HTTPS/proxy confiável, gestão de segredos, backup, monitoramento/alerta, política de logs ou recuperação de desastre. `.env.example` contém somente porta e modo; o `Secure` do cookie depende de `NODE_ENV === 'production'`.
- **Evidência:** inventário do workspace; `server.js:104-108, 475-498`; `.env.example`; `README.md` descreve a versão como não preparada para produção; `docs/architecture/target.md:59-61` lista controles ainda pendentes.
- **Impacto:** configuração incorreta pode deixar transporte ou dados desprotegidos, tornar incidentes indetectáveis e impedir recuperação. Infra externa pode existir, portanto a lacuna é de evidência verificável no repositório.
- **Probabilidade estimada:** média-alta sem processo de implantação formal; consequência alta para disponibilidade e confidencialidade.
- **Mitigação recomendada:** definir infra e ambientes separados, HTTPS obrigatório, secrets manager, configuração fail-fast, logs estruturados sem dados pessoais, métricas/alertas, plano de incidentes, política de retenção e ensaio documentado de backup/restauração. Verificar a configuração real do provedor antes do piloto.

#### R5 — Isolamento futuro depende de convenção na aplicação (**ALTO — P1**)

- **Descrição:** hoje existe `userId`/`professionalId` e as operações verificam a propriedade. No PostgreSQL futuro, uma consulta esquecida ou relação inconsistente pode romper isolamento se o tenant não for imposto por constraints e contexto confiável. O modelo atual representa uma profissional como dona e não modela consultório, equipe, papéis ou transferência de paciente.
- **Evidência:** helper `owned()` em `server.js:168-170`; filtros/checagens nas rotas, por exemplo pacientes `552-608`, avaliações `676-719`, agenda/metas `721-801`, planos `803-910`; modelo futuro ainda provisório em `docs/architecture/target.md:45-49`.
- **Impacto:** acesso cruzado a dados clínicos entre consultórios ou dentro de relações de equipe mal definidas.
- **Probabilidade estimada:** baixa-média no código atual coberto pelas verificações observadas; média-alta após expansão sem um modelo formal.
- **Mitigação recomendada:** decidir `tenant/clinic`, membros e papéis antes do schema; aplicar tenant em todas as tabelas e chaves estrangeiras compostas; derivar escopo da sessão, nunca do payload; autorização em serviço e consultas; considerar Row-Level Security como defesa adicional; testes negativos para cada operação e papel.

#### R6 — Cobertura de teste insuficiente para o risco do produto (**ALTO — P1**)

- **Descrição:** existe um único teste de integração principal. Ele cobre registro, avaliação/cálculo, rascunho/publicação/versionamento, leitura por outro profissional de paciente/plano e conflito de agenda. Não prova todos os IDs manipulados, todos os endpoints, contas de paciente, token único/expiração, CSRF, limites, sessões, persistência concorrente ou falhas de recuperação.
- **Evidência:** `apps/api/test/application.test.js:19-176`; ausência de outros arquivos de teste no inventário; `docs/architecture/current-state.md:39-46` registra a cobertura estreita.
- **Impacto:** regressões e brechas de autorização podem chegar à produção sem detecção automatizada.
- **Probabilidade estimada:** alta de defeitos não detectados diante de mudanças; probabilidade de exploração não inferível apenas pelo número de testes.
- **Mitigação recomendada:** matriz de testes por endpoint/papel/tenant, unitários para domínio, integração para banco e migrações, abuso/autenticação, paciente/portal, concorrência, backup/restore e regressões de versões publicadas. Exigir CI e bloqueio de merge por verificações reproduzíveis.

#### R7 — Operações check-then-act não são atômicas (**MÉDIO — P1**)

- **Descrição:** checar conflito da agenda e depois inserir, ou checar e-mail duplicado e depois cadastrar, envolve etapas separadas. Sob requisições simultâneas, ambas podem passar antes da gravação. A fila de gravação evita sobreposição de chamadas `persist()` dentro do processo, mas não transforma a regra de negócio e a escrita em operação atômica; tampouco coordena processos distintos.
- **Evidência:** conflito seguido de `push` em `server.js:730-752`; unicidade de e-mail seguida de scrypt e inserção em `455-472`; `writeQueue` apenas encadeia gravação em `34, 58-65`.
- **Impacto:** horários duplicados, e-mails repetidos e estado incoerente. Regras similares podem falhar em convites ou versão de plano sob concorrência/distribuição.
- **Probabilidade estimada:** média em uso concorrente; cresce com múltiplos usuários/instâncias.
- **Mitigação recomendada:** transação e índices/constraints no PostgreSQL; conflito de agenda por constraint adequada (exclusion constraint quando viável) ou bloqueio transacional; unicidade normalizada de e-mail; operações de consumo de convite/reset com atualização condicional atômica. Testar chamadas paralelas.

#### R8 — Logs podem registrar URL de requisição (**MÉDIO — P1**)

- **Descrição:** o logger de erro grava `req.url` inteira. Isso pode incluir parâmetros de query com identificadores ou informações que clientes/proxies coloquem na URL. Não foi observado log de corpo, cookie ou segredo explícito no código examinado. Tokens dos links atuais estão no fragmento `#`, que o navegador não envia ao servidor na requisição HTTP; ainda assim, esse formato não protege futuras URLs.
- **Evidência:** `server.js:942-950`; links de convite/reset criados com fragmento em `apps/web/public/portal.js:133-134, 161-162`.
- **Impacto:** retenção desnecessária de dado pessoal em logs e cópias de observabilidade; risco maior se futuramente tokens forem enviados em path/query.
- **Probabilidade estimada:** baixa-média, dependendo dos parâmetros e da configuração do servidor/proxy.
- **Mitigação recomendada:** logar rota normalizada sem query e sem valores de identificadores; definir allowlist de campos; revisar logs do proxy/plataforma, retenção e acesso; redigir tokens antes da emissão. Não registrar corpo, senha, cookie ou conteúdo clínico.

#### R9 — Validação desigual entre entidades e operações (**MÉDIO — P2**)

- **Descrição:** validação explícita e limites existem em pontos importantes, mas não formam schema uniforme. Por exemplo, cadastro de paciente limita nome e corta comprimentos, porém aceita e-mail/telefone/data sem validar formato; edição converte valores arbitrários em texto e não valida enum de status; `waist`/`hip` são convertidos sem as mesmas faixas explícitas de peso/altura/gordura. Formato da data de avaliação é verificado por regex, sem validação calendárica.
- **Evidência:** `server.js:165-166, 558-590, 683-715`; validações de plano em `188-241` são mais explícitas.
- **Impacto:** dados inválidos, inconsistentes ou surpreendentes degradam cálculos, relatórios e migração; payloads ainda estão limitados a 1 MB (`74-85`).
- **Probabilidade estimada:** média.
- **Mitigação recomendada:** schemas de entrada por operação no servidor, normalização consistente, enum/range/data real, validação de relações, limites explícitos e respostas sem eco de conteúdo sensível. Preservar dados históricos inválidos com relatório de reconciliação na migração em vez de descartar silenciosamente.

#### R10 — CSRF sem verificação explícita de origem/token (**MÉDIO — P2**)

- **Descrição:** cookies são `SameSite=Strict` e HttpOnly, o que reduz exposição a vários cenários de CSRF. Não há token CSRF nem checagem explícita de `Origin`/`Sec-Fetch-Site` nas mutações. A proteção depende de uso same-origin e da configuração de hospedagem.
- **Evidência:** construção de cookie em `server.js:104-108, 475-498`; nenhuma checagem de origem observada no handler (`243-920`).
- **Impacto:** um contexto same-site não confiável ou mudança de domínio/proxy pode abrir mutações autenticadas cross-origin; risco deve ser avaliado considerando domínios e cookies finais.
- **Probabilidade estimada:** baixa-média na implantação same-origin atual; pode aumentar com subdomínios ou alteração de arquitetura.
- **Mitigação recomendada:** allowlist de Origin para operações mutáveis, política de CORS restritiva, token CSRF se o modelo exigir e testes em navegador/proxy para o domínio real. Manter SameSite e Secure como defesa em camadas.

#### R11 — Domínio de paciente e tenant ainda não fechado (**MÉDIO — P1**)

- **Descrição:** uma conta de paciente é ligada a um cadastro e profissional; não há vínculo reutilizável de identidade do paciente com múltiplos profissionais, nem entidades de clínica/equipe. Isso pode ser correto para o MVP, mas não está decidido para o produto comercial.
- **Evidência:** criação da conta em `server.js:315-325`; busca do paciente por `patientId` + `professionalId` em `113-117`; proposta e ressalva explícita em `docs/architecture/target.md:45-49`.
- **Impacto:** duplicação de identidades, transferências difíceis e compartilhamento de dados excessivo ou insuficiente em operação de equipe.
- **Probabilidade estimada:** média antes de onboarding de clínicas/equipes.
- **Mitigação recomendada:** decisão de produto/domínio sobre profissional individual, organização, papéis, convite, transferência, encerramento do vínculo e acesso do paciente. Só então definir chaves, constraints e regras de retenção.

#### R12 — Erro de URI no caminho estático é tratado como erro genérico (**BAIXO — P2**)

- **Descrição:** `decodeURIComponent()` pode lançar em URI malformada e não está isolado em `serveStatic`; o catch global registra o caminho e responde 500. Não foi confirmado bypass de diretório: após resolver o caminho existe uma verificação de prefixo com separador.
- **Evidência:** `server.js:921-940` e tratamento global `942-950`.
- **Impacto:** ruído de erro/log e resposta inadequada em requisição malformada; sem evidência de leitura fora do diretório estático.
- **Probabilidade estimada:** baixa.
- **Mitigação recomendada:** validar/decode do path com resposta 400 e log sanitizado; adicionar testes de traversal e URI malformada.

## 6. Avaliação da autenticação e autorização

### Senhas e credenciais

- Senhas de profissionais e pacientes são armazenadas como resultado de `crypto.scrypt` com salt aleatório de 16 bytes e saída de 64 bytes; a senha em texto não é persistida no fluxo normal observado (`server.js:316-325, 460-468`). Isso é preferível a texto puro, mas parâmetros não são explicitamente fixados/documentados e não há fluxo de alteração de senha profissional no código examinado. Avaliar custo e política de senha para o runtime de produção e migração futura.
- Cadastro exige 12–200 caracteres (`server.js:445-450`); portal também (`292-295`, reset `402-403`). Login não repete limite máximo antes do scrypt; aplicar limites contra payloads custosos.
- Comparação do hash usa `timingSafeEqual`? **Não**: é usado `Buffer.equals()` (`server.js:358-360, 487-492`). A função não é documentada no código como comparação em tempo constante. Padronizar comparação segura e formatos validados.
- Nenhum mecanismo de recuperação automática por e-mail está implementado. Redefinição do portal é iniciada pelo profissional e o link é compartilhado manualmente. Não foi identificado reset de senha de profissional.

### Sessões e cookies

- Tokens são gerados com `randomBytes(32)`; IDs de sessão ficam em `Map` no processo (`server.js:345-348, 367-370, 473-499`). Não há expiração server-side, armazenamento compartilhado ou revogação de todas as sessões profissionais. `Max-Age` do cookie não substitui validade do token no servidor.
- Cookies são `HttpOnly`, `SameSite=Strict`, `Path=/`; `Secure` só é anexado quando `NODE_ENV` é exatamente `production` (`server.js:104-108`). É necessário verificar o ambiente e HTTPS de fato no deploy.
- Logout do profissional remove apenas o token recebido; o reset do paciente percorre e apaga sessões daquele account (`server.js:417-427, 501-505`). Reinício descarta mapas e encerra sessões.

### Convites e redefinição do portal

- Tokens são 256 bits de aleatoriedade e somente SHA-256 é salvo. Convite expira em sete dias; reset em 24 horas; ambos testam uso/revogação/expiração no servidor (`server.js:110-111, 253-258, 374-380, 631-674`). Essa construção é razoável como fluxo de token de uso único.
- A resposta de validação do convite mostra nome do paciente e profissional a quem apresentar o token (`260-271`); isso é exposição esperada a quem possui o convite, mas requer compartilhamento por canal adequado e revogação rápida.
- Links são retornados ao navegador profissional e copiados para compartilhamento manual; não existe e-mail transacional ou auditoria de entrega. Resposta da rota é `no-store` por padrão JSON (`66-72`), e tokens ficam no fragmento de URL no cliente.
- A marcação de uso e criação de conta não são transação de banco. A semântica “uso único” precisa ser imposta atomicamente no armazenamento persistente futuro.

### Autorização por servidor e isolamento

- Após rotas públicas de autenticação/portal, o handler exige profissional autenticado antes das rotas de aplicação (`server.js:507-510`). `owned(list,id,userId)` compara ID e `userId` (`168-170`). Criação de avaliação, consulta, meta e plano confirma que o paciente pertence ao profissional (`685-686, 723-724, 769-770, 834-835`). Leitura/alteração por ID de paciente, consulta, meta e plano usa propriedade do profissional (`581-594, 757-758, 790-792, 857-866, 893-895`).
- Não foi encontrado endpoint de leitura/alteração de recurso profissional que, no código observado, use somente ID sem exigir sessão e verificar propriedade. Teste cobre tentativa cruzada de paciente e plano (`141-160`), mas não cobre todas as rotas.
- O portal autentica em cookie separado e não usa `nc_session`; `safePatientPortal()` valida a relação paciente/profissional e cria whitelist de campos publicados (`99-102, 113-160, 430-438`). Boa separação, ainda dependente de integridade do store e da cobertura de teste.

## 7. Persistência atual e migração para PostgreSQL

### Leitura e escrita

`loadStore()` cria diretório, lê e faz `JSON.parse`; arquivo ausente inicializa store e persiste. JSON inválido ou erro diferente de `ENOENT` aborta a inicialização (`server.js:36-56`). Depois são normalizadas coleções ausentes para arrays, sem validação de registros, versão de schema ou migração local.

`persist()` encadeia gravações em `writeQueue`, serializa o objeto inteiro, escreve arquivo temporário com modo solicitado `0600` e renomeia (`server.js:58-65`). A escrita temporária reduz risco de arquivo parcialmente substituído em certos sistemas de arquivos, mas não há `fsync`, backup automático, restauração, lock interprocesso ou transação. Uma falha de gravação rejeita `writeQueue`; como a próxima operação encadeia diretamente um `.then()`, a fila pode continuar rejeitada e bloquear futuras persistências até reinício. As alterações já feitas na memória não são revertidas.

O arquivo inteiro é relido apenas na inicialização e regravado após mutações. Isso limita escala; em duas instâncias, cada uma mantém cópia independente e o último rename pode sobrescrever dados gravados pela outra. `.gitignore` exclui `data/`, o que reduz inclusão acidental no Git, mas não fornece controle de acesso, criptografia ou cópia de segurança.

### Relações e identificadores observados

O store tem coleções `users`, `patients`, `assessments`, `appointments`, `goals`, `mealPlans`, `patientInvitations`, `patientPasswordResets`, `patientAccounts` e `audit` (`server.js:22-33`). Entidades usam UUIDs criados por `crypto.randomUUID()`. Relações são referências em campos como `userId`, `professionalId`, `patientId`, `accountId`, `publishedVersionId`; não há foreign keys nem unicidade no armazenamento atual. Planos guardam `versions[]` embutidas com refeições/itens; isso preserva snapshot dentro do agregado, mas cria decisões de normalização e retenção para o modelo relacional.

### Estratégia de migração não destrutiva

1. **Decidir domínio e inventário:** definir profissional/consultório, vínculos de paciente, duplicatas, estados arquivados, significado de cada coleção e política para contas, convites, resets, versões e auditoria. Não inferir relações por e-mail sem revisão.
2. **Preservar a origem:** antes de exportar, obter cópia criptografada, acesso restrito, checksum, data, responsável e teste de legibilidade. Manter original imutável até aprovação formal da reconciliação e do prazo de retenção.
3. **Especificar schema:** tabelas para tenants/organizações e membros, perfis, pacientes e vínculo, avaliações, consultas, metas e progresso, planos e versões, contas de paciente, convites/resets e eventos de auditoria. Definir FKs e unicidade normalizada; armazenar todas as datas com timezone e validar regras de domínio.
4. **Criar migrações aditivas versionadas:** ambiente local/staging separado, seed apenas fictício, revisão de schema e execução repetível; não incluir drop/limpeza automática como parte do importador.
5. **Importador idempotente e em modo de ensaio:** usar UUIDs existentes quando únicos e válidos; mapear relações com relatório; preservar versões publicadas e vínculo `publishedVersionId`; tratar órfãos, duplicatas, campos inválidos e hash/salt como exceções explícitas; tokens ativos não devem ser migrados sem decisão de segurança — invalidá-los e reemitir com comunicação planejada pode ser mais seguro.
6. **Reconciliação:** comparar por tenant e entidade contagens, IDs, órfãos, duplicatas, datas e referências de plano publicado; comparar checksum/exports protegidos sem expor dados em logs. Validar amostras sob acesso autorizado, sem incluir conteúdo pessoal no relatório técnico.
7. **Cutover controlado:** congelar escrita ou usar janela/estratégia de dupla escrita cuidadosamente testada; executar importação final, smoke tests, habilitar leitura/escrita, monitorar e manter rollback para origem preservada. Definir de antemão critério de rollback e duração, sem rollback que reintroduza divergência silenciosa.
8. **Encerramento:** após aceite e janela de retenção decidida, restringir e eliminar a cópia antiga segundo política aprovada e documentar evidência. Não apagar automaticamente a origem.

**Compatibilidade:** PostgreSQL é compatível com a stack Node.js atual via driver ou ORM. Prisma é uma alternativa já documentada, mas não é requisito técnico. A escolha deve seguir o schema, estratégia de migrações e familiaridade operacional; não há justificativa para substituir o runtime/framework ao mesmo tempo que a persistência. O monólito pode permanecer como aplicação web única enquanto módulos e repositório evoluem.

## 8. Arquitetura SaaS recomendada

1. **Aplicação:** manter inicialmente uma aplicação web única e API Node.js, extraindo módulos de autenticação, domínio, persistência e auditoria. Separar deploy web/API apenas com benefício operacional concreto. Definir contrato HTTP/OpenAPI antes de clientes móveis.
2. **Banco:** PostgreSQL gerenciado com backups automáticos, criptografia/transporte configurados pelo provedor, migrações revisadas, connection pooling, constraints de tenant e transações. Row-Level Security pode adicionar defesa em profundidade; não substituir autorização da API.
3. **Tenant:** escolher entre consultório como tenant e profissional individual como tenant. Cada registro clínico deve portar tenant ou ter ligação por FK composta inequívoca. Tenant deriva da sessão/membership autorizada, nunca de `tenantId` fornecido pelo cliente.
4. **Autorização:** centralizar funções/policies para ações e recursos; distinguir profissionais, administradores de consultório, equipe e paciente. DTOs por público com allowlist. Revisar acesso de suporte/administrador e registrar acessos privilegiados.
5. **Identidade:** sessão opaca persistente com expiração e revogação server-side; política para MFA e recuperação de profissional decidida antes do piloto; limites por conta/IP; rotação e encerramento de sessões; e-mail transacional para verificação e recuperação, sem revelar se uma conta existe.
6. **Ambientes/segredos:** desenvolvimento, homologação e produção separados; dados fictícios em desenvolvimento; segredos em cofre do provedor; inicialização valida configuração obrigatória; HTTPS e cookies `Secure` em produção.
7. **Operação:** backups com recuperação testada, RPO/RTO decididos, health checks, logs estruturados com minimização/redação, métricas e alertas sem conteúdo clínico, gestão de incidentes e plano de atualização de runtime/dependências.
8. **Produto comercial:** provedor de pagamento/assinaturas isolado de dados clínicos, webhooks idempotentes e estado de cobrança separado de autorização clínica; critérios de cancelamento, inadimplência e exportação definidos. Não armazenar dados de cartão se checkout/tokenização do provedor atender ao produto.
9. **Privacidade:** antes do uso de saúde real, revisar com responsáveis qualificados papéis de controlador/operador, bases legais, transparência, direitos do titular, retenção, contratos com operadores, fluxo de incidente e avaliação de impacto quando aplicável. Código sozinho não prova conformidade legal.

## 9. Testes necessários antes do piloto

Os testes abaixo são recomendações; não foram executados nesta auditoria.

- **Autenticação:** cadastro/login/logout, senha inválida, conta inexistente e existente com respostas indistinguíveis, limites de tentativas, rotação/expiração/revogação de sessão, cookie em produção, reset de senha profissional e sessões concorrentes.
- **Autorização/tenant:** para cada método/rota, dois tenants e papéis distintos; IDs válidos de outra profissional; ID de paciente incompatível com consulta/meta/plano; portal paciente tentando dados de outro vínculo; tenant adulterado no body/query; acesso após arquivamento/transferência.
- **Convite/reset:** token aleatório, expiração, revogação, reuso, e-mail divergente, token inválido, uso simultâneo, conta já criada, sessão revogada e resposta que não exponha dados em excesso.
- **Domínio:** limites e tipos de cada campo; datas inválidas; valores antropométricos extremos; conflito de consulta inclusive requisições simultâneas; meta e estados permitidos; regras de publicação e invariância de versões publicadas.
- **Persistência:** falha de disco/DB, restart, rollback, transação interrompida, fila/conexão, concorrência, integridade referencial, índices e idempotência de migrações/importação.
- **Portal/privacidade:** snapshot publicado correto, rascunho e dados internos ausentes, versão histórica, HTML malicioso em todos os campos renderizados, headers CSP e ausência de conteúdo pessoal em logs.
- **Operação:** smoke test por ambiente, backup criptografado e restauração cronometrada, rotação de segredo, indisponibilidade do e-mail/DB, alertas, deploy e rollback.
- **Migração:** fixtures fictícias representativas, duplicatas/órfãos, contagem e reconciliação, importação repetida, preservação de UUIDs e versão publicada, rollback para origem preservada.

## 10. Dependências entre etapas e roadmap priorizado

| Ordem | Etapa | Depende de | Saída verificável / porta de avanço |
| --- | --- | --- | --- |
| 0 | Definir modelo comercial e de dados: profissional vs consultório/equipe, papéis, vínculo e transferência de paciente, retenção e escopo do piloto | Decisão humana de produto/domínio | ADRs aprovados e matriz de acesso; nenhum tenant inferido |
| 1 | Fechar riscos imediatos: threat model, especificação de autenticação, logs, limites de abuso e requisitos de produção | Etapa 0 para papéis; pode começar revisão técnica em paralelo | Requisitos, ameaça e controles testáveis definidos |
| 2 | Modularizar autorização e regras; ampliar testes de comportamento antes de trocar armazenamento | Etapa 0; testes podem iniciar em paralelo | Testes cobrindo acesso negativo, portal e regras atuais; contrato interno estável |
| 3 | Implementar PostgreSQL, schema tenant-aware e migrações aditivas | Etapas 0 e 2 | Migrações revisadas em ambiente isolado; constraints e transações demonstradas |
| 4 | Implementar sessão persistente, limites de abuso, e-mail transacional e eventos de segurança | Etapas 0 e 1; pode ocorrer junto às etapas 2–3 | Expiração/revogação, rate limits, reset e logs seguros sob testes |
| 5 | Importador JSON idempotente, staging e ensaio de migração/rollback | Etapas 2 e 3; cópia original protegida | Relatório de reconciliação aprovado e restauração testada |
| 6 | Preparar deploy, observabilidade, backups/restore, resposta a incidentes, privacidade e hardening | Etapas 1, 3 e 4 | Runbooks e métricas operacionais aprovados; ensaio de falha/restore concluído |
| 7 | Piloto fechado com dados mínimos e consentimentos/processos aprovados | Etapas 0–6 completas | Critérios da seção 11 cumpridos, responsáveis de operação designados |
| 8 | Assinaturas/pagamentos e ampliação comercial | Piloto e decisões de produto | Webhooks idempotentes, cancelamento/retencão definidos, suporte e cobrança operacionais |

Não há necessidade demonstrada de adotar Next.js, NestJS, Expo ou Prisma em bloco. Comparar framework depois de modularizar e estabilizar o contrato permite separar risco arquitetural de risco de migração. Para o escopo de aplicação web única, Node.js atual e PostgreSQL são uma combinação compatível.

## 11. Critérios objetivos para piloto comercial

O piloto só deve ser considerado pronto após evidência verificável de todos os itens seguintes:

1. Modelo aprovado para tenant, profissionais/equipe, paciente, transferência, papéis e campos expostos no portal.
2. Todas as rotas têm matriz de autenticação/autorização e testes negativos de acesso cruzado; nenhum identificador fornecido pelo cliente concede acesso.
3. Banco relacional com migrações versionadas, FKs/índices/constraints tenant-aware e transações para convites, unicidade e agenda.
4. Sessões têm expiração validada no servidor, revogação e política de cookies; login/ativação/reset possuem limites de abuso e auditoria sem segredos.
5. HTTPS, `Secure` cookies em produção, gestão de segredos e ambientes segregados foram verificados na implantação efetiva.
6. Importação idempotente ensaiada com origem preservada; relatório de contagens/órfãos aprovado e rollback testado. Nenhum dado foi descartado sem decisão explícita.
7. Backups criptografados e restauração em ambiente isolado foram concluídos dentro do RPO/RTO aprovados; responsáveis e runbook definidos.
8. Logs não contêm senha, cookie, token, conteúdo clínico ou identificadores desnecessários; retenção e acesso foram revistos.
9. Testes de autenticação, isolamento, portal publicado, concorrência, migração e recuperação passam em CI no commit de release; artefato e versão de runtime são reproduzíveis.
10. Monitoramento e alertas de erro, disponibilidade, autenticação abusiva e falhas de backup têm responsável e procedimento de resposta.
11. Processo de suporte e incidente, exportação/retificação/exclusão/retensão de dados e contato com titulares foram revisados por responsáveis apropriados.
12. A avaliação jurídica/privacidade e contratos aplicáveis foram conduzidos por profissionais competentes. A auditoria de código não declara LGPD atendida.
13. Piloto é restrito a usuários, dados e funções aprovados; não há onboarding aberto até revisão dos resultados e incidentes do período controlado.

## 12. Questões que exigem decisão humana

1. O tenant comercial é uma profissional individual, um consultório ou ambos? Consultórios terão equipe e papéis delegados?
2. Um paciente pode ter vínculo com mais de uma profissional/organização? Como funcionam transferência, encerramento de vínculo e acesso ao histórico publicado?
3. Quais campos e versões o paciente pode acessar, por quanto tempo e com que mecanismo de publicação/revogação?
4. Qual o escopo do piloto, região/provedor de hospedagem, residência de dados, disponibilidade e metas de RPO/RTO?
5. Quais políticas serão aplicadas para retenção, exportação, correção, exclusão, contas inativas e auditoria?
6. Quais métodos de autenticação serão exigidos para profissionais (MFA, verificação de e-mail, recuperação) e para suporte privilegiado?
7. O e-mail de convite/reset será enviado por qual provedor e qual fluxo reduz risco de link encaminhado ou acessado em dispositivo compartilhado?
8. Quais meios de pagamento, regras de inadimplência, cancelamento, reembolso e retenção de dados serão usados? A cobrança será por profissional ou consultório?
9. Quem responde por segurança, backups, alertas, atendimento a incidentes e revisão periódica de dependências?
10. A origem JSON atualmente presente é exclusivamente fictícia? Antes de qualquer migração, uma pessoa autorizada deve confirmar origem, legitimidade e política de tratamento sem compartilhar os valores no relatório.

## 13. Arquivos inspecionados

- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `.env.example`, `.gitignore`, `README.md`, `.prettierrc.json`.
- `apps/api/package.json`, `apps/api/src/server.js`, `apps/api/test/application.test.js`.
- `apps/web/package.json`, `apps/web/public/index.html`, `apps/web/public/app.js`, `apps/web/public/portal.js`, `apps/web/public/styles.css`.
- `docs/architecture/current-state.md`, `docs/architecture/target.md`, `docs/development/migration-plan.md`, `docs/development/meal-plans.md`, `docs/development/patient-portal.md`, `docs/decisions/0001-incremental-monorepo.md`.
- `data/store.json`: apenas estrutura, nomes de campos e contagens foram examinados; nenhum valor pessoal foi reproduzido.
- `.vscode/tasks.json` e inventário de arquivos versionáveis. Logs locais não foram abertos.

## 14. Encerramento e limites

Esta auditoria confirma boas bases de MVP: senha derivada com salt, token de convite/reset aleatório com hash armazenado, separação de cookie do portal, verificações de propriedade nas rotas profissionais e resposta whitelist de planos publicados. Elas reduzem alguns riscos atuais, mas não compensam os bloqueadores de persistência, sessão, abuso e operação.

O relatório é um diagnóstico de código e repositório, não um pentest, revisão de infraestrutura, auditoria de dependências, avaliação jurídica ou certificação de conformidade. As decisões sobre modelo de tenant, operação e obrigações de privacidade precisam de responsáveis humanos qualificados.
