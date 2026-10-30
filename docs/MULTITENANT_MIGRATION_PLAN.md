# Plano progressivo de evolução multi-tenant

Este plano é recomendação técnica, não autorização para implementar decisões pendentes. Nenhuma alteração de produção foi feita nesta auditoria.

Para matriz requisito-evidência-aceite, modelo conceitual, exemplos de autorização, conflitos documentais e plano faseado com módulos/testes, consulte [CONSOLIDATED_ARCHITECTURE_PROPOSAL.md](CONSOLIDATED_ARCHITECTURE_PROPOSAL.md). As decisões aprovadas no baseline prevalecem sobre formulações históricas ou genéricas deste plano; em particular, não se reabre que workspace possa ser individual ou clínica, nem que saída não transfira dados automaticamente.

## Princípios e dependências

- Fechar decisões de domínio e acesso antes de fixar schema ou migrar pacientes.
- Preservar identidade global separada de membership e de dados clínicos por workspace; não inferir compartilhamento por e-mail/nome.
- Implementar autorização no servidor e manter testes negativos como gate para cada etapa.
- Migrar persistência separadamente de mudanças de framework/UI e faturamento.
- Nunca descartar, mesclar ou transferir registro clínico automaticamente em casos ambíguos.

## Fases

| Fase | Escopo e dependências | Riscos | Critério de conclusão |
|---|---|---|---|
| 0. Decisões e threat model | Resolver questões P0/P1 em `MULTITENANT_DECISIONS_REQUIRED.md`; mapear papéis, patient identity, revogação, retenção e tenant legado. | Schema baseado em premissas não aprovadas; ambiguidades viram acesso amplo. | Decisões necessárias ao MVP registradas e aprovadas; modelo de ameaça e limites de dados assinados pelos responsáveis. |
| 1. Baseline reproduzível e testes | Congelar contratos/comportamento atual; criar fixtures sintéticas; testes de login, leituras/escritas e negativos existentes. Definir caminho de execução seguro. | Teste atual não alcança revogação e portal; alterar fixtures pode usar dados reais por engano. | Testes sintéticos independentes de `data/store.json`; baseline funcional e cobertura por endpoint registrada. |
| 2. Sessão e segurança transversal | Expiração server-side, logout/revogação, rate limit, normalização de logs, tratamento uniforme de erros e headers; definir CSRF/ameaça do cookie. | Invalidar sessões ou mudanças de comportamento; limites não afinados. | Testes de expiração/logout/reset; sem tokens/sensíveis em logs; limites e política operacional documentados. |
| 3. Modularização e policy explícita | Separar handlers, casos de uso, validação, repositórios e autorização sem trocar stack simultaneamente; mapear cada rota a policy. | Refatoração regressiva e duplicação de regra. | Contratos HTTP preservados; testes de regressão; nenhuma rota privada sem policy explícita. |
| 4. Domínio tenant e autorização | Com decisões aprovadas, modelar identidade, workspace, memberships múltiplas, papéis/capacidades, exceções, equipe e atribuições; implementar contexto ativo no backend. | Vazamento cross-tenant por query/ID; owner confundido com acesso clínico. | Matriz rota × papel × escopo coberta por positivos e negativos; dois workspaces e múltiplos memberships validados; revogação efetiva. |
| 5. Banco e migrações | Selecionar persistência após critérios; schema com FKs/uniques/transactions e estratégia tenant-aware. Avaliar enforcement no banco (por exemplo, RLS) como camada complementar. | Decisão prematura de provedor/ORM; constraints ou RLS mal configuradas. | Migration reproduzível em ambiente vazio; rollback de schema ensaiado; testes de integridade e isolamento executados com identidade de aplicação realista. |
| 6. Importação ensaiada | Importador separado e idempotente; snapshot/backup autorizado; dry-run com fixtures; mapear cada profissional atual a workspace conforme regra aprovada. | Duplicatas, órfãos, associação indevida, perda de versão publicada. | Reconciliação de contagens/IDs/relações; zero exceção não aprovada; repetição idempotente; backup restaurado com sucesso. |
| 7. Cutover e estabilização | Janela e autoridade definidas; congelar escrita, importar snapshot final, validar, trocar fonte de verdade e monitorar. Evitar dual-write sem protocolo testado. | Divergência de dados ou indisponibilidade; rollback após novas escritas pode perder alterações. | Smoke tests por papéis, integridade, logs e alertas aprovados; decisão de aceite e plano de recuperação executáveis. |
| 8. Planos comerciais (fora do MVP clínico) | Depois de autorização/tenant estáveis, definir entitlements, limites, assinatura e cobrança. | Entitlement comercial ser confundido com permissão clínica. | Regras de plano configuráveis, testadas e separadas da autorização clínica, após decisão comercial. |

