# Parecer final de prontidão — main PostgreSQL

**INTERNAL ALPHA. Ainda não liberar clientes reais/prontuários reais.** Código fortalecido e validado localmente; produção efetiva não comprovada. A main publicada permanece9c92148, sem estas mudanças de código. Nenhum deploy ou SQL real realizado.

## Critérios e pontuação

Mesmos12 pesos e cinco critérios0/10/20 do relatório original. A reauditoria da main não publicou nota numérica; a coluna inicial abaixo é **reavaliação retrospectiva da baseline b759e77**, com os mesmos critérios antes/depois. Não atribuir automaticamente42,7 da versão antiga ou80,4 da branchSQLite à main TypeScript/PostgreSQL. Critério de membership/filtros do backend considera ownership individual atual; não adiciona equipe ou Python removidos.

| Categoria | Peso% | Main antes | Atual | Cinco pontos atuais |
|---|---:|---:|---:|---|
| Segurança aplicação |12|70|90|20/20/20/10/20|
| Segurança APIs |10|60|90|20/20/20/10/20|
| Autenticação/autorização |12|60|90|20/20/20/20/10|
| Isolamento clientes |14|80|90|20/20/20/20/10|
| Banco |10|80|90|10/20/20/20/20|
| Qualidade |5|60|80|20/10/20/20/10|
| Performance |5|30|70|10/10/20/20/10|
| Infra/DevOps |10|50|60|20/20/10/10/0|
| Privacidade técnica |8|40|60|20/20/10/0/10|
| UX |4|70|90|20/20/20/20/10|
| Testes/confiabilidade |6|70|90|20/20/20/20/10|
| Comercial |4|40|60|20/20/10/0/10|

**62,1→81,9/100.** Nota heurística de código/evidência, não certificação. Critérios parciais: abuso/carga real, limites/contratos ainda incrementais; SMTP real/MFA das contas de infraestrutura; defesa DB real sem RLS e grants ainda externos; schema JSONB parcialmente semântico na aplicação; legado não todo tipado/modular; pool/escala não demonstrados; CI remoto/TLS/alertas externos; direitos completos sujeitos à retenção; acessibilidade/browser e recuperação/suporte reais. Média não compensa bloqueadores.

## Contagens auditáveis

- Baseline da main:13 itens (4HIGH,7MEDIUM,2LOW), incluindo defeitos/riscos/lacunas; zero CRITICAL confirmado.
- Reauditoria de implementação: um novo HIGH, MAIN-014, corrida de login no intervalo de revogação/ativaçãoMFA. Corrigido com epoch e regressão em duas instâncias.
- Total14 acompanhados:11VALIDATED no escopo local,1IMPLEMENTED aguardando CI remoto e2BLOCKED por operação/decisões externas.
- Entre os itens tratados há falhas confirmadas de disponibilidade/integridade/autenticação MAIN-001/003/004/005/013/014, além de defeitos funcionais e lacunas de proteção. Não equivalem a11CVEs eliminados.
- Dependências: zero advisories conhecidos antes/depois nesta main. Não contabilizar aqui oito advisories Python de uma branch anterior, pois Python não integra a main.
- Melhorias mapeadas aos11 itens validados e à implementação parcial dos3 restantes; não há uma contagem artificial por linha de código.
- Dez testes Node/PG anteriores→28casos Node aprovados,0fail/0skip, mais2E2E; lint/tipos/build/migração/restore aprovados localmente. Cobertura percentual indisponível.

## Gates comerciais

Nenhum CRITICAL conhecido sem tratamento ou API clínica anônima indevida foi identificado na reauditoria. Ownership e isolamentos backend, inclusive exportações e exclusão da própria conta, têm provas diretas com dois profissionais. Sessões, reset/MFA/revisões/agenda/dados inválidos têm regressões. Não há credencial privada comprometida conhecida nos formatos/arquivos varridos; isso não certifica serviços/histórico externos.

Permanecem HIGH bloqueadores: operação real (SMTP, conta runtime/grants, backup externo/alertas/restore/rollout) e privacidade (políticas/bases legais/retenção clínica/atendimento). CI remoto e pacote novo não foram executados. Novos guards produtivos impedem startup sem configuração: fazer push agora sem preparar ambiente pode indisponibilizar a API. Nenhum deploy dessas alterações ocorreu.

PostgreSQL/Vercel/Neon e UI individual preservados. Não há billing/premium/webhook financeiro ou serviço pago novo. Benchmarks de metas não provam capacidade comercial; limites técnicos1MB/registro,32MiB/profissional e páginas200 não são planos/SLA. MFA/outbox não cifram todo o prontuário; operação deve proteger banco e backups. Exclusão de conta ativa não elimina automaticamente cópias históricas.

**Próximo passo:** cumprir MANUAL_ACTIONS_REQUIRED em homologação isolada, validar entrega/recuperação/políticas, executar CI/pacote e obter autorização para promover commit à main/produção. Depois de smoke e piloto fechado monitorado, reavaliar CLOSED BETA/produção com evidências do ambiente. A prontidão técnica local não substitui a prontidão comprovada de produção.

Limite arquitetural explícito: o marcador global v1 é mantido por compatibilidade e pode serializar commits curtos; o desempenho de escrita distribuída não foi certificado. CAS não usa mais esse marcador para rejeitar snapshots de profissionais independentes.
