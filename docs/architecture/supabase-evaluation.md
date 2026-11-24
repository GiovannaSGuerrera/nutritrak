# Avaliação de migração para Supabase

Consulta realizada em 23/11/2026. Nenhum projeto Supabase foi criado e a conexão de produção continua no Neon.

## Compatibilidade com o NutriTrack

O backend usa Node.js, TypeScript e o driver `pg`, com SQL PostgreSQL, transações, JSONB e chaves estrangeiras. Migrar apenas o banco é viável sem trocar a interface ou o sistema de login. A conta do profissional, hashes de senha, convites e sessões são implementados pelo próprio NutriTrack; copiar essas tabelas não as transforma em usuários do Supabase Auth.

O esforço de migrar somente o banco é menor do que adotar Auth, Storage ou Realtime. Esses serviços exigem integração e testes próprios. RLS baseada em `auth.uid()` não funciona automaticamente com os cookies e os IDs de texto atuais.

## Benefícios possíveis

O Supabase oferece PostgreSQL, painel de tabelas, editor SQL e serviços integrados de autenticação, arquivos e eventos em tempo real. Esses serviços podem ajudar se entrarem no roteiro do produto. O painel SQL, sozinho, não exige migração: o Neon atual também atende à análise das tabelas.

Não há evidência de que apenas trocar o provedor deixará o NutriTrack mais rápido. As otimizações de consultas e a proximidade entre API e banco continuam necessárias. Selecionar São Paulo no Supabase manteria o banco próximo da função Vercel em `gru1`.

## Custo e disponibilidade

Na consulta de preços, o Supabase Free oferece 500 MB de banco e pode pausar o projeto após uma semana de inatividade. Backups automáticos não estão incluídos no Free. O Pro começa em US$ 25 por mês e inclui backups diários com sete dias de retenção, dentro dos limites do plano. Compute adicional, consumo excedente e recursos extras podem aumentar o valor.

O Neon anuncia atualmente plano gratuito com 1 GB por projeto e 100 CU-horas por mês por projeto; a cota efetiva deve ser conferida na conta antes da decisão. Os fornecedores alteram planos: verificar novamente no momento de contratar.

## Cuidados que precisam entrar no ensaio

1. Criar um projeto de testes em São Paulo e conferir a versão de PostgreSQL do destino. O projeto Neon foi criado com PostgreSQL 18; não presumir que um dump dessa versão restaura sem ajustes em uma versão anterior.
2. Manter tabelas clínicas e de autenticação fora do acesso da Data API. Preferir schema privado ou desabilitar a Data API quando não for utilizada; revisar grants e RLS se houver objetos em schemas expostos. A criação por SQL não garante proteção automática.
3. Usar login restrito do banco no backend. Nunca colocar a conexão PostgreSQL ou chave secreta no navegador.
4. Usar conexão adequada ao ambiente: transaction pooler para a função serverless; sessão ou conexão direta compatível com a rede para migração. Validar transações, locks e configuração de TLS sem desabilitar a validação do certificado.
5. Copiar estrutura e dados de forma controlada, recriar apenas os papéis necessários e conferir contagens, relacionamentos, planos publicados e hashes. Migrações e o runtime devem ter permissões separadas.
6. Rodar os testes da API, sessões, recuperação, concorrência e isolamento no destino. Medir cadastro e painel com o mesmo método usado no Neon.
7. Se o ensaio for aprovado, interromper gravações durante a cópia final, mudar a conexão na Vercel e verificar os fluxos. Manter a origem preservada para retorno; se houver novas gravações no destino, retornar exige reconciliar essas alterações.

## Recomendação

Manter o Neon durante os testes atuais. Avaliar o Supabase em projeto separado caso Auth ou armazenamento de arquivos se tornem próximos passos concretos. Se a decisão for migrar, começar pelo banco e manter o login atual; planejar eventual adoção do Supabase Auth em outra etapa.

## Fontes

- [Supabase: preços](https://supabase.com/pricing)
- [Supabase: conectar ao PostgreSQL](https://supabase.com/docs/guides/database/connecting-to-postgres)
- [Supabase: migração de PostgreSQL](https://supabase.com/docs/guides/platform/migrating-to-supabase/postgres)
- [Supabase: proteção da Data API](https://supabase.com/docs/guides/api/securing-your-api)
- [Supabase: regiões](https://supabase.com/docs/guides/platform/regions)
- [Neon: preços](https://neon.com/pricing)
