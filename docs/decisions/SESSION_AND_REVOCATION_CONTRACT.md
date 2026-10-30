# Proposta de decisão — contrato de sessão e revogação

**Data:** 2026-10-29  
**Estado:** proposta aguardando aprovação humana; nenhuma implementação autorizada por este documento.  
**Escopo:** contrato de autenticação de sessão e semântica de revogação para F1 e compatibilidade futura multi-tenant. Não escolhe banco, ORM, provedor ou dependência.

## Resumo para decisão

Recomenda-se uma sessão revogável validada no servidor, com identificadores opacos e armazenamento compartilhável entre instâncias, expiração absoluta aprovada e validação de credenciais/revogação em cada request. A autorização de workspace continua separada: uma sessão prova autenticação, não membership, permissão clínica ou acesso a paciente.

Para requests concorrentes, recomenda-se definir a autorização no ponto de commit/efeito durável: uma operação ainda não confirmada no momento em que a revogação se torna efetiva deve falhar ou cancelar; uma operação já confirmada não é desfeita retroativamente. O instante exato em que uma revogação se torna efetiva, inclusive o SLA observável, precisa de aprovação. As alternativas estão detalhadas na seção 2.

Esta recomendação favorece revogação clara e coerência multi-instância, mas não aprova uma tecnologia: armazenamento persistente compartilhado, store transacional já escolhido ou outra arquitetura só poderão ser avaliados após requisitos de operação e SLA.

## 1. Contrato de sessão

### 1.1 Estados e comportamento

Uma sessão é uma credencial de curta duração relativa à identidade autenticada, com estado server-side ou mecanismo equivalente para validar expiração e revogação. Os estados observáveis são: ausente; válida; expirada; revogada; inválida/desconhecida. Só `válida` permite prosseguir para autorização da ação. Falha/indisponibilidade da fonte necessária à validação nega acesso, sem modo permissivo.

| Evento | Comportamento proposto |
|---|---|
| Login válido | Após validar credenciais, criar sessão nova e não reutilizar ID anterior. O identificador deve ser imprevisível; a resposta define cookie `HttpOnly`, `Secure` em transporte de produção e política `SameSite`/CSRF aprovada. Credenciais nunca entram em log. Rotação após autenticação/elevação é recomendada contra fixation. |
| Login inválido | Não criar sessão. Resposta não deve distinguir conta inexistente de senha incorreta além do necessário; aplicar limite de tentativas conforme política aprovada. |
| Expiração absoluta | A sessão deixa de valer após prazo contado da criação/autenticação, verificado no servidor em cada request, mesmo que cookie seja reapresentado manualmente. O valor do prazo requer aprovação; cookie `Max-Age` espelha, mas não substitui a validação backend. |
| Expiração por inatividade | Recomendação: adotar limite ocioso apenas se operação/UX definir valor e regra de atualização. Deve ser verificado no servidor e não estender a expiração absoluta. É possível adiar a decisão e iniciar F1 só com expiração absoluta, desde que essa limitação seja aceita. |
| Logout | Revogar a sessão no servidor e remover/expirar cookie. Operação idempotente: repetir logout não restaura nem reativa a sessão. Reuso do mesmo cookie resulta em não autenticado. |
| Recuperação/troca de credencial | Após conclusão autorizada, invalidar sessões conforme escopo aprovado. Recomendação conservadora: recuperação de senha revoga todas as sessões do principal; alteração iniciada por sessão autenticada pode revogar outras sessões e emitir uma nova sessão após reautenticação. O tratamento de sessão corrente deve ser explícito. |
| Evento de segurança | Ações como suspeita de comprometimento, bloqueio da conta ou decisão de suporte autorizada devem poder revogar uma sessão ou todas as sessões do principal. O catálogo de eventos, atores autorizados e fluxo de recuperação requer política. |
| Reinício | Não confiar em sessão apenas porque o cookie ainda não expirou. Sessão em memória pode perder validade após restart (fail-closed), mas não satisfaz continuidade esperada sem decisão explícita; o mecanismo de produção precisa manter estado/revogação coerente após reinício. |
| Múltiplas instâncias | Qualquer instância deve validar o mesmo estado de sessão/revogação no SLA escolhido. Estado só em `Map` local não atende a esse contrato. Falha de conexão com estado de sessão resulta em negação, nunca validação por cache indefinido. |

