# Resumo executivo — auditoria multi-tenant

**Data:** 2026-10-29  
**Resultado:** o repositório contém um MVP funcional para uma profissional por conta, mas ainda não tem fundação de workspace/membership ou autorização de clínica. Não está pronto para uso multi-tenant nem para dados reais sem os controles e decisões indicados.

## Estado atual

Aplicação JavaScript com Node.js nativo, servidor HTTP próprio e interface estática; API e web são servidas pelo mesmo processo. Dados são mantidos em `data/store.json`; sessões vivem em memória. As rotas profissionais filtram/validam ownership por `userId`. Há cadastro/login, pacientes, avaliações, agenda, metas, planos alimentares versionados e portal do paciente com convite e projeção de planos publicados.

## Principais riscos e bloqueadores

- **P0:** ausência de workspace e membership; isolamento por profissional não satisfaz isolamento entre workspaces.
- **P0:** sessões não têm expiração validada no servidor e não existe revogação por membership.
- **P0:** persistência JSON sem transações/constraints distribuídas, inadequada como fundação de clínica multiusuária.
- **P0 antes de exposição pública:** rate limiting não observado; logging de URL completa pode capturar token colocado em URL.
- **P1:** inexistência de papéis granulares, exceções, equipes e escopo por paciente; teste único não cobre esses cenários.
- Decisões sobre identidade de paciente, propriedade clínica, saída de profissional e mapeamento legado ainda são necessárias antes de schema/importação.

## Partes aproveitáveis

- Regras e endpoints de domínio úteis para uma transição incremental.
- `owned()` e filtros por usuário são controles básicos reais no modelo atual, embora não bastem para multi-tenant.
- Portal usa vínculo explícito com paciente/profissional, filtra publicação e projeta campos selecionados.
- Senhas usam scrypt; cookies HttpOnly/SameSite; convites e resets guardam hash e têm expiração/uso/revogação; auditoria operacional limitada.
- Estrutura de workspace pnpm separa pastas de API e web, mas ainda não separa deploys.

## Ordem recomendada

1. Aprovar decisões de domínio e ameaça: paciente, tenant pessoal, cargos, equipe, revogação, retenção e mapeamento legado.
2. Estabelecer baseline de testes sintéticos e cobertura negativa por rota; corrigir sessão/logging/abuso antes de exposição.
3. Modularizar gradualmente e tornar policy de autorização explícita.
4. Implementar membership, workspace ativo, capacidades e escopos com testes cross-tenant antes de importar dados.
5. Selecionar persistência com base em requisitos aprovados; migrar com backup, dry-run, reconciliação, cutover e rollback ensaiados.
6. Considerar planos/cobrança depois, separados de autorização clínica.

## Próxima ação recomendada

Usar [CONSOLIDATED_ARCHITECTURE_PROPOSAL.md](CONSOLIDATED_ARCHITECTURE_PROPOSAL.md) como proposta para revisão. Aprovar somente as decisões de produto ainda abertas em [MULTITENANT_DECISIONS_REQUIRED.md](MULTITENANT_DECISIONS_REQUIRED.md), sem reabrir workspace individual/clínica, múltiplos proprietários, separação de responsabilidades ou ausência de cobrança obrigatória no MVP. Depois, fechar matriz de capacidades, mapeamento de pacientes e critérios técnicos.

## Limites da auditoria

Inspeção estática de código, manifests, teste e documentação. Nenhum dado de `data/store.json` ou arquivo de log foi lido; nenhum teste foi executado; não houve alteração de aplicação, dependências, banco, branch ou commit. Assim, os fluxos são confirmados por leitura de código e pelo conteúdo do teste, não por execução funcional nesta rodada. A auditoria não é pentest, avaliação legal/LGPD, revisão de infraestrutura/deploy, nem confirmação de consistência dos dados existentes.

## Documentos produzidos

- [Proposta consolidada para aprovação](CONSOLIDATED_ARCHITECTURE_PROPOSAL.md)
- [Baseline de requisitos](PRODUCT_REQUIREMENTS_BASELINE.md)
- [Análise de lacunas e matriz](MULTITENANT_GAP_ANALYSIS.md)
- [Plano progressivo de migração](MULTITENANT_MIGRATION_PLAN.md)
- [Decisões requeridas](MULTITENANT_DECISIONS_REQUIRED.md)
- [Este resumo executivo](MULTITENANT_AUDIT_SUMMARY.md)
