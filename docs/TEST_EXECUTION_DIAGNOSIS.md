# Diagnóstico de execução dos testes

Data: 2026-10-29. Diagnóstico feito sem ler `data/store.json`, instalar dependências ou modificar aplicação/testes. Os processos de reprodução usaram uma pasta temporária sintética (`DATA_DIR`) e não acessaram o store do projeto.

## Resumo

A causa confirmada neste ambiente é a política de sandbox que impede conexões HTTP loopback do processo de teste: chamadas `fetch` a `localhost` e `127.0.0.1` falham com `EACCES`. A API inicia normalmente quando `DATA_DIR` aponta para uma pasta gravável dentro do workspace e chega a imprimir a mensagem de que está disponível na porta escolhida. Assim, a falha ocorre depois do início/listen, quando o teste tenta alcançar o servidor.

Uma reprodução auxiliar usando `%TEMP%` como `DATA_DIR` também confirmou uma restrição distinta de escrita fora do workspace: a inicialização falhou em `rename` com `EPERM`. Esse não é o diretório usado pelo teste real, que guarda os dados em `apps/api/test/.runtime-data`.

`node_modules` ausente gera um aviso do pnpm, mas não é a causa desta falha e não é dependência necessária para a API: o servidor usa apenas módulos nativos do Node (`node:http`, `node:fs/promises`, `node:path`, `node:crypto`, `node:util`), e o pacote da API não declara dependências. O teste usa `node:test`, `node:child_process`, `node:fs/promises`, `node:os`, `node:path` e `node:net`, também nativos.

## Evidências e fluxo de execução

- Raiz: `package.json` declara `pnpm test` como `pnpm --filter @nutritrack/api test`.
- Workspace: `pnpm-workspace.yaml` inclui `apps/*`; o lockfile versão 9 contém importers raiz/API/web e uma única dependência de desenvolvimento raiz (`prettier`). Não há pacote externo no importer da API.
- `apps/api/package.json`: script `test` executa `node --test`; `start` executa `node src/server.js`; `dev` executa `node --watch src/server.js`. Runtime declarado `node >=20`.
- `apps/api/test/application.test.js`: escolhe porta efêmera reservando-a brevemente em `127.0.0.1:0`, inicia um filho Node apontando a `src/server.js`, define `PORT`, `DATA_DIR` para `apps/api/test/.runtime-data` e `NODE_ENV=test`, e tenta `fetch('http://localhost:<porta>')` até 60 vezes com intervalo de 100 ms. Após o teste, `t.after` mata o filho e remove a pasta temporária.
- `apps/api/src/server.js`: lê `PORT` (padrão 3000) e `DATA_DIR` (padrão `data`), chama `loadStore()`, que cria/carrega o arquivo, antes de `server.listen(PORT)`. Erros de startup são emitidos como `startup_error`; não existem imports externos nem chamadas a serviços externos para iniciar.
- Versões vistas: Node `v24.21.0`, pnpm `11.25.0`, compatíveis com os manifests.

### Reproduções

1. `pnpm test` na raiz — falhou, 0 passou/1 falhou. O teste terminou na asserção `servidor deve iniciar` após a janela de tentativas, com `fetch failed`; pnpm também avisou que `node_modules` estava ausente.
2. `node --test` em `apps/api` — mesma falha na asserção de prontidão, 0 passou/1 falhou.
3. Reprodução direta do processo filho com `DATA_DIR` em `%TEMP%` — `startup_error EPERM` ao renomear o arquivo inicial de store; requisição também falhou `EACCES`. Isso revela limitação de escrita fora do workspace e não representa a configuração do teste, que usa diretório no workspace.
4. Reprodução direta com `DATA_DIR` em `apps/api/test/.diag-data` — stdout do filho mostrou `NutriTrack disponível em http://localhost:<porta>`, stderr vazio e processo permaneceu ativo até encerramento intencional por SIGTERM. `fetch` tanto em `localhost` quanto em `127.0.0.1` falhou com `EACCES`.

A quarta reprodução separa inicialização de conectividade: o servidor efetivamente inicia e escuta, mas o sandbox bloqueia o cliente de teste ao conectar. Não houve evidência de conflito de porta, falha de import, configuração externa ausente ou encerramento espontâneo na reprodução com diretório gravável. O teste tenta uma porta dinâmica, reduzindo colisão; há uma pequena janela entre liberar a porta e o filho escutar, coberta pela repetição. O host binding é o padrão do Node (`listen(PORT)`); a restrição observada afeta ambos os nomes loopback usados na tentativa.

## Classificação

- **Falha de ambiente confirmada:** cliente `fetch` no ambiente restrito recebe `EACCES` para conexões locais.
- **Falha de inicialização da aplicação:** não reproduzida quando `DATA_DIR` está no workspace; aplicação anuncia `listen` e permanece ativa.
- **Falha funcional:** não determinada. A suíte não passou da checagem de prontidão, então nenhuma asserção sobre cadastro, autorização, planos ou agenda foi executada com sucesso.
- **Dependências:** ausência de `node_modules` provoca aviso do pnpm, mas não explica a falha HTTP nem impede o teste Node nativo; não instalar é a opção mínima.
- **Restrição auxiliar:** pastas fora das raízes graváveis podem falhar em operações de arquivo (`EPERM`), portanto o teste deve continuar com `DATA_DIR` dentro do workspace.

## Procedimento recomendado

Não há mudança de código nem instalação necessária. Para obter uma execução válida, executar o teste num contexto local autorizado a conectar processos a `localhost`/`127.0.0.1`, preservando a pasta de dados de teste dentro do workspace:

```powershell
Set-Location C:\Users\giuse\Desktop\NutriCare
pnpm test
```

Se o ambiente local continuar aplicando a mesma restrição, a execução deve ser feita fora desse sandbox ou após habilitar explicitamente loopback para o processo de teste. Não contornar a restrição alterando o teste para pular a chamada HTTP, nem apontar `DATA_DIR` para os dados existentes. Instalar dependências não corrige `EACCES` e não é recomendado. Nenhuma autorização de instalação é necessária para o procedimento acima porque ele não instala pacotes nem altera manifests/lockfile.

## Critérios para considerar a suíte executável

- `pnpm test` inicia o processo filho e a primeira requisição de prontidão recebe resposta HTTP antes do timeout de seis segundos.
- O processo de teste alcança as asserções funcionais e encerra filho e diretório `.runtime-data` mesmo em falha.
- O resultado reporta o total real de testes aprovados/reprovados; zero aprovação ou falha de prontidão não deve ser descrita como teste funcional aprovado.
- O store apontado por `DATA_DIR` é o temporário da suíte e nenhum teste depende de valores de `data/store.json`.

## Arquivos consultados e modificações

Consultados: `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml`, `apps/api/package.json`, `apps/web/package.json`, `apps/api/src/server.js` (sem ler conteúdo do store), `apps/api/test/application.test.js`, além de comandos/versões Node e pnpm. Criado somente este relatório. Não alterados: scripts, lockfile, aplicação e testes. As reproduções removeram suas próprias pastas de dados sintéticas.

## Limitações abertas

O sandbox não permite demonstrar a suíte funcional completa porque bloqueia loopback. O procedimento recomendado requer execução num contexto autorizado pelo usuário/ambiente; não foi tentado qualquer aumento de privilégio. O diagnóstico não é uma avaliação de produção, segurança ou dados reais. O estado funcional dos fluxos permanece não verificado até a suíte alcançar e concluir suas asserções.
