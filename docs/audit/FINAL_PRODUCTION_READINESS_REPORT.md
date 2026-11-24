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
| Infra/DevOps |10|50|70|20/20/20/10/0|
| Privacidade técnica |8|40|60|20/20/10/0/10|
| UX |4|70|90|20/20/20/20/10|
| Testes/confiabilidade |6|70|100|20/20/20/20/20|
| Comercial |4|40|60|20/20/10/0/10|

**62,1→83,5/100.** Nota heurística de código/evidência, não certificação. Critérios parciais: abuso/carga real, limites/contratos ainda incrementais; SMTP real/MFA das contas de infraestrutura; defesa DB real sem RLS e grants ainda externos; schema JSONB parcialmente semântico na aplicação; legado não todo tipado/modular; pool/escala não demonstrados; TLS/alertas externos; direitos completos sujeitos à retenção; acessibilidade/browser e recuperação/suporte reais. Média não compensa bloqueadores.

## Contagens auditáveis

- Baseline da main:13 itens (4HIGH,7MEDIUM,2LOW), incluindo defeitos/riscos/lacunas; zero CRITICAL confirmado.
- Reauditoria de implementação: um novo HIGH, MAIN-014, corrida de login no intervalo de revogação/ativaçãoMFA. Corrigido com epoch e regressão em duas instâncias.
- Total14 acompanhados:12 VALIDATED no escopo local/CI Linux e2 BLOCKED por operação/decisões externas.
- Entre os itens tratados há falhas confirmadas de disponibilidade/integridade/autenticação MAIN-001/003/004/005/013/014, além de defeitos funcionais e lacunas de proteção. Não equivalem a12 CVEs eliminados.
- Dependências: zero advisories conhecidos antes/depois nesta main. Não contabilizar aqui oito advisories Python de uma branch anterior, pois Python não integra a main.
- Melhorias mapeadas aos12 itens validados e à implementação parcial dos2 restantes; não há uma contagem artificial por linha de código.
- Dez testes Node/PG anteriores→28 casos Node aprovados,0 fail/0 skip, mais2 E2E; lint/tipos/build/migração/restore aprovados localmente. Cobertura percentual indisponível.

## Gates comerciais

Nenhum CRITICAL conhecido sem tratamento ou API clínica anônima indevida foi identificado na reauditoria. Ownership e isolamentos backend, inclusive exportações e exclusão da própria conta, têm provas diretas com dois profissionais. Sessões, reset/MFA/revisões/agenda/dados inválidos têm regressões. Não há credencial privada comprometida conhecida nos formatos/arquivos varridos; isso não certifica serviços/histórico externos.

Permanecem HIGH bloqueadores: operação real (SMTP, conta runtime/grants, backup externo/alertas/restore/rollout) e privacidade (políticas/bases legais/retenção clínica/atendimento). CI Linux aprovado;pacote Vercel novo não executado. Novos guards produtivos impedem startup sem configuração: fazer push agora sem preparar ambiente pode indisponibilizar a API. Nenhum deploy dessas alterações ocorreu.

PostgreSQL/Vercel/Neon e UI individual preservados. Não há billing/premium/webhook financeiro ou serviço pago novo. Benchmarks de metas não provam capacidade comercial; limites técnicos1MB/registro,32MiB/profissional e páginas200 não são planos/SLA. MFA/outbox não cifram todo o prontuário; operação deve proteger banco e backups. Exclusão de conta ativa não elimina automaticamente cópias históricas.

**Próximo passo:** cumprir MANUAL_ACTIONS_REQUIRED em homologação isolada, validar entrega/recuperação/políticas, executar pacote Vercel e obter autorização para promover commit à main/produção. Depois de smoke e piloto fechado monitorado, reavaliar CLOSED BETA/produção com evidências do ambiente. A prontidão técnica local não substitui a prontidão comprovada de produção.

Limite arquitetural explícito: o marcador global v1 é mantido por compatibilidade e pode serializar commits curtos; o desempenho de escrita distribuída não foi certificado. CAS não usa mais esse marcador para rejeitar snapshots de profissionais independentes.

CI remoto aprovado:run45396373697 em Linux,commit2db9fa5. Nota100 da categoria testes indica satisfação dos cinco critérios definidos,não 100% de cobertura nem ausência universal de defeitos.


## Critérios da matriz

Na ordem dos cinco pontos: aplicação=injection/encoding/origem-headers/abuso/atomicidade; APIs=auth privada/projeção de campos/schemas/limites/contrato único; auth=hash/TTL/autorização/recuperação/email-MFA; isolamento=identidade do tenant/ownership/filtros backend/FKs/defesa DB; banco=schema/constraints/transações/índices/migração-restore; qualidade=workspaces/módulos/validação/erros/consistência; performance=assets/pool/paginação/carga/budgets; infraestrutura=perfil deploy/health-config/CI/restore/TLS-alertas; privacidade=minimização/acesso/direitos/retenção/política operável; UX=estados/formulários/responsividade/erros/acessibilidade; testes=Node/isolamento/PG/concorrência/CI-E2E-restore; comercial=fluxos/escopo/operação/privacidade/recuperação-suporte.

Baseline retrospectiva dos cinco pontos, na mesma ordem das categorias:20/20/10/10/10;20/20/0/0/20;20/20/20/0/0;20/20/10/20/10;10/20/20/10/20;20/10/10/10/10;10/10/0/0/10;20/20/0/10/0;20/20/0/0/0;20/10/20/10/10;20/20/20/10/0;20/20/0/0/0.

## Estado atual da publicação — 24/11/2026

Publicado na main (código 927dc36) e na Vercel, deploy com runtime restrito dpl_64ufV5ibN1ZMXp7UGkFRy6a7k5Fc READY. Migração Neon 2 aplicada, 11 profissionais/6 pacientes preservados. SMTP, documentos e operação de backups adiados pelo responsável. 31 testes Node/PG, 2 E2E e 15 verificações HTTP externas aprovados. Consulte [NO_EMAIL_RELEASE_STATUS.md](NO_EMAIL_RELEASE_STATUS.md) e evidence/production-smoke-2026-11-24.json. As seções anteriores sobre produção intocada/pedidos de autorização são histórico anterior à publicação, não o estado atual. A nota 83,5 pertence ao pacote anterior com e-mail previsto, não foi recalculada para este modo. MAIN-002 fica BLOCKED no ambiente sem SMTP, embora MFA/senha/revogação e implementação de envio estejam testados; MAIN-008/009 continuam parciais e adiados. Estado consolidado: 11 VALIDATED, 3 BLOCKED (funcionalidades/operação/privacidade adiadas); não significa três falhas exploráveis confirmadas. Classificação INTERNAL ALPHA, sem aprovação comercial integral.