### 1.2 Separação de principals

Sessões profissionais e de pacientes são classes de principal distintas, mesmo que ambas usem cookies. Cookie, audience/namespace ou outro discriminador verificável evita que credencial de paciente autentique rota profissional ou vice-versa. A autorização do paciente fica limitada ao vínculo explícito e ao conteúdo de portal aprovado.

Sessão profissional identifica a identidade profissional global. Ela pode continuar válida após remoção de membership em um workspace; isso não conserva acesso àquele workspace. Para cada operação, a policy valida membership, workspace, ação, escopo, equipe/atribuição e estado do recurso. A sessão não concede acesso clínico por si só.

### 1.3 Contexto multi-tenant

- Workspace ativo é contexto selecionado, não claim irrevogável. Backend revalida membership vigente e política ao executar cada operação.
- Remover membership invalida o acesso apenas ao workspace removido. Outros memberships da identidade continuam válidos; não revogar globalmente a sessão por conveniência.
- Mudanças de permissão/membership não podem ficar sujeitas exclusivamente a cache positivo desatualizado. Cache, se utilizado, precisa de versão/invalidação/limite de staleness que cumpra SLA aprovado; alternativa mais simples é validação autoritativa por operação.
- A autorização futura substitui ownership legado como fonte de decisão. Nenhum fallback para `userId`/`owned()` deve conceder acesso quando workspace/membership/policy nega.
- A sessão nunca substitui permissão granular, atribuição clínica ou isolamento entre prontuários. Administração não implica autorização clínica.

## 2. Revogação durante operações em andamento

É necessário distinguir **início** (request recebido), **autorização** (policy validada), **ponto de confirmação** (efeito durável confirmado) e **efetivação da revogação** (evento que a política considera corte). O request não deve ser tratado como autorizado para sempre por ter passado uma verificação inicial.

### Alternativas

| Alternativa | Comportamento observável e ponto de autorização/confirmacão | Tratamento de operação não confirmada | Riscos de concorrência | Testes sintéticos necessários |
|---|---|---|---|---|
| A. Autorização somente no início do request | Request que validou sessão, permissão e membership pode concluir mesmo se a revogação ocorrer antes do commit. Autorização é o check inicial; confirmação é o commit/efeito posterior. | Prossegue normalmente; não há rechecagem. | Janela entre check e commit permite escrita após remoção; janela cresce com processamento/rede; revogação pode parecer inconsistente. Simples e de baixa latência. | Pausar request depois do check; revogar sessão/membership; liberar request; verificar que completa. Repetir com leitura e escrita, uma e múltiplas instâncias. |
| B. Check inicial mais revalidação no ponto de commit (recomendada) | Check inicial evita trabalho não autorizado; antes de confirmar efeito, revalidar validade da sessão e versão/estado autoritativo da autorização. A decisão final é linearizada no commit/lock/condição atômica. Revogação passa a valer conforme ordenação entre transações. | Se revogação vencer a ordenação antes do commit, abortar/descartar mutação e retornar negação apropriada; se operação confirmar antes, ela permanece válida. Leituras podem exigir check antes de liberar resposta para reduzir vazamento. | Exige storage/transação ou mecanismo CAS/versão consistente; deadlocks/retries e reads longos precisam de regra. Check fora da mesma fronteira atômica mantém race residual. | Controlar barreiras antes do commit; fazer revogação concorrer; verificar exatamente um resultado ordenado (commit antes ou abort depois). Cobrir duas instâncias, retries, resposta de leitura e falha no store. |
| C. Cancelamento cooperativo em todo request longo | Revalida em pontos definidos do fluxo e cancela tarefas ainda não confirmadas quando notificada a revogação. Confirmação continua no commit. | Cancelar trabalho e não persistir; tarefas externas devem suportar cancelamento/compensação. | Notificações podem atrasar/perder; pode haver efeitos externos parciais impossíveis de reverter; maior complexidade. | Injetar revogação em cada ponto de cancelamento; perder notificação; simular falha externa; provar sem commit parcial. |
| D. Janela temporal/SLA de propagação | Request pode continuar até um prazo máximo documentado após pedido de revogação; após prazo, nova validação nega. Autorização depende de cache/versão; confirmação pode ocorrer na janela se política assim definir. | Antes do deadline, concluir ou revalidar conforme regra; depois, abortar. | SLA oferece previsibilidade operacional, mas tolera janela de acesso; relógios/cache/invalidação precisam de limites. Não equivale a revogação imediata. | Medir pior propagação entre instâncias; cache quente; evento perdido; validar comportamento exatamente antes/depois do limite e com relógio controlado. |

