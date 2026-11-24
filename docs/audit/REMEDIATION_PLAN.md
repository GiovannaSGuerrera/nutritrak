# Plano de ação priorizado

24/11/2026. Plano sem implementação. Estimativas são dias-pessoa técnicos para profissional familiarizado com o projeto, não produtividade medida ou compromisso de calendário. Dependências, espera jurídica/provedor e decisões podem ampliar prazo. Itens compartilham trabalho: **não somar cegamente**.

## P0 — Bloqueadores de lançamento

| Atividade / achados | Dependências | Esforço | Critério de aceitação e teste obrigatório |
|---|---|---:|---|
| P0-01 Fixar backend único e oferta individual, manter clínica fora do escopo inicial | Decisão de produto/arquitetura | 0,5–1d | Entry points/deploy/feature flags explícitos; backend excluído inacessível; contrato de rotas da UI aprovado |
| P0-02 Eliminar exposição administrativa e corrigir status/revogação Python — AUD-001/006 | P0-01 se P escolhido | 1–3d | Nenhum campo clínico em DTO admin; arquivar pela UI bloqueia cookie antigo e login; testes por quatro papéis |
| P0-03 Garantir unicidade e reset atômicos Node — AUD-002/003 | P0-01; persistência transacional P0-04 para solução durável | 2–4d além da migração | Cadastro concorrente cria só uma conta; token conclui uma vez; senha/revogação no mesmo commit; barreiras concorrentes |
| P0-04 Persistência de produção e sessões duráveis, migração/importação/contratos — AUD-004/014/017 | P0-01; schema/contrato decidido | 10–18d, sobrepõe P1-03/05 | Backend único sem snapshot global inseguro; DDL congelado/revisões explícitas; fresh/upgrade equivalentes; importação sintética com IDs/FKs/hash reconciliados; rollback/restore |
| P0-05 Mutação válida/sem efeitos ao falhar — AUD-005 | P0-01; N se mantido | 0,5–1d | PATCH 400 deixa objeto/disco intactos; testar payload misto e gravação posterior |
| P0-06 Staging e continuidade comprovada — AUD-009 | P0-01/04; acesso ao provedor no momento da execução autorizada | 5–8d | TLS, domínio, secrets, usuário mínimo, backup criptografado, restore isolado no RTO, RPO medido, rollback e alerta de falha executados |
| P0-07 Ciclo de privacidade antes de dados clínicos — AUD-010 | Responsável jurídico/produto; P0-04 | 4–8d técnicos + espera externa | Papéis/bases/prazos aprovados; políticas/termos; exportação, retenção/exclusão e trilha tenant-scoped; teste de solicitação/restore |
| P0-08 Pipeline/gate de regressão — AUD-020 | P0-01; PostgreSQL descartável/ambiente CI | 3–5d | Node/Python aplicáveis, migrations, contratos e negativos por tenant/papel obrigatórios; execução em ambiente limpo e falha controlada do gate |

P0-02 e P0-03 são condicionais ao backend. Escolher Python não dispensa reparar seus contratos e provar migração; escolher Node não dispensa persistência e garantias operacionais. Não é necessário sustentar duas APIs de produção para lançar.

## P1 — Necessário antes do lançamento comercial

| Atividade / achados | Dependências | Esforço | Critério de aceitação e teste obrigatório |
|---|---|---:|---|
| P1-01 Recuperação/verificação profissional, mudança de senha e revogação global — AUD-007 | P0-04 e canal de entrega escolhido | 4–7d | Endereço verificado; recuperação não enumera; tokens atômicos/expiram; revogação após restart; MFA clínico/admin conforme gate aprovado |
| P1-02 Limites de abuso, quotas e origem/CSRF — AUD-008/016 | P0-06; proxy/domínios definidos | 2–4d | Limiter compartilhado atômico por conta/IP/fluxo, TTL, Retry-After, limite de corpo/tempo; browser same-site/cross-site e spoof de IP |
| P1-03 Contratos de validação/DTOs e erros Python — AUD-022/014 | P0-01/04 | 2–4d | Payloads reais UI preservados; UUID ausente/inválido retorna 4xx; extras não persistem; error/detail unificado; sem 500 controlável por formato |
| P1-04 Integridade de plano/agenda/concorrência — AUD-011/012/023 | P0-04/08 | 3–5d | Todos os alimentos completos antes de publicar; versões imutáveis; lost update detectado; reset uma vez; reativação conflitante 409; duas conexões reais |
| P1-05 Fechar migração e campos funcionais individuais — AUD-014 | P0-01/04 | 3–6d, parcialmente em P0-04 | Dashboard não apresenta mocks como fatos; categoria/prazo de meta preservados; onboarding e portal funcionam ponta a ponta; importador reconcilia hashes/IDs sem dados reais em logs |
| P1-06 Dependências/imagem reproduzíveis — AUD-015 | Backend/imagem finais e CI | 1–3d | pytest corrigido (OSV indica >=9.0.3, validar salto major), fora do runtime; lock com hashes/SBOM; audit transitivo e imagem; zero advisory bloqueador aplicável sem mitigação aceita |
| P1-07 Piloto fechado monitorado e revisão independente | Todos os P0 e P1 aplicáveis | 3–5d de preparação técnica + observação | Casos sintéticos aprovados, usuários restritos, monitor/alertas/suporte/rollback prontos, SLO e limites de carga definidos; nova avaliação documentada |