## Testes necessários

- Identidade única em múltiplos workspaces, memberships e cargos diferentes; seleção/troca de workspace e tentativa de forjar contexto.
- Leituras, escritas e enumeração de IDs por papel, equipe e escopo de paciente; cadastro administrativo sem acesso ao prontuário.
- Clínica e consultório pessoal simultâneos sem compartilhamento automático; mesma pessoa paciente em dois contextos com registros separados.
- Múltiplos proprietários; propriedade sem acesso clínico implícito; gestor versus responsável clínico; exceções de permissão e cargos personalizados.
- Revogação de membership: token existente, nova requisição, sessão em cache, request em andamento e outro workspace ainda ativo.
- Corrida em convites, publicação, concorrência de agenda e mudança de atribuição/revogação; integridade transacional e consistência após falha.
- Migração idempotente, órfãos/duplicatas, UUIDs inválidos, versões de plano e snapshot publicado; restore/rollback.
- Para cada endpoint, testes de autorização tanto em leitura como em escrita, incluindo status de erro e ausência de dados cruzados.

## Estratégia de migração

1. Usar somente fixture sintética durante desenvolvimento e ensaio comum.
2. Antes de acessar arquivo de origem, pessoa responsável deve confirmar finalidade, autorização, ambiente e operador. Esta auditoria não abriu nem verificou o conteúdo de `data/store.json`.
3. Produzir importador separado da inicialização da API, `dry-run` padrão, idempotência, checkpoints, validação de FKs e relatório sem nome, e-mail, valores clínicos, hashes ou tokens.
4. Mapear cada atual `userId` para workspace/membership somente segundo regra aprovada. Não unir paciente por e-mail ou identidade presumida; ambiguidades exigem reconciliação humana.
5. Fazer backup protegido, comprovar restauração e congelar escrita para snapshot final; importar para schema novo e reconciliar IDs, relações, contagens, estados e versões.
6. Revogar tokens ativos ou migrar somente hashes conforme decisão; sessões em memória não são portáveis e podem exigir novo login conforme política aprovada.
7. Ativar banco como fonte única após aceite; não manter dual-write sem mecanismo de consistência testado.

## Critérios de rollback

Antes do cutover, definir gatilhos objetivos (vazamento de tenant, divergência de integridade, falha de autorização, indisponibilidade, RPO/RTO), responsável e janela. Antes de qualquer escrita nova no banco, retorno ao snapshot anterior pode ser possível; depois de escritas novas, rollback cego para JSON antigo perde alterações. Nessa situação preferir correção para frente ou reconciliação de delta testada. Preservar backup/snapshot até aceite e retenção autorizados. Critérios quantitativos e autoridade são decisões pendentes, não fixadas aqui.

## Fora do MVP multi-tenant

Faturamento, escolha definitiva de framework, apps móveis, automação de notificações, relatórios, fluxos clínicos configuráveis avançados e cobrança por uso podem permanecer fora, desde que a fundação não acople autorização clínica ao plano comercial nem imponha fluxo único de atendimento.