### Recomendação e questão de SLA

Recomenda-se a alternativa B como contrato para operações duráveis: check inicial e revalidação autoritativa atomicamente ordenada com o commit. Uma operação confirmada antes do corte continua registrada; uma não confirmada quando a revogação vence não persiste. Para leituras, validar antes de liberar dados ao cliente e, para respostas/streams longos, definir um ponto de liberação/cancelamento equivalente.

Esta recomendação evita o risco central de A sem exigir cancelamento distribuído amplo de C. Ela requer que a escolha futura de persistência ou mecanismo equivalente prove a ordenação/atomicidade; sem isso não se pode afirmar revogação forte. Alternativa D pode definir propagação máxima para caches, mas essa janela deve ser aprovada explicitamente e não deve ser confundida com instante zero.

Não há SLA numérico proposto. Produto/segurança/operação precisam escolher: (1) quando pedido de revogação se torna efetivo (commit do evento, confirmação distribuída ou limite de propagação); (2) se a garantia se aplica a requests ainda não confirmados; (3) qual latência máxima aceitável para logout, remoção de membership e alteração de permissão. Esses eventos podem precisar de SLAs diferentes. Sem aprovação, F1 pode testar a ordenação abstrata com relógio/barreiras sintéticas, mas não declarar prazo operacional cumprido.

## 3. Alternativas técnicas para armazenamento e validação

Nenhuma opção abaixo está aprovada. A arquitetura atual é Node.js/CommonJS, servidor `node:http`; sessões profissionais/paciente estão em `Map` de processo, e a idade do cookie não é validada por `userFor()`/equivalente. A aplicação atual também persiste dados em JSON; esse fato não torna o arquivo uma escolha apropriada para sessão distribuída.

| Alternativa | Node/CommonJS e consistência entre instâncias | Logout/revogação e cache | Latência/operação/falhas | Testabilidade sintética |
|---|---|---|---|---|
| 1. `Map` em processo (estado atual) | Fácil de usar sem dependências e compatível com CommonJS, mas cada instância vê sessões diferentes; restart perde todas. | Logout local imediato apenas na instância; sem invalidação cruzada ou expiração server-side atual. Cache é o próprio estado local. | Latência baixa e operação simples, porém não atende múltiplas instâncias nem continuidade após falha/restart; fail-closed pode deslogar todos. | Fácil de testar unitariamente; inadequada para provar garantias distribuídas. Pode servir apenas a protótipo isolado. |
| 2. Sessão opaca com estado persistente/compartilhado | Implementação compatível via módulo/adaptador; toda instância consulta mesma fonte. Forma e tecnologia da fonte precisam de seleção independente. | Revogação explícita por sessão/principal; expiração validada no backend. Cache requer invalidação/versionamento ou TTL dentro do SLA. | Cada request pode incorrer em lookup; depende de disponibilidade, durabilidade, backup e operação do store. Falha de store deve negar; recuperação precisa preservar revogações expiradas. | Boa: fixtures, relógio controlado e duas instâncias contra store temporário podem validar estados/corridas. |
| 3. Token assinado stateless com expiração | Compatível com Node/CommonJS por criptografia disponível na plataforma, mas detalhes de chave/claims/rotação precisam desenho. Validação local escala entre instâncias com chaves sincronizadas. | Logout/revogação antecipada não é natural; exige denylist, versão de sessão/principal consultada, ou aceitar validade até expiração. Cache local de claims pode ficar stale. | Baixa latência sem lookup, mas gestão/rotação de chaves e propagação de revogação é complexa; falha de chave/clock impacta todas instâncias. | Testável com chaves sintéticas e relógio; revogação forte só é demonstrável se dependência adicional também for testada. |
| 4. Híbrido: token opaco/assinado + versão/registro autoritativo | Compatível em princípio; sessão pode incluir ID/versão e backend consulta estado/versionamento central. | Revogação por incremento/registro; cache de versão precisa invalidar ou respeitar limite. Pode evitar busca detalhada de sessão, mantendo check de versão. | Equilíbrio entre custo e controle, com mais estados, chaves/versões e caminhos de recuperação para operar. | Testa versões concorrentes, invalidação e duas instâncias; requer harness da fonte autoritativa. |

