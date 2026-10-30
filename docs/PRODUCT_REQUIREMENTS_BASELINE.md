# Baseline de requisitos de produto — SaaS multi-tenant

Data da consolidação: 2026-10-29. Fonte: missão de auditoria fornecida pelo usuário. Este documento consolida requisitos aprovados e derivações necessárias para avaliá-los; não aprova tecnologia, schema ou decisões pendentes.

## Decisões aprovadas

- O NutriTrack atenderá nutricionistas individuais e clínicas. Um workspace poderá representar um consultório individual ou uma clínica; poderá ter múltiplos proprietários, além de gestores administrativos e responsáveis clínicos. A arquitetura suportará vários workspaces.
- Cada pessoa terá identidade profissional única e poderá participar de vários workspaces, com funções e permissões distintas em cada um. A troca de workspace mudará o contexto de autorização aplicado no backend.
- Dados de um workspace não serão acessíveis automaticamente por outro. Identidade compartilhada de paciente não significa prontuário compartilhado; vínculos entre paciente e contextos serão explícitos.
- Propriedade, gestão administrativa e responsabilidade clínica serão conceitos distintos. A propriedade não concede acesso clínico irrestrito. Organizações poderão ter vários proprietários e delegar funções autorizadas.
- Haverá cargos predefinidos configuráveis, cargos personalizados, exceções individuais e escopo por organização, equipe e paciente. Os cargos citados na missão são exemplos, não uma lista fechada.
- Permissões serão granulares. Cadastro administrativo de paciente não concede acesso automático ao prontuário; acesso clínico respeita escopo e atribuições.
- O modelo de responsabilidade por paciente será configurável: nutricionista principal, apoio, equipe e permissões específicas. Fluxos de trabalho poderão variar por organização.
- Ao remover alguém de uma organização, revogam-se o membership e acesso daquele workspace; a identidade global e outros workspaces permanecem ativos. Registros clínicos são preservados segundo políticas aplicáveis. Não há transferência automática de pacientes/prontuários.
- A arquitetura comercial deverá admitir planos individuais e para clínicas, limites de uso/profissionais, recursos por plano e cobrança configurável. Cobrança não é necessária no MVP e está fora desta auditoria.

## Requisitos derivados diretamente

- Toda operação protegida identifica uma pessoa e um workspace ativo e valida sua participação vigente e autorização no servidor.
- A autorização deve validar tenant, recurso, equipe/paciente quando aplicável e ação; IDs fornecidos pelo cliente não são prova de acesso.
- Entidades clínicas devem pertencer a um workspace ou ter relação explícita e verificável com ele. A identidade global e o cadastro de paciente não devem fundir automaticamente históricos clínicos.
- A remoção de membership deve ser eficaz para requisições subsequentes e tratar sessões, tokens, caches e operações em andamento conforme política de revogação definida.
- A trilha de auditoria precisa permitir comprovar mudanças relevantes de membership, papel, exceção e acesso sem copiar conteúdo clínico desnecessário.
- Modelo de permissões deve permitir separar leitura administrativa de cadastro, leitura clínica e escrita clínica, além dos escopos organizacional, de equipe e de paciente.
- Migração de dados existentes requer mapeamento explícito do proprietário atual para workspaces e preservação verificável de relações e histórico, sem atribuições ou uniões automáticas ambíguas.
- Testes de autorização devem cobrir principals, workspaces, papéis, exceções, escopos e revogação em leituras e escritas.
- O desenho deve deixar pontos de extensão para entitlements/limites comerciais sem transformar plano comercial em autorização clínica.

## Questões ainda pendentes

Ver [MULTITENANT_DECISIONS_REQUIRED.md](MULTITENANT_DECISIONS_REQUIRED.md). Permanecem abertas regras de onboarding/provisionamento, identidade e portal da paciente, catálogo e governança de permissões, fluxo de atribuições e saída, mapeamento de dados existentes, retenção/exclusão, métricas comerciais, tecnologia e requisitos operacionais. Essas questões não reabrem os tipos de workspace nem a separação de responsabilidades definidos acima.

## Limites

Não foram inferidas decisões sobre ORM, banco, RLS, framework, provedores de autenticação/cobrança, retenção, transferências de pacientes ou nomes finais de cargos.
