# Módulo de planos alimentares — marco inicial

## Objetivo

Criar um plano por paciente, registrar refeições, quantidades, unidades, orientações e substituições; publicar um snapshot validado; preservar o snapshot quando alterações posteriores forem salvas como nova versão.

## Arquivos envolvidos

- `apps/api/src/server.js`: estado JSON, validação das refeições/itens, isolamento por profissional, rotas e auditoria.
- `apps/web/public/app.js`: página de planos, editor com refeições/alimentos dinâmicos, operações de rascunho/publicação e histórico.
- `apps/web/public/index.html`: item Planos alimentares na navegação.
- `apps/web/public/styles.css`: cartões de planos, formulário de refeições, itens e responsividade.
- `apps/api/test/application.test.js`: fluxo de versão, regra de publicação e isolamento por profissional.

## Fluxo dos dados

1. A interface carrega os pacientes autorizados do profissional.
2. O profissional salva um plano ligado a um desses pacientes; o servidor confirma a propriedade.
3. O servidor normaliza uma versão `draft` numerada e salva junto ao plano.
4. Publicar exige ao menos uma refeição e, em cada item, alimento, quantidade positiva e unidade.
5. O servidor marca a versão atual como `published` e registra `publishedAt` e `publishedVersionId`.
6. Se o profissional editar após publicar, o backend cria a versão seguinte como `draft`. O objeto publicado anterior não é alterado.

## Regras e limites deste marco

- A publicação não afirma validade clínica e não calcula energia/macronutrientes. Não há base alimentar integrada, então nutrientes não são inventados.
- A publicação fica visível no espaço profissional e no portal separado do paciente vinculado. O portal expõe somente o snapshot publicado atual; dados clínicos, avaliações e rascunhos continuam restritos ao profissional.
- O plano usa o mesmo store JSON local do MVP; isso não oferece transações relacionais, concorrência robusta ou backup automatizado.
- Apenas o profissional proprietário pode listar, consultar, editar ou publicar o plano. Alterar UUID no cliente não concede acesso.
- O rascunho pode permanecer incompleto; a validação completa ocorre no momento de publicar.

## Conceitos técnicos

- **Snapshot:** cópia dos campos de uma versão no momento em que ela foi salva/publicada. O plano aponta para versões por ID, em vez de sobrescrever uma versão publicada.
- **Estado explícito:** `draft` e `published` permitem validar operações no servidor, independentemente do que a interface exiba.
- **ID e autorização:** UUID localiza o recurso; a consulta `owned(..., uid)` é que decide o acesso.
- **Dados persistidos sem inferência:** quantidade e unidade são campos informados pelo profissional; não se estimam nutrientes ausentes.

## Verificação e exercício

`pnpm test` passou nesta etapa: 1 teste de integração cobre criação de rascunho, bloqueio de publicação incompleta, publicação de v1, criação de v2 sem mutar v1 e tentativa de leitura por outro profissional.

**Exercício:** acrescente no teste um item com quantidade zero e confirme que a API responde com erro; depois adicione uma regra de unidade obrigatória na versão final. Identifique se essa verificação pertence à validação da entrada, à publicação ou a ambas.