### Critérios de seleção e consequências

Seleção futura deve comparar: consistência necessária para a alternativa de revogação aprovada; compatibilidade sem migração forçada do servidor CommonJS; operação já disponível (ainda desconhecida), custo, competências e disponibilidade; comportamento com restart/falha de rede; backup/restore; latência e volume; estratégia de chave/segredo; observabilidade sem registrar tokens; e teste reproduzível com instâncias sintéticas.

Uma sessão persistida compartilhada é recomendação de arquitetura para múltiplas instâncias, não escolha de banco/provedor. Opções podem incluir persistência transacional, store dedicado de sessões ou fonte compartilhada já operada; cada uma precisa evidenciar durabilidade, concorrência, expiração e restore. Não se aprova PostgreSQL, Redis, ORM, pacote, serviço externo ou backend de identidade nesta proposta. Evite acoplar seleção de sessão à decisão do banco clínico sem comparar consequências; podem compartilhar tecnologia somente se ambas as cargas e SLAs forem atendidos.

## 4. Matriz de testes sintéticos proposta

Os testes abaixo são especificações futuras, não resultados. Fixtures devem ser fabricadas e não derivadas de `data/store.json`. Para concorrência, harness deve expor barreiras determinísticas entre autorização, revogação e confirmação.

| Cenário | Condição inicial | Ação | Resultado esperado verificável |
|---|---|---|---|
| Sessão ausente | Rota privada; nenhum cookie | Fazer request profissional e de paciente | 401/resultado de não autenticado conforme contrato; nenhum dado privado; sem sessão criada. |
| Sessão inválida | Cookie sintético aleatório/desconhecido | Fazer request privado | Negado como não autenticado; resposta não indica existência de sessão/usuário. |
| Sessão expirada | Registro sintético com relógio após expiração, cookie ainda enviado | Fazer request em qualquer instância | Negado no servidor; cookie expirado/limpo quando apropriado; sem acesso por replay. |
| Sessão revogada | Sessão válida inicialmente e depois marcada revogada | Reusar cookie | Negado de forma consistente em todas instâncias dentro da semântica/SLA aprovada. |
| Login correto | Conta/credencial exclusivamente sintética e sem sessão atual | Autenticar | Uma nova sessão imprevisível; cookie com atributos aprovados; logs sem credencial/token. |
| Login incorreto/repetido | Fixture com credencial sintética, contador e limites configurados | Enviar incorreta e repetir concorrente | Não criar sessão; resposta sem enumeração desnecessária; limite aplicado no escopo escolhido. |
| Logout e replay | Sessão válida em duas instâncias | Logout em A; reusar cookie em B e repetir logout | Cookie revogado também em B; replay negado; logout repetido idempotente. |
| Recuperação de credencial | Conta sintética com duas sessões; token reset de teste | Concluir recuperação | Sessões revogadas segundo política aprovada; replay antigo falha; emissão da nova sessão só conforme fluxo aprovado; tokens/segredos ausentes de logs. |
| Alteração autenticada de credencial | Duas sessões; usuário reautenticado na corrente | Alterar credencial | Outras sessões seguem regra aprovada; sessão corrente mantém ou renova apenas conforme política; credencial antiga falha no login. |
| Reinício | Sessão válida/revogada persistida conforme alternativa sob avaliação | Reiniciar processo e reapresentar ambos cookies | Sessão válida segue comportamento documentado; revogada continua negada; nenhum estado revogado ressuscita. Para `Map`, teste deve registrar que não atende continuidade multi-instância, não declarar aceite. |
| Múltiplas instâncias | A e B consultam mesma fonte sintética; sessão criada em A | Autenticar em A, chamar API em B; revogar em A e repetir em B | B reconhece estado válido e depois revogação dentro do contrato; falha da fonte nega acesso. |
| Revogação antes da autorização | Request bloqueado antes de policy; revogação confirmada | Liberar request | Request negado e sem efeito. |
| Revogação após check, antes do commit | Request autorizado e pausado; operação ainda não confirmada | Revogar; então liberar confirmação | Na recomendação B, commit falha/aborta se revogação linearizou antes; nenhuma mutação parcial. |
| Commit antes da revogação | Request autorizado e commit confirmado antes do corte | Revogar após confirmação | Efeito permanece, sem rollback implícito; auditoria ordena eventos conforme precisão disponível. |
| Requests concorrentes | Duas instâncias disputam revogação e mutação | Alternar ordenação e retries | Resultado tem ordenação única conforme ponto de linearização; retry não duplica efeitos; sem confirmação dupla/parcial. |
| Revogação de membership (futuro) | Identidade profissional tem dois workspaces; sessões válidas; membership A ativo, B ativo | Remover A; tentar A e depois B | A negado conforme SLA; B segue acessível; sessão global não é revogada por remoção local; nenhum ownership legado concede A. |
| Mudança de permissão (futuro) | Permissão revogada e cache positivo previamente aquecido | Tentar ação após corte em várias instâncias | Denegação dentro do SLA; decisão não depende exclusivamente de cache stale. |
| Isolamento de principal | Cookie de paciente válido e cookie profissional válido | Usar cada um nas rotas privadas do outro tipo | Ambos negados em classe incompatível; nenhum fallback entre sessão/cookie. |
| Logout de um principal | Uma sessão profissional e uma de paciente distintas | Logout de uma, tentar ambas | Só sessão alvo revogada, salvo política de segurança explícita mais ampla; classes continuam separadas. |
| Logs sensíveis | Registrar fixtures com strings-canário como senha, cookie, token e dado clínico fictício | Executar login, falha, logout, reset, expiração e erros | Captura de logs não contém nenhum canário sensível, token, header Cookie, query secreta ou payload clínico; auditoria contém só metadados autorizados. |
| Falha da fonte de sessão | Store sintético indisponível/timeout | Fazer request e logout | Requests protegidos negados; sistema não aceita sessão via cache indefinido; resposta não expõe detalhe interno. |

