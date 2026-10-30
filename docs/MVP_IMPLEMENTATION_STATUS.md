# Estado da implementação do MVP

Atualizado em 2026-10-29. Este é um MVP local incremental em cima da aplicação existente. As telas e fluxos anteriores continuam servidos pelo mesmo frontend e API; não é uma reconstrução nem uma plataforma pronta para hospedar dados reais.

## Implementado neste incremento

- Cadastro cria somente a identidade. Antes do painel, a pessoa escolhe entre criar um consultório próprio (informa o nome e escolhe explicitamente se também terá papel clínico) ou entrar por convite de uma equipe. A conta convidada recebe só os papéis do convite e não vira gerente automaticamente.
- A proprietária pode criar workspaces adicionais do tipo clínica. A API também aplica essa regra; um profissional membro sem papel de proprietário recebe 403. O seletor alterna entre workspaces com membership ativo.
- Convites de equipe com validade de sete dias e uso único são criados pela interface. O link é mostrado para cópia manual; não há envio de e-mail. O endereço convidado precisa autenticar com a mesma conta de e-mail.
- Papéis iniciais: proprietário administrativo, administrador operacional, assistente sem acesso clínico e nutricionista. Proprietário/administrador operacional gerem membros. Apenas proprietário concede o papel de administrador operacional ou proprietário; não se pode remover/rebaixar o último proprietário.
- Pacientes e seus históricos recebem `workspaceId`. Atribuições principal e de apoio são explícitas. Administradores autorizados fazem atribuições; nutricionista pode se designar principal ao criar paciente.
- Administradores e assistentes veem cadastro e agenda com notas clínicas removidas. Não leem avaliações, objetivos, metas ou observações clínicas. Nutricionistas só acessam prontuário dos pacientes a que estão atribuídos. A API verifica membership, papel, workspace e atribuição em cada operação privada.
- Membership revogado perde acesso na próxima requisição; revogar membership também encerra suas atribuições clínicas sem transferi-las automaticamente.
- Contas antigas sem workspace recebem uma etapa de migração explícita. Ela mostra somente cadastros antigos do próprio usuário, permite selecionar pacientes a atribuir clinicamente, cria cópia de segurança antes da mudança e grava `workspaceId` nas relações antigas no mesmo fluxo. Se a conta aceitar convite antes de migrar, ainda pode organizar dados antigos pelo botão **Organizar dados antigos**. Não há migração automática ao iniciar o servidor.
- O portal de paciente continua separado e associado ao paciente no workspace. Criar convite ou redefinir acesso ao portal exige o nutricionista atribuído.
- O modelo de persistência JSON local, telas de avaliação, agenda, metas, planos versionados/publicados e portal foram preservados. Novos registros vinculados agora incluem o workspace e seus handlers aplicam o mesmo escopo.

## Validação

- `node --check apps/api/src/server.js` e `node --check apps/web/public/app.js` aprovados.
- `pnpm --filter @nutritrack/api test`: 3 testes aprovados. A integração cobre o fluxo existente, cadastro sem workspace automático, escolha de nome/papel no workspace inicial, convite e aceite sem workspace pessoal para a conta convidada, bloqueio de criação por membro, nutricionista sem atribuição e após atribuição, projeção clínica do assistente, isolamento entre workspaces, migração legada com backup em store sintético, portal, conflito de agenda, persistência, logout e expiração de sessão.
- Os testes usam somente um `DATA_DIR` temporário com dados sintéticos; nenhum store real foi aberto ou migrado.

## Limites conhecidos

- Persistência é arquivo JSON de uma instância, sem transações ou coordenação entre processos. Sessões permanecem em memória e desaparecem ao reiniciar. Não usar para hospedagem pública ou dados clínicos reais.
- Convites e redefinição do portal dependem de compartilhamento manual de links; não há serviço de e-mail, rate limit ou MFA.
- Uma conta de portal é identificada globalmente por e-mail nesta versão. Seleção de múltiplos workspaces/identidades de paciente e customização de papéis não fazem parte deste corte.
- A atribuição de apoio concede acesso clínico como uma atribuição ativa, igual à principal, até existir granularidade adicional aprovada.
- Revogação é verificada a cada nova requisição dentro deste processo; não há sessão compartilhada entre instâncias nem semântica de operação em andamento para produção.
- A migração local é transacional no processo e preserva cópia de segurança anterior, mas não substitui ensaio de backup/restore, importador ou banco relacional para operação multi-instância.
- A aplicação não declara conformidade automática com LGPD nem prontidão operacional, jurídica ou de segurança para clínica real.

## Inicialização local

Requer Node.js 20+ e pnpm compatível com `packageManager` no `package.json`.

```powershell
Set-Location C:\Users\giuse\Desktop\NutriCare
pnpm dev
```

Abra `http://localhost:3000`. Faça cadastro com dados fictícios e senha de pelo menos 12 caracteres. Para convidar uma equipe, abra **Equipe**, gere o link e compartilhe manualmente com a pessoa. Para checar a suíte, execute `pnpm --filter @nutritrack/api test` em ambiente que permita conexões loopback entre processos.
