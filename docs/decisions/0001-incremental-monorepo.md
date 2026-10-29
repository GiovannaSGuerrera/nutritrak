# ADR 0001 — Separar API e web sem substituir a stack

- **Estado:** Aceita para a primeira transição
- **Data:** 2026-10-28

## Contexto

O repo era um pacote Node.js sem dependências, com HTTP e assets no mesmo diretório/processo. O produto prevê apps móveis, mas não existe contrato API estável ou banco relacional. Não há `.git`, logo o histórico não pôde ser verificado.

## Alternativas

1. Reescrever imediatamente em Next.js, NestJS, Prisma/PostgreSQL e Expo.
2. Preservar a estrutura plana até criar cada app novo.
3. Separar em workspaces API/web, mantendo fluxos e adiando dependências.

## Decisão

Escolhida a opção 3. API e teste ficam em `apps/api`; assets em `apps/web`; pnpm workspaces permite dependências por app no futuro. A API continua servindo o site, os dados JSON continuam na raiz e nenhum framework foi adicionado.

## Consequências

- Fica explícito o limite lógico API/web e há comandos por workspace.
- A aplicação segue executável sem downloads de dependências externas.
- Web/API não têm deploy separado e o contrato REST permanece informal.
- O monólito e JSON precisam evoluir antes do uso multi-cliente.
- Esta mudança de diretório não significa que o produto esteja pronto para comercialização.

## Validação

`pnpm install --lockfile-only` concluiu e gerou lockfile sem dependências de runtime. `node --check` passou para servidor, cliente e teste. `pnpm test` passou: 1 teste de integração cobre cadastro, cálculo, isolamento profissional e conflito de agenda.
