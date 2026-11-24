# Reauditoria da main — 24/11/2026

**Referência exata:** `b759e773d9167e309d657066ec158a1bb1f698a2`. Branch de trabalho: `codex/main-reaudit`. A versão endurecida anterior permanece em `hardening/production-readiness`, commit remoto `e5d4202ab9f8af9e35118e96f91b3d26192d5b7f`. Não houve merge, deploy ou acesso ao Neon/Vercel nesta revisão.

## Parecer

**INTERNAL ALPHA para uso com dados fictícios.** A main atual não herda a nota80,4 nem os17 testes Node da versão SQLite. Possui arquitetura e escopo funcional diferentes. Dez testes próprios passaram com PostgreSQL local; provas adicionais confirmaram defeitos fora dessa suíte. Nenhum CRITICAL ou acesso clínico anônimo indevido foi confirmado. Não é atestado de ausência de vulnerabilidades ou de prontidão produtiva.

Há13 itens rastreáveis:4HIGH,7MEDIUM,2LOW. As contagens incluem defeitos, riscos arquiteturais e lacunas operacionais/comerciais; não significam13 vulnerabilidades exploráveis. Cada item explicita sua natureza, evidência e confiança em FINDINGS_TRACKER. Configuração real de infraestrutura é não verificada, não um incidente confirmado.

## Mudanças encontradas

O histórico da main foi reconstruído a partir de um ramo diferente: o ancestral comum com a versão antiga é `d7def2c`, e não a base da auditoria `987d692`. Não se trata de portar apenas alguns commits pendentes. Dez commits exclusivos da main substituem o backend Node JavaScript por TypeScript, removem Python e equipes/workspaces, reformulam frontend e introduzem PostgreSQL/Neon e Vercel. O produto atual é individual por profissional (`userId`). Tabelas de memberships/atribuições e seus endpoints não existem nesta main. Isso é uma diferença de escopo a preservar durante a opção1, não uma proteção que pode ser presumida como testada.

O banco atual tem tabelas relacionais, FKs compostas paciente/profissional, unicidade, índices, sessões compartilhadas com hash/expiração e vínculo ao hash da senha. Writes usam transação com revisão global compare-and-swap; dados carregados em REPEATABLE READ. Reset concorrente entre duas instâncias resultou200/409, sem duas conclusões. A revisão global impede duas gravações do mesmo snapshot, mas não impede uma edição clínica antiga ser submetida depois: o servidor recarrega a revisão e aceita a intenção desatualizada do cliente.

O readState agrega todas as tabelas de todos os profissionais num snapshot, incluindo hashes/metadata; filtra ownership depois. Uma única viagem SQL não equivale a consulta restrita por tenant. A API nega GET/PATCH cruzados nos testes; não foi demonstrado IDOR. Não existe RLS por profissional; isso é limite de defesa em profundidade e não prova vazamento. Revisão global também cria conflitos entre gravações de profissionais independentes.

## Achados confirmados nas provas adicionais

1. Um POST público com corpo incompleto prende a fila compartilhada daquela instância: /api/health não concluiu durante200ms, retornando200 após cancelar o POST. O limite de autenticação não evita o primeiro bloqueio. Vercel pode encerrar execução em60s, mas isso não corrige a fila ilimitada ou o custo/indisponibilidade por instância.
2. Duas edições do mesmo rascunho com expectedRevision0 retornam200/200; a segunda sobrescreve a primeira. Publicação com expectedRevision-999 também retorna200. Falta contrato otimista por recurso/intenção clínica.
3. Cancelar consulta, criar outra no mesmo horário e reativar a anterior retorna201/200, deixando conflito ativo.
4. Avaliação com cintura não numérica e data2026-99-99 retorna201. O banco contém literalmente `NaN` e a data impossível; JSON responde cintura null. PATCH aceita status arbitrário. meals:[null] produz500 em vez de erro de contrato4xx.
5. No navegador real, cadastro/paciente/plano foram criados pela UI; ao reabrir o plano salvo, nome e objetivo estavam vazios. Browser-editor.txt e browser-results.json registram o resultado. Salvar pode apagar campos opcionais sem o usuário perceber.
6. JSON de desenvolvimento ainda altera o objeto antes de recusar PATCH:400 e nome vazio na leitura seguinte. PostgreSQL recarrega o snapshot e preserva o nome; não classificar esse caso como corrupção persistida de produção.