## 5. Decisões pendentes e classificação

### Requisitos aprovados que não serão reabertos

- Profissional tem identidade única e pode participar de vários workspaces.
- Remoção de membership revoga somente aquele workspace; identidade e outros workspaces permanecem.
- Workspace pode ser individual ou clínica e pode ter vários proprietários.
- Sessão/contexto não substitui autorização por workspace, papel, ação, equipe/paciente ou atribuição; propriedade não dá acesso clínico irrestrito.
- Cadastro de paciente não autoriza prontuário; registros de contextos distintos não são compartilhados automaticamente.
- Logout/revogação, expiração server-side, consistência multi-instância, logs minimizados e tratamento de operações em andamento precisam ser cobertos na fundação segura.

### Aprovações humanas necessárias

| Decisão | Alternativas e consequência | Dependência |
|---|---|---|
| Semântica/SLA da revogação em andamento | A (somente check inicial), B (revalidar no commit, recomendada), C (cancelamento cooperativo), D (janela de propagação explicitamente limitada). Definir corte efetivo e se há prazos distintos para logout, membership e permissão. | Conclusão do contrato F1 e aceite de concorrência; enforcement multi-tenant e cache. |
| Prazo de expiração absoluta | Escolher duração por risco, UX e suporte; cookie deve refletir a decisão e backend aplicá-la. | Implementação e testes de expiração F1. |
| Expiração por inatividade | Habilitar com prazo/renovação definidos ou adiar e usar só limite absoluto. | UX e política F1; pode ser postergada se absoluta for aprovada. |
| Escopo de revogação em recuperação/alteração | Todas as sessões, outras sessões mantendo a corrente, ou todas incluindo a corrente com login novo. Recomenda-se revogar todas após recuperação de conta. | Fluxo de reset e aceite F1. |
| Eventos de segurança e autoridade para revogar | Definir conta bloqueada, suspeita de comprometimento, suporte/admin e reautenticação. | Fluxos operacionais antes de piloto real; interface/admin posterior. |
| Política de MFA e canal de recuperação para piloto | MFA universal, privilegiados ou escalonado; canal de recuperação verificado e responsáveis. | Gate de piloto; recuperação segura e critérios públicos. |
| Alternativa técnica de armazenamento/validação | `Map` (não satisfaz multi-instância); sessão opaca compartilhada; token stateless com revogação auxiliar; híbrido. Exige infraestrutura, custo, restauração e teste. | ADR técnico antes de aceitar multi-instância/continuidade de F1 e antes de dados reais. |

### Recomendações técnicas não aprovadas