Sem PostgreSQL/testes atuais não se declara P1-04 concluído por leitura de código. Vulnerabilidade local pytest não é tratada como RCE HTTP; retirar ferramenta da imagem reduz superfície, mas ferramenta de testes também precisa correção.

## P2 — Curto prazo

| Atividade / achados | Dependências | Esforço | Aceitação e testes |
|---|---|---:|---|
| Paginação/agregação de metas/filtros SQL — AUD-013 | P0-04, contratos paginados | 3–5d | Queries por tela limitadas, cursors tenant-scoped e dataset representativo; EXPLAIN e p95/erro medidos |
| Acessibilidade, CSP e estados de formulário — AUD-018/019 | Backend/web finais | 2–4d | Labels/nome acessível/foco, estilos sem violações CSP, duplo envio controlado, falha de rede útil; browser desktop/mobile e leitor de tela |
| Modularização/formato/lint incremental — AUD-021 | Regras/contratos estabilizados | 3–6d | Domínio/DTOs testáveis, check sem escrita passando, lint semântico; regressões antes/depois |
| Retenção operacional de sessões/tokens/hits/auditoria | Política P0-07, banco alvo | 1–3d | TTL/expurgo sem afetar tokens válidos; auditoria com retenção aprovada e logs sem PII; job e restore testados |
| Orçamento de performance e custo | Ambiente staging + paginação | 2–4d | Degraus de carga separados de total de cadastrados, limites de parada, custo/latência e plano de capacidade documentados |

P2 é prioridade de execução geral: se escala/acessibilidade forem parte explícita do contrato de piloto, seus critérios passam a gate anterior ao lançamento desse escopo.

## P3 — Médio e longo prazo

| Atividade | Dependências | Esforço indicativo | Aceitação |
|---|---|---:|---|
| Clínica/equipe completa no backend único | Escopo individual estável, matriz de capacidades e prestador explícito | 8–15d | Convites/membros/assignment/agenda/relatórios com negativos intra/inter-tenant e revogação concorrente |
| Monetização automática | Modelo comercial/gateway/entitlements aprovados | 8–15d | Webhook assinado, idempotência, preço server-side, trial/cancelamento/renovação e reconciliação testados |
| RLS/defesa de banco e escala adicional | Papéis SQL e contratos de tenant aprovados | 3–8d | Testes com papel de runtime, migrations e consultas sem vazamento; decisão baseada em risco |
| Notificações/e-mail/relatórios e tarefas assíncronas | Política de terceiros/retensão e quotas | 5–10d por recorte | Isolamento, retries/idempotência, consentimento/base aplicável, observabilidade e controle de custo |
| Recuperação e resiliência ampliadas | SLO/RPO/RTO medidos | 3–8d | Exercícios periódicos, dependências indisponíveis e evidência de recuperação revisada |

Essas funcionalidades não são pré-requisito universal do escopo individual; não devem ser prometidas como existentes. Load test não prova capacidade para qualquer histórico ou perfil de tráfego.

## Sequência mínima e esforço consolidado

1. Escolher um único backend e escopo individual; preparar banco/contratos e regressões.
2. Corrigir confidencialidade, revogação, identidade, reset e atomicidade aplicáveis.
3. Concluir persistência/importação/DDL e campos funcionais; remover exposição do backend alternativo.
4. Staging com CI, TLS, backups/restore, alertas e limites; resolver privacidade e recuperação profissional.
5. Piloto fechado monitorado, teste browser/carga do escopo e nova revisão de segurança antes da oferta pública/comercial.

Faixa consolidada: **30–50 dias-pessoa técnicos para o escopo individual**, com trabalho compartilhado entre linhas. Espera externa, qualidade dos dados a migrar, implantação e escopo escolhido podem alterar a faixa. Duas pessoas não reduzem automaticamente o calendário pela metade devido às dependências. Nenhuma implementação, migração real ou publicação está autorizada por este plano; aguardam etapa de aprovação do usuário.
