# Plano de migração do store JSON para PostgreSQL

**Status:** plano de execução futura; nenhuma migração ou leitura de valores pessoais é realizada por este documento.  
**Origem observada:** `data/store.json`, ignorado pelo Git e carregado integralmente pelo processo.  
**Destino recomendado:** PostgreSQL com migrações versionadas e modelo tenant-aware.

## 1. Condições para iniciar

Não iniciar importação até: (a) proprietária/pessoa autorizada confirmar legitimidade, origem e finalidade dos dados no arquivo; (b) decisão de tenant, equipe, vínculo/transferência, portal e retenção aprovada; (c) schema revisado; (d) ambiente de homologação separado; (e) responsáveis e janela de cutover definidos. A auditoria observou somente estrutura e quantidades, sem verificar consistência ou completude. Dados locais não devem ser presumidos fictícios nem completos.

## 2. Inventário e mapeamento

Inventariar em ambiente com acesso restrito, sem imprimir valores pessoais em terminal/logs:

| Coleção JSON | Destino primário | Referências e tratamento |
| --- | --- | --- |
| `users` | `users`, `professional_profiles`, `organizations`, `memberships` | Preservar UUID; mapear profissional→tenant/membership somente por regra aprovada |
| `patients` | `patients`, possivelmente `patient_relationships` | Preservar UUID; não unir por email; mapear owner atual |
| `assessments` | `assessments` | `userId`→membership, `patientId`→patient; validar datas/unidades/cálculos |
| `appointments` | `appointments` | mapear responsável/paciente; validar start/end/status e conflito |
| `goals` | `goals`, `goal_progress` | expandir `progress[]`, manter ordem/instante e IDs mapeados |
| `mealPlans` | `meal_plans`, `meal_plan_versions`, `meals`, `meal_items` | expandir arrays; preservar número/status/IDs e `publishedVersionId` |
| `patientInvitations` | `invitations` | preservar hash se válido; decidir tokens ativos; nunca exportar token puro |
| `patientPasswordResets` | `password_resets` | decisão de invalidação/reemissão; preservar hash somente se autorizado |
| `patientAccounts` | `patient_accounts` | credenciais/hash requerem revisão de compatibilidade; manter sessão separada |
| `audit` | `audit_events` | mapear campos suportados e reter apenas metadados mínimos permitidos |

Produzir manifesto de exportação por coleção com contagem, IDs de origem, referências, tipos e indicadores de erro. Manifesto/relatório não deve conter nome, e-mail, notas, senha, hash de token ou payload clínico. IDs são preservados quando não duplicados; UUID inválido ou duplicado gera exceção reportada com identificador técnico seguro, não descarte automático.

## 3. Schema e migrações versionadas

Schema lógico e integridade: `docs/DATABASE_DESIGN.md`. Criar migrations numeradas e revisáveis, transacionais quando suportado e aditivas sempre que possível. Separar migration de schema, importador e limpeza. Seed apenas sintético. Cada versão registra checksum/versão aplicada e falha de forma segura se detecta versão incompatível. Nunca executar `DROP`/expurgo como efeito colateral do importador.

Selecionar driver/ORM em ADR após avaliar SQL visível, CommonJS, transações, migrações, pooling, backup/restore, experiência da equipe e manutenção. Não migrar framework ou frontend junto com banco.

## 4. Exportação, proteção e restauração

1. Nomear operador autorizado e documentar base/propósito, origem, data, versão de código e janela.
2. Parar escrita ou gerar cópia consistente; como JSON é gravado via arquivo temporário/rename, confirmar que a cópia corresponde a snapshot fechado e não está sendo atualizada.
3. Criar backup cifrado, checksum e cópia em armazenamento restrito; registrar acesso sem incluir conteúdo.
4. Testar legibilidade e restauração do backup em ambiente isolado, usando acesso mínimo.
5. Não copiar arquivo de origem para desenvolvimento/homologação comum. Homologação usa fixture sintética; ensaio com dados reais, se autorizado, requer ambiente e controles equivalentes a produção e avaliação apropriada.
6. Manter backup original imutável até aceite, rollback e retenção aprovados.

## 5. Importador idempotente

Implementar futuramente como ferramenta separada da inicialização normal da API, em modo `dry-run` por padrão. Requisitos:

