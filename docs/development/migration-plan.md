# Plano de transição do NutriTrack

## Marco 0 — Inventário e workspaces (feito)

- Registrar estado, limites e ausência de Git.
- Mover API e teste para `apps/api`; assets para `apps/web`.
- Introduzir pnpm workspace sem dependências novas.
- Revalidar os fluxos existentes.

## Marco 1 — Modularizar o domínio

1. Extrair cálculo e validação antropométrica para funções puras testadas.
2. Separar casos de uso de paciente, avaliação, agenda e meta das rotas.
3. Centralizar autorização por profissional e testá-la independentemente.
4. Definir DTOs e padrão de erro; testar IDs ausentes e acessos cruzados.
5. Migrar componentes de UI em passos comparáveis, sem reescrever tudo de uma vez.

## Marco 2 — Modelo relacional

1. Validar entidades, vínculo profissional-paciente e cenários de clínica/equipe.
2. Avaliar PostgreSQL/Prisma em ADR próprio.
3. Criar schema/migrações aditivas e seed exclusivamente fictício.
4. Criar importador JSON idempotente e relatório de reconciliação.
5. Preservar backup e store de origem até validação; não removê-lo automaticamente.

## Marco 3 — API estável e web

1. Publicar contrato REST/OpenAPI e autenticação.
2. Separar deploy web e API quando fizer sentido.
3. Comparar NestJS/Next.js com os módulos já separados.
4. Manter testes de contrato/isolamento durante as migrações.

## Marco 4 — Acesso de paciente

1. Definir convite de uso único, validade, verificação, revogação e auditoria.
2. Separar DTO profissional e paciente com whitelist de campos publicados.
3. Implementar versão de plano publicada e histórico imutável.
4. Testar dois profissionais e pacientes, incluindo ID manipulado.
5. Iniciar Expo do paciente somente após os controles server-side.

## Marco 5 — App profissional e operação

Após API e contratos estabilizados, entregar Expo profissional em escopo menor. Definir implantação, backups restaurados em ensaio, observabilidade, resposta a incidentes, privacidade e critérios comerciais.

## Critérios de segurança da migração

- Nenhuma etapa remove dados de origem automaticamente.
- Fazer backup e conciliar registros antes de mudar persistência.
- IDs fornecidos pelo cliente nunca provam autorização.
- Histórico publicado permanece versionado.
- Não usar dados reais em testes, screenshots ou portfólio.
- Cada marco registra verificações e limitações remanescentes.
