# Matriz de autorização — comportamento atual

Baseline observado em `apps/api/src/server.js`. “Implementado” descreve controles presentes no código; não afirma suficiência para uso real. Sessões vivem em memória, sem validação de idade no servidor. UUID é apenas identificador e nunca é considerado permissão.

| Cenário | Controle atualmente observado | Resultado esperado/observado pelo código | Lacuna / teste necessário |
|---|---|---|---|
| Profissional acessa seus pacientes | Listagens filtram `userId`; detalhe/edição usam `owned()`; novas avaliações, agenda, metas e planos verificam paciente do próprio usuário | Acesso permitido ao próprio recurso | Testar cada operação e coleções com duas contas sintéticas |
| Profissional tenta acessar paciente de outra conta | Busca por ID e `userId` devolve ausência | 404 | Teste existente cobre GET de paciente cruzado; faltam PATCH e criações de recursos ligados |
| Profissional modifica recurso de outro profissional | Avaliações/listas filtradas por dono; appointments/goals/plans usam `owned()` em mutações individuais | Ausência/404 ou filtragem de lista | Testar IDs cruzados para PATCH consulta/meta, GET/PUT/POST plano e listagens; não há garantia via banco |
| Paciente acessa próprio portal | Conta da sessão aponta a paciente/profissional; `safePatientPortal()` valida relação/arquivamento e projeta apenas dados selecionados | GET `/api/patient/me` requer sessão; login/ativação retornam portal | Cobertura automatizada inexistente; testar allowlist e vínculo após mudanças |
| Paciente tenta acessar dados de outra conta | Sessão identifica uma conta; portal consulta paciente e planos associados a essa conta | DTO não recebe ID de paciente fornecido pelo cliente | Testar duas contas e ausência de dados cruzados; não existe rota de portal com ID arbitrário |
| Acesso a plano não publicado | API profissional retorna plano por proprietário; portal inclui somente plano com `publishedVersionId` e versão `published` | Rascunho não entra no portal; profissional dono pode ler draft | Teste verifica publicação/versionamento mas não portal; validar paciente e versões publicadas/antigas |
| Identificador inexistente | `owned()` não encontra registro e rotas de recurso retornam 404 | 404; rotas não correspondentes também 404 após autenticação | Testar em cada família e evitar diferença que revele recursos de terceiros |
| Requisição sem autenticação | Rotas profissionais privadas retornam 401; rotas públicas de auth/convite/reset/logout são acessíveis sem sessão | 401 onde exigido | Testar todas as rotas privadas sem cookie; a suíte atual não cobre esse comportamento explicitamente |
| Sessão inválida | Token sem correspondência em `Map` resolve sem usuário/conta | Rotas privadas 401; portal 401 | Testar token aleatório, logout e reset; sessão expirada por tempo não é verificada no servidor |
| Sessão expirada por idade | Cookie de navegador declara Max-Age de 8h, mas lookup não verifica timestamp | Cookie enviado manualmente continua aceito enquanto token permanecer no mapa | Controle não implementado; teste de expiração backend necessário após implementação futura |
| Recursos de pacientes arquivados | Convite/login portal rejeitam paciente arquivado; handlers profissionais não bloqueiam uniformemente recursos associados | Dependente da rota | Definir e testar comportamento pretendido; não inferir regra geral |

## Síntese dos controles

**Presentes:** isolamento por `userId` no código para rotas profissionais examinadas; checagem de ownership do paciente na criação de recursos; vínculo profissional-paciente para conta portal; DTO allowlist no portal; filtro de publicação no portal; tokens de convite/reset com hash, validade, uso e revogação; logout remove token da memória; limites de payload e algumas validações de campos.

**Não encontrados:** rate limiting; expiração absoluta/ociosa verificada no servidor; armazenamento compartilhado/durável de sessão; autorização por tenant/equipe; fronteira de autorização no banco; teste sistemático negativo por rota/principal; proteção comprovada contra corridas de consumo de convite/reset ou conflito de agenda entre processos; autenticação forte/MFA. A lista descreve o código auditado e não é avaliação de conformidade.

## Casos mínimos para fechar cobertura da matriz

Usar duas profissionais e dois pacientes fabricados pelos testes, além de contas portal separadas; executar leituras, mutações e relações cruzadas por recurso. Incluir sem cookie, cookie aleatório, token após logout, sessão após reset e IDs inexistentes. Confirmar resposta do portal com rascunho e versão publicada, e assegurar que nenhuma informação de outra conta aparece. Executar contra store temporário exclusivamente sintético. Registrar limitações de teste de expiração até existir relógio/injeção ou controle server-side observável.