## Segurança, privacidade e operação

Ownership é conferido no servidor para pacientes, avaliações, agenda, metas, planos e links. Portal só projeta publicação; credenciais não são DTOs. Cookies PostgreSQL têm TTL8h, HttpOnly, Strict e Secure em produção. Login usa scrypt/timingSafeEqual; tokens aleatórios armazenados com hash. Rate limit compartilhado20/IP/15min e logs sem corpos/URLs/PII são avanços existentes. Origem externa e content type são verificados; Origin ausente ainda é aceito e APP_ORIGIN tem fallback Host. Não foi demonstrado CSRF contornando Strict/JSON: configuração explícita será endurecida sem chamar o fallback de exploração confirmada.

Recuperação/verificação de e-mail profissional, MFA no aplicativo, troca/revogação global pelo titular e exportação/exclusão técnica não estão implementadas. MFA de GitHub/Vercel/Neon, mencionado nos documentos, não substitui MFA do SaaS. Há minuta de privacidade, não política final publicada/operável. Dados de saúde, retenção clínica, snapshots legados e cópias exigem decisão do responsável. Audit mantém500 eventos globais: outro profissional pode deslocar histórico de terceiros produzindo eventos legítimos; não concede leitura cruzada, mas prejudica rastreabilidade.

Backup atual já usa AES256GCM, transação consistente, destino vazio e invalidação de convites/resets na restauração. As sessões não são copiadas. Dez testes incluem restauração em schema sintético vazio e papéis restritos. Documentos anteriores relatam grupos/snapshot no Neon e implantação Vercel; essas informações são históricas, não foram reconsultadas. Login runtime restrito, DB_AUTO_MIGRATE=false, alertas, agenda/cópia externa e estado de produção continuam NV nesta revisão. Não executar scripts de schema/grants no Neon para suprir essa evidência sem autorização.

## Qualidade e dependências

Build TypeScript e typecheck passam, com strict:false. Não há lint semântico nem workflow de CI nesta main; Dependabot não é CI. Prettier falha em12 arquivos. A suíte normal passa3 e ignora7 sem TEST_DATABASE_URL; com PostgreSQL descartável passa10/10. Isso deve virar gate obrigatório para impedir validação enganosa.

pnpm audit consultou a árvore instalada/travada e retornou zero advisories conhecidos. Coletores de supply chain examinaram4 dependências diretas da API e1 da raiz; o coletor não interpreta pnpm-lock e usa fallback latest, portanto seu resultado não substitui o pnpm audit exato. Registrou concentração de publisher para pg e pacotes de tipos; não é vulnerabilidade confirmada. GitHub CLI ausente limita alguns sinais upstream; dado indisponível não é evidência de risco. Instalação frozen-lockfile/ignore-scripts funcionou. Não há dependências Python nesta main.

## Próxima integração

Preservar TypeScript/PostgreSQL/Vercel/Neon e UI atual. Portar comportamentos/testes das correções, não substituir pastas inteiras nem cherry-pick da branchSQLite. Reutilizar backup e sessões PostgreSQL existentes; não trazer SQLite/Python ou Docker como nova arquitetura. Migrações futuras explícitas com ensaio local e expansão compatível. Antes de escrever na main, considerar que push pode disparar deploy Vercel: a autorização de commit não equivale a autorização de alteração produtiva. Plano técnico em INTEGRATION_PLAN.

Limitações: sem pentest/benchmark de carga de produção, browser somente desktop Chromium e fluxos citados, sem E2E completo/scan de imagens/percentual de cobertura. Sem nova nota numérica para evitar comparação enganosa com uma versão de escopo diferente. A classificação não melhora apenas por os testes existentes passarem.
