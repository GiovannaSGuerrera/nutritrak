# Portal do paciente — primeiro marco

## Áreas separadas e sincronização

- O profissional usa `/` e autenticação `nc_session`.
- O paciente usa `/paciente` e autenticação independente `nt_patient_session`.
- Os dois perfis leem o mesmo armazenamento local. O portal consulta os planos no servidor a cada entrada ou atualização da página; uma publicação nova fica disponível após atualizar.
- O convite abre `/paciente/ativar#<token>`. O token tem 256 bits, o servidor persiste somente seu SHA-256, ele expira em sete dias e só pode ser consumido uma vez. O link é exibido para compartilhamento manual e não é enviado automaticamente.
- No cadastro da paciente, o profissional pode gerar um link de redefinição em `/paciente/redefinir#<token>`. O token tem 256 bits, somente seu SHA-256 é persistido, expira em 24 horas e só pode ser usado uma vez. Ao concluir a redefinição, as sessões anteriores da paciente são encerradas. O profissional compartilha o link manualmente.
- Um e-mail válido precisa estar cadastrado pelo profissional antes de gerar o convite; na ativação, o paciente precisa informar esse mesmo e-mail.

## Limite dos dados visíveis ao paciente

`safePatientPortal` monta explicitamente a resposta do portal. Ela inclui somente nome do paciente, nome do profissional e snapshots com `publishedVersionId` cujo status é `published`: nome, versão, objetivo, vigência, orientações, refeições, alimentos, quantidades, unidades e substituições. Rascunhos, histórico clínico, avaliações, agenda, notas profissionais e outras metas não fazem parte da resposta.

O ID da conta do paciente é independente da conta profissional, embora esteja vinculado a um único cadastro e profissional. As rotas do portal nunca usam o cookie profissional; as rotas profissionais continuam exigindo `nc_session` e validando a propriedade dos registros.

## Persistência e limitações do MVP

O convite consumido, a conta do paciente e os registros de redefinição ficam no `store.json`; senhas são derivadas com scrypt e os hashes dos tokens são salvos em vez dos segredos. As sessões são mantidas em memória e serão encerradas quando o servidor reiniciar. O MVP não envia e-mail automaticamente, não limita tentativas de login nem notifica o paciente quando uma nova versão é publicada; a sincronização acontece ao entrar ou atualizar o portal. A redefinição de senha é iniciada pelo profissional e usa um link manual de uso único.
