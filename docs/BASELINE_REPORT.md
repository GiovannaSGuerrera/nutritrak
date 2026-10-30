# Relatório baseline — Fase 1

Data: 2026-10-29. Escopo limitado à inspeção de código/documentos e execução da suíte existente. `data/store.json` não foi lido nem impresso. Nenhuma lógica de produção foi modificada; não foram adicionados testes porque o único teste depende de iniciar um servidor filho/loopback e falhou antes de alcançar qualquer asserção funcional neste ambiente.

## Estado atual verificado

- Repositório pnpm com API Node.js CommonJS baseada em `node:http`, web estática e um teste de integração (`apps/api/test/application.test.js`).
- A API persiste em `data/store.json`, com serialização de escrita em fila, arquivo temporário e rename; sessão profissional/paciente usa `Map` em memória.
- Hash de senha usa scrypt/salt; tokens de convite/reset são armazenados como hash e possuem prazo/estado. Não há envio de e-mail no servidor: tokens são devolvidos à interface.
- Ownership profissional é baseado em `userId`; o portal vincula paciente/profissional e produz DTO com planos publicados. Não existe tenant/equipe.
- Não encontrada validação de expiração da sessão no servidor, rate limiting, nem evidência de infraestrutura de produção ou restore.
- Inventário: [ROUTE_INVENTORY.md](ROUTE_INVENTORY.md). Matriz: [AUTHORIZATION_MATRIX.md](AUTHORIZATION_MATRIX.md).

## Comandos de teste e resultados reais

1. `pnpm test` (raiz; script encaminha a `node --test` em `apps/api`): **falhou**, 0 passou / 1 falhou. O teste `autenticação, cadastro, avaliação, isolamento e conflito de agenda` falhou na asserção de prontidão do servidor: `fetch failed`; saída do pnpm também avisou `node_modules` ausente.
2. `node --test` (diretório `apps/api`): **falhou**, 0 passou / 1 falhou. Mesmo erro de prontidão (`fetch failed`) após 60 tentativas; a aplicação não alcançou as asserções do fluxo. O subprocesso não apresentou stderr capturado.

Não foi declarado nenhum teste como aprovado. A falha aponta impedimento no início do servidor/teste (compatível com restrição de loopback deste ambiente, mas causa não conclusiva); não prova que os fluxos funcionam nem que falham funcionalmente. Não foram instaladas dependências.

## Cobertura existente e ausente

O único teste tenta cobrir cadastro profissional, leitura de assets, criação de paciente/avaliação, rascunho/publicação/versionamento de plano, GET cruzado de paciente/plano e conflito simples de agenda. Como falhou no readiness, nenhuma dessas verificações foi exercitada com sucesso nesta execução.

Sem cobertura automatizada observada: login/logout e `/api/me`; isolamento de PATCH e criação cruzada por rota; isolamento de paciente no portal; convite/ativação/reset; portal e filtro de plano publicado; listas/dashboard; metas e mudança de status; validações negativas abrangentes; identificadores inexistentes e sessões inválidas/expiradas; concorrência de agenda/tokens; limite de corpo e falhas de persistência.

## Riscos que permanecem

- Arquivo JSON e sessões locais em memória não fornecem transação relacional, coordenação entre instâncias ou sessão compartilhada.
- A validade de cookie é limitada no navegador, mas expiração da sessão não é imposta no backend; sessões não têm limite de abuso/rate limit.
- Cobertura não demonstra isolamento completo nem portal seguro em todos os cenários; teste nem sequer iniciou o servidor nesta execução.
- Algumas validações são apenas truncamento/conversão, não schema consistente; cintura/quadril não têm faixa numérica explícita e data de avaliação valida formato, não calendário.
- Checagem de conflito de agenda é check-then-act em memória/processo único; corridas concorrentes não foram demonstradas.
- Sem evidência versionada de backup/restauração, TLS, gestão de segredos, monitoramento ou implantação. Não se conclui prontidão para produção/dados reais nem conformidade com LGPD.

## Limitações da auditoria

Inspeção estática do repositório e uma tentativa da suíte atual; sem teste manual de UI, pentest, análise de infraestrutura, revisão legal, leitura do store, medição multi-processo ou verificação de comportamento em ambiente compatível com loopback. Documentos arquiteturais foram tratados como propostas/registro contextual; funcionalidades foram afirmadas somente quando encontradas no código.

## Critérios para considerar a Fase 1 concluída

- Inventário de todos os handlers e caminhos estáticos relevantes publicado, com principal, recurso, autorização, validação, dados e lacunas de teste.
- Matriz separa verificações presentes de controles ausentes, incluindo sessões inválidas/expiração e acesso cruzado.
- Suíte executada em ambiente capaz de iniciar servidor e resultados registrados sem mascarar falhas; testes complementares usam somente dados sintéticos e não alteram lógica de produção.
- Responsável decide se deve ser criada uma harness isolada para permitir a suíte neste ambiente e prioriza os testes negativos faltantes antes de mudanças de arquitetura.

## Próxima fase recomendada

Resolver primeiro a causa ambiental do startup/loopback do teste e obter uma execução válida da suíte em dados temporários sintéticos; então ampliar testes negativos de isolamento/portal/sessões conforme a matriz. As decisões de tenant, vínculo/transferência, escopo do portal e ciclo de vida continuam bloqueando schema e persistência da evolução SaaS. Não avançar automaticamente para a Fase 2.
