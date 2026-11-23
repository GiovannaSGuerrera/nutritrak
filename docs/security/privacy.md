# Privacidade e atendimento aos usuários

Status: rascunho operacional. Não publicar como política final nem declarar conformidade antes das definições abaixo. O usuário autorizou organizar o processo, mas ainda não definiu pessoa jurídica ou contato dedicado.

## Responsabilidade

Responsável legal: pendente de confirmação. O nutricionista e o fornecedor do sistema devem definir seus papéis conforme as decisões que cada um toma sobre os dados. Contato de privacidade: criar caixa dedicada sob controle do responsável e testar recebimento antes de informar o endereço aos pacientes. Até isso acontecer, manter a demonstração com dados fictícios.

## Inventário inicial

| Dados                                                | Uso                                 | Acesso previsto                                                     |
| ---------------------------------------------------- | ----------------------------------- | ------------------------------------------------------------------- |
| Nome, e-mail e hash de senha do profissional         | Conta e autenticação                | Titular e operação técnica autorizada                               |
| Cadastro e contato do paciente, observações clínicas | Acompanhamento nutricional          | Profissional responsável                                            |
| Medidas, avaliações, metas e agenda                  | Histórico e planejamento            | Profissional responsável                                            |
| Planos alimentares e versões publicadas              | Orientações ao paciente             | Profissional; paciente acessa somente sua publicação                |
| Conta do portal, hashes de tokens e sessões          | Convite, recuperação e autenticação | Processamento pela aplicação                                        |
| Eventos de auditoria e logs operacionais             | Investigação e manutenção           | Equipe técnica autorizada; painel do profissional no próprio escopo |
| Cópias de recuperação                                | Recuperação após falha              | Operação autorizada, com chave separada                             |

Fornecedores atuais: Vercel para aplicação e Neon para banco. O projeto Neon foi criado em São Paulo; revisar contratos, subprocessadores e eventual transferência internacional, inclusive logs e suporte. A região do banco não comprova que todo tratamento ocorre no Brasil.

Dados de saúde são sensíveis. Definir e documentar a hipótese legal aplicável ao serviço antes do uso real, com revisão jurídica; não assumir que um checkbox resolve o tratamento.

## Coleta e retenção

Coletar somente campos necessários ao atendimento; evitar documentos e dados adicionais em observações livres. Prazo de retenção de prontuário depende das obrigações aplicáveis ao profissional e ainda precisa ser definido. Arquivar um paciente não apaga seus dados. Não automatizar exclusão de histórico clínico antes dessa definição.

Sessões PostgreSQL expiram após oito horas; a expiração impede acesso, mas não equivale à remoção imediata da linha. Contadores de tentativas vencidos são removidos durante novas tentativas. Convites, redefinições, snapshots legados e backups precisam entrar na política de retenção. A proposta de 30 dias de backup está sujeita a aprovação, não está em operação.

## Pedidos dos titulares

1. Receber o pedido no contato oficial e registrar protocolo, data, categoria e responsável, sem copiar prontuário para chamados públicos.
2. Confirmar a identidade de forma proporcional e identificar o profissional responsável. Nunca entregar dados apenas porque alguém conhece um nome ou e-mail.
3. Levantar dados ativos, versões e cópias, avaliar acesso, correção, portabilidade ou exclusão e eventuais obrigações de conservação. Registrar a decisão e o prazo legal aplicável.
4. Entregar a resposta por canal privado seguro, com acesso restrito. A API ainda não possui exportação ou exclusão completa para esse processo; a implementação deverá respeitar relacionamentos, auditoria e backups.

## Incidentes

Conter o acesso indevido, preservar evidências com acesso restrito, anotar início e conhecimento, identificar dados e usuários afetados e revogar credenciais comprometidas. Acionar o responsável pelo tratamento e avaliar risco ou dano relevante. A regra geral de comunicação à ANPD e titulares é de três dias úteis, sujeita às regras e exceções aplicáveis; não presumir enquadramento em prazo diferenciado. Registrar a avaliação e as medidas mesmo quando não houver comunicação obrigatória. O aplicativo não envia notificações legais automaticamente.

Referências: [ANPD, perguntas frequentes](https://www.gov.br/anpd/pt-br/acesso-a-informacao/perguntas-frequentes), [ANPD, comunicação de incidentes](https://www.gov.br/anpd/pt-br/canais_atendimento/agente-de-tratamento/comunicado-de-incidente-de-seguranca-cis).
