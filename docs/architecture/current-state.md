# Diagnóstico do repositório — 2026-10-28

## Escopo e evidência

Inspecionados os arquivos do workspace, os manifests, scripts, versões locais de Node/npm/pnpm, endpoints e teste de integração. O diretório não contém `.git`; `git status --short --branch` responde `fatal: not a git repository`. Portanto não há como confirmar commits, branches ou alterações locais anteriores. Nenhum banco foi encontrado ou alterado.

## Estado encontrado antes da reorganização

- Node.js nativo, JavaScript sem dependências de runtime; servidor HTTP próprio.
- Interface web com arquivos estáticos, sem framework.
- API e interface servidas pelo mesmo processo. Autenticação, dashboard, pacientes, avaliações, agenda e metas estavam concentrados em `server.js`.
- Persistência em `data/store.json`; sem schema relacional, transações de banco ou migrações.
- Senhas derivadas com scrypt. Sessões aleatórias em Map na memória, cookie HttpOnly/SameSite Strict com oito horas.
- Isolamento por `userId` nas rotas atuais; teste cobre uma tentativa de acesso cruzado.
- Um teste de integração: conta/paciente, avaliação (IMC e massa gorda), isolamento e conflito de agenda.
- README de execução e limites; sem Docker, CI, linter, formatter, build, Next/Nest/Expo, Prisma ou PostgreSQL.
- Versões observadas: Node 24.21.0, npm 11.19.0, pnpm 11.25.0.

## Inventário e classificação

| Componente anterior | Classificação | Fundamentação |
| --- | --- | --- |
| `server.js` | Reutilizável com adaptações | Tem endpoints e regras executáveis; monólito ainda precisa de módulos e persistência substituível. Movido para `apps/api/src/server.js`. |
| `public/index.html`, `app.js`, `styles.css` | Reutilizável com adaptações | UX e fluxos funcionam, mas o cliente mistura renderização, chamadas e estado. Movidos para `apps/web/public/`. |
| `test/application.test.js` | Reutilizável com adaptações | Cobre regras úteis, mas não consultas detalhadas, persistência relacional, paciente ou planos. Movido para `apps/api/test/`. |
| `package.json` | Necessário refatorar | Era um único pacote. Substituído por workspace privado e manifests por app, sem dependências novas. |
| `.env.example` | Reutilizável com adaptação | Removida `SESSION_SECRET`, não consumida pelo código. |
| Store JSON e sessões em memória | Substituir em etapa futura | Mantidos no MVP; inadequados para operação multi-instância e histórico clínico. Nenhum dado foi migrado ou apagado. |
| Ausência de Git | Risco/ação externa | Git não foi inicializado automaticamente; o histórico anterior é desconhecido. |

## Funcionalidades encontradas

Cadastro/login profissional; cadastro, edição, busca e filtro de pacientes; perfil com avaliações, agenda e metas; IMC e estimativa de composição; agenda com conflito e status; metas; dashboard derivado do store; auditoria operacional limitada. Ainda não há conta/portal de paciente, plano alimentar versionado ou CRUD de consulta clínica.

## Implementações posteriores ao diagnóstico

O MVP agora inclui planos alimentares versionados e publicados, além do portal separado do paciente em `/paciente`. A conta do paciente tem cookie próprio; convites de uso único expiram em sete dias e exigem um e-mail previamente cadastrado. O DTO do portal inclui somente os snapshots publicados do paciente vinculado. Ambos os espaços continuam usando o mesmo `store.json`; atualização manual sincroniza publicações novas. O profissional pode gerar um link manual de redefinição de senha para a paciente; o link expira em 24 horas e só pode ser usado uma vez. Persistência relacional, alertas, rate limiting e recuperação automática por e-mail continuam pendentes.

## Problemas e riscos

1. `server.js` concentra persistência, rotas, autorização, cálculos e servidor estático.
2. JSON não fornece constraints relacionais ou transações; a gravação local não substitui um banco multiusuário.
3. Sessões em memória terminam no restart e não são revogáveis por usuário nem compartilhadas entre instâncias.
4. Login sem rate limiting; recuperação automática por e-mail ainda não está disponível.
5. Relação direta entre profissional e paciente; clínica/equipe e identidade de paciente precisam de modelagem antes de abrir esse acesso.
6. Teste estreito; sem cobertura de CSRF/XSS, limites de login, ciclo de sessão, relatórios ou falhas de persistência.
7. Sem Git não há trilha local para comparar ou restaurar o estado anterior.

## Decisões seguras já realizadas

Separados dois workspaces, `apps/api` e `apps/web`, preservando o servidor e a interface. Nenhum framework ou dependência de runtime foi introduzido; Prettier é usado como dependência de desenvolvimento para formatação. A API continua servindo os assets web e `data/` permanece na raiz. Nenhum dado foi removido.