- chave de idempotência estável por entidade, origem/ID/versão; `UPSERT` só para o mesmo objeto e versão de importação, nunca sobrescrever alteração concorrente de usuário;
- transações por tenant ou lote pequeno com checkpoint e retomada;
- preservar UUIDs quando válidos e únicos; registrar mapeamento de IDs inválidos somente após regra aprovada;
- importar pais antes de filhos e validar todas as FKs; relatório explícito para órfãos/duplicatas/campos inválidos;
- expandir metas/progresso e planos/versões/refeições/itens mantendo ordem, datas, status e snapshot publicado;
- testar que `publishedVersionId` aponta à versão preservada; comparar conteúdo sem expor conteúdo clínico em logs;
- normalizar email sem mesclar automaticamente contas duplicadas; casos de colisão vão para reconciliação humana;
- token de convite/reset não deve ser colocado em log/relatório. Decidir invalidar ativos e gerar convite/reset novo ou migrar apenas hash após análise;
- sessão de `Map` não persiste e não é migrável; todos os usuários devem autenticar de novo;
- qualquer dado incompatível deve ser isolado em relatório de exceção e interromper cutover quando afetar integridade/autorização. Nenhuma linha descartada silenciosamente.

## 6. Ensaio, validação e aceite

Realizar múltiplos dry-runs com fixtures sintéticas incluindo: vínculo válido; registro órfão; UUID duplicado/inválido; emails normalizados conflitantes; versões múltiplas com snapshot publicado antigo; metas com progresso; tokens expirados/ativos; consulta sobreposta; valor numérico/data inválida. Confirmar segunda execução não duplica nem altera resultados.

Comparar origem e destino por tenant/coleção: contagens, conjunto de IDs, linhas órfãs, duplicatas, campos obrigatórios, estados, relações, número/ordem de versões, versão publicada apontada, refeições/itens e timestamps. Comparação de hash/JSON canônico pode detectar divergência sem reproduzir dado, mas precisa tratar normalização/ordem. Verificar constraints e consultas críticas. Fazer amostragem autorizada em tela por papel, com dados protegidos e sem screenshot/export aberto.

Critérios de aceite antes do corte:

- diferenças explicadas e aprovadas; nenhuma perda não autorizada;
- 100% das relações obrigatórias resolvidas e FKs válidas;
- contagem e mapeamento reconciliados por tenant/entidade;
- versões publicadas e ponteiros preservados;
- importação repetida comprovadamente idempotente;
- testes negativos de isolamento e fluxo de paciente aprovados em staging;
- backup e restore completos, cronometados e dentro do RPO/RTO decididos;
- plano de rollback praticado e responsáveis presentes.

## 7. Cutover controlado

Estratégia preferida inicial: janela de manutenção curta com escrita congelada, export final consistente, import final, reconciliação, smoke tests e troca de configuração. Evitar dual-write JSON+PostgreSQL: sem protocolo já provado, há risco de divergência e escrita parcial. Se não for possível congelar escrita, desenhar e testar CDC/dual-write com reconciliação explícita antes de adotar.

Publicar versão com feature/config flag de backend apenas se ambos os caminhos forem bem testados; o caminho em produção precisa ter fonte única de verdade. A API não deve aceitar escrita no JSON após iniciar cutover. Observar erros, latência, autorização, conexão e dados inconsistentes durante janela de estabilização.

## 8. Rollback

Pré-definir gatilhos objetivos (por exemplo, divergência de contagem/integridade, falha de autenticação generalizada, vazamento de tenant, corrupção, indisponibilidade acima do limite acordado) e autoridade para declarar rollback. Antes de tráfego de escrita no PostgreSQL, é simples voltar para JSON preservado. Depois de novas escritas, retornar a JSON antigo perde dados; não fazer rollback cego. Opções: corrigir para frente, exportar delta reconciliado para origem em ferramenta auditada, ou manter banco e reverter somente release. Escolher/praticar cenário conforme política de RPO/RTO e janela de escrita. Manter PostgreSQL como autoridade se reversão do código for compatível.

Registrar estado e hora do corte, checksum do snapshot, versão de migrations/importer/app, contagens, exceções, aprovações, decisão final e monitoramento. Não apagar arquivo/backups JSON automaticamente.

## 9. Critérios para abandonar JSON

Desativar escrita JSON apenas quando schema e constraints estiverem aprovados, importações ensaiadas e aceitas, restauração e rollback demonstrados, todas as rotas usam repositórios transacionais, testes de autorização e concorrência passam, sessões não dependem de Map, dados conciliados e janela de suporte definida. Remover código/leitura JSON em entrega separada após o prazo de retenção e autorização para expurgo. O arquivo fica acessível só a operadores autorizados e é eliminado segundo política aprovada; ignorado pelo Git não significa seguro.

## 10. Decisões pendentes

- Legitimidade/ambiente dos dados atuais e pessoa responsável pela aprovação da origem.
- Tenant, pacientes compartilhados/transferidos e eventuais mapeamentos de owner.
- Política de credenciais, tokens de convite/reset e obrigatoriedade de novo login.
- Inconsistências toleráveis, sem perder dados nem corrigir silenciosamente.
- RPO/RTO, janela de indisponibilidade e critério de rollback.
- Prazo e forma de retenção/expurgo da origem e de backups.
- Operador, ambiente, residência e acesso ao ensaio/corte.