- Preferir sessão opaca com validação server-side e revogação explícita; evitar token puramente stateless sem mecanismo de revogação que cumpra SLA.
- Preferir revalidação autoritativa no commit para mutações duráveis e antes de liberar leituras sensíveis.
- Não usar cache de autorização sem invalidação/versão ou TTL que cumpra SLA aprovado.
- Fail closed na indisponibilidade da fonte autoritativa; separar namespace/tipo de sessão profissional e paciente.
- Rate limiting precisa funcionar entre instâncias, mas algoritmo/serviço não está escolhido.
- Não alterar framework, persistência clínica ou contratos de API como parte desta decisão.

### Questões que podem ser adiadas sem bloquear F1

- Banco/ORM definitivo e se store de sessão compartilha infraestrutura com persistência clínica podem esperar protótipo sintético e requisitos operacionais; contudo, a F1 não pode ser declarada multi-instância pronta sem mecanismo compartilhado comprovado.
- TTL de inatividade pode esperar se a expiração absoluta for aprovada e o risco aceito para F1; precisa decisão antes de piloto se requerido pelo threat model.
- Catálogo completo de papéis, identidade global de paciente, equipes e portal podem esperar F1; autorização futura não pode ser introduzida parcialmente nem usar sessão como substituta.
- MFA universal, billing e políticas comerciais podem esperar piloto ou fases comerciais, exceto se responsáveis definirem MFA como gate de piloto.
- Eventos completos de auditoria/retention podem esperar decisão de produto, mas os logs de autenticação e segurança da F1 já devem ser sanitizados.

## 6. Critérios de aceite

### Contrato pronto para aprovação

1. Produto/segurança escolhem explicitamente expiração absoluta, eventual inatividade, escopo de revogação em reset, semântica para requests em andamento e SLA/instante de efetivação.
2. Cada evento de revogação (logout, reset, comprometimento, membership, permissão) tem ator autorizado, alcance e comportamento de sessão/contexto definidos; membership e permissão permanecem tenant-scoped.
3. Uma alternativa técnica é selecionada somente após comparar consistência, restart, múltiplas instâncias, latência, operação, falha, recuperação, custo e competências; decisão fica registrada em ADR com alternativas rejeitadas e razões.
4. Contrato descreve fail-closed, classes de principal, logging seguro, CSRF/cookies e ponto de linearização sem ambiguidades observáveis.
5. Matriz da seção 4 é convertida em casos sintéticos com fixtures, barreiras concorrentes e resultados esperados; nenhuma execução é presumida nesta proposta.
6. Revisores confirmam compatibilidade com identidade multi-workspace e afirmam que sessão não concede acesso clínico nem preserva membership removido.

### Pronto para iniciar implementação futura da F1

1. Contrato acima aprovado e decisões que bloqueiam F1 fechadas: prazo absoluto; regra de reset/logout; revogação concorrente e seu ponto de corte; resposta a indisponibilidade da fonte; alvo de uma ou múltiplas instâncias para a fase.
2. Plano de testes sintéticos aprovado, sem dependência ou leitura de dados pessoais, e critérios de logs, cookies e CSRF/Origin especificados para o ambiente alvo.
3. Armazenamento/validação escolhido por ADR ou escopo da F1 explicitamente limitado a uma instância, com aceite de que multi-instância ainda não está satisfeita. Nenhuma inferência silenciosa de prontidão distribuída.
4. Plano de rollback da mudança de sessão e compatibilidade temporária com contas existentes documentados; sessão nunca usa ownership legado como fallback.
5. Revisão de segurança confirma que a F1 não introduz autorização multi-tenant parcial nem altera permissões clínicas sem matriz aprovada.

Estes critérios definem o que testar futuramente. Nenhum deles foi executado ou declarado aprovado neste documento.

## Referências

- [Especificação de implementação](../IMPLEMENTATION_SPECIFICATION.md)
- [Proposta consolidada de arquitetura](../CONSOLIDATED_ARCHITECTURE_PROPOSAL.md)
- Evidência de estado atual referida nesses documentos: `apps/api/src/server.js` e `docs/ROUTE_INVENTORY.md`.

Limite desta proposta: inspeção documental. Não foram acessados dados de `data/store.json`, dados clínicos, logs pessoais ou segredos; não houve teste nem validação de infraestrutura. A criação deste documento não aprova a recomendação, tecnologia ou uso de dados reais.
