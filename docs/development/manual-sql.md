# Manual de SQL do NutriTrack

Este guia serve para explorar o banco do projeto e aprender SQL com exemplos reais. Use os dados fictícios do ambiente de testes. As consultas de leitura também funcionam em outro PostgreSQL, incluindo Supabase, depois de migrar o mesmo schema.

## 1. Onde executar

No Neon, abra NutriTrack, selecione a branch `production`, o banco `neondb` e entre em **SQL Editor**. Em **Tables**, escolha o schema `public` para navegar pelas tabelas.

Selecione a consulta que deseja executar. Um ponto e vírgula encerra cada comando. Linhas iniciadas por `--` são comentários.

Para começar uma sessão de análise protegida contra alterações:

```sql
BEGIN READ ONLY;
SELECT current_database() AS banco, current_schema() AS schema;
ROLLBACK;
```

Execute o bloco completo. `ROLLBACK` encerra a transação. Dentro dela, o PostgreSQL recusa gravações em tabelas permanentes. Isso não impede visualizar informações sensíveis: confira as colunas antes de copiar resultados.

## 2. Como o banco está organizado

| Tabela                    | O que guarda                                           |
| ------------------------- | ------------------------------------------------------ |
| `professionals`           | Conta dos nutricionistas                               |
| `patients`                | Cadastro e histórico clínico do paciente               |
| `assessments`             | Medidas, avaliações e cálculos                         |
| `appointments`            | Consultas e horários                                   |
| `goals`                   | Metas e registros de progresso                         |
| `meal_plans`              | Identificação do plano e referência à versão publicada |
| `meal_plan_versions`      | Rascunhos e versões publicadas, com refeições          |
| `patient_accounts`        | Contas de acesso ao portal                             |
| `patient_invitations`     | Convites, validade, uso e revogação                    |
| `patient_password_resets` | Solicitações de redefinição de senha                   |
| `audit_events`            | Ações registradas pelo sistema                         |
| `auth_sessions`           | Sessões e expiração                                    |
| `auth_rate_limits`        | Contadores de tentativas de autenticação               |
| `storage_migrations`      | Controle de migração, revisão e snapshot legado        |

`id` identifica um registro. `"userId"` liga os registros ao profissional; nas tabelas do portal, essa ligação se chama `"professionalId"`. `"patientId"` identifica o paciente e `"planId"`, o plano.

As colunas com letras maiúsculas precisam de aspas duplas: `"patientId"`. Textos usam aspas simples: `'Ativo'`. Escrever `'patientId'` devolve um texto constante, não o valor da coluna.

O cadastro de um paciente pertence a um profissional. Um paciente pode ter várias avaliações, consultas, metas e planos. Cada plano pode ter várias versões.

## 3. Descobrir tabelas, colunas e índices

```sql
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
ORDER BY table_name;
```

```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'patients'
ORDER BY ordinal_position;
```

```sql
SELECT tablename, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;
```

## 4. Consultar pacientes

`SELECT` escolhe as colunas, `FROM` escolhe a tabela, `WHERE` filtra, `ORDER BY` ordena e `LIMIT` limita o resultado.

```sql
SELECT id, name, status, "createdAt"
FROM public.patients
ORDER BY "createdAt" DESC NULLS LAST, id
LIMIT 20;
```

Para ver somente os pacientes de um profissional, substitua o texto de exemplo pelo ID correto:

```sql
SELECT id, name, status
FROM public.patients
WHERE "userId" = 'ID_DO_PROFISSIONAL'
ORDER BY name, id
LIMIT 50;
```

Busca por parte do nome, sem diferenciar maiúsculas e minúsculas:

```sql
SELECT id, name, status
FROM public.patients
WHERE "userId" = 'ID_DO_PROFISSIONAL'
  AND name ILIKE '%ana%'
ORDER BY name, id
LIMIT 20;
```

O filtro por profissional deve acompanhar as consultas de acompanhamento. Um administrador com acesso SQL pode consultar várias contas; o filtro deste guia não cria uma regra de segurança no banco. O backend atual verifica o acesso na API.

## 5. Contar e agrupar

```sql
SELECT 'Profissionais' AS tabela, count(*) AS total FROM public.professionals
UNION ALL
SELECT 'Pacientes', count(*) FROM public.patients
UNION ALL
SELECT 'Avaliações', count(*) FROM public.assessments
UNION ALL
SELECT 'Planos', count(*) FROM public.meal_plans;
```

Esses totais são globais, destinados à administração do ambiente de testes.

```sql
SELECT status, count(*) AS total
FROM public.patients
WHERE "userId" = 'ID_DO_PROFISSIONAL'
GROUP BY status
ORDER BY total DESC;
```

`count(*)` conta linhas. `count(email)` conta apenas as linhas em que o e-mail não é `NULL`; um texto vazio ainda é contado.

## 6. Relacionar paciente e profissional

`JOIN` combina registros de tabelas relacionadas. O exemplo usa nomes curtos, como `p`, para facilitar a leitura:

```sql
SELECT p.id, p.name AS paciente, pro.name AS profissional
FROM public.patients p
JOIN public.professionals pro ON pro.id = p."userId"
WHERE pro.id = 'ID_DO_PROFISSIONAL'
ORDER BY p.name, p.id
LIMIT 50;
```

## 7. Ver as avaliações de um paciente

```sql
SELECT a.date, p.name AS paciente, a.weight, a.height, a.bmi, a.method
FROM public.assessments a
JOIN public.patients p ON p.id = a."patientId" AND p."userId" = a."userId"
WHERE a."userId" = 'ID_DO_PROFISSIONAL'
  AND a."patientId" = 'ID_DO_PACIENTE'
ORDER BY a.date DESC NULLS LAST, a."createdAt" DESC NULLS LAST, a.id
LIMIT 20;
```

`NULL` representa ausência de valor. Use `IS NULL` ou `IS NOT NULL`, nunca `= NULL`. Uma medida ausente não deve ser tratada como zero.

## 8. Consultar a agenda

```sql
SELECT a.id, p.name AS paciente, a.start, a."end", a.status, a.type
FROM public.appointments a
JOIN public.patients p ON p.id = a."patientId" AND p."userId" = a."userId"
WHERE a."userId" = 'ID_DO_PROFISSIONAL'
  AND a.status = 'agendada'
ORDER BY a.start, a.id
LIMIT 30;
```

Essa consulta inclui consultas antigas que continuam marcadas como agendadas. Para encontrar horários futuros:

```sql
SELECT id, "patientId", start, status
FROM public.appointments
WHERE "userId" = 'ID_DO_PROFISSIONAL'
  AND status = 'agendada'
  AND NULLIF(start, '')::timestamptz >= now()
ORDER BY NULLIF(start, '')::timestamptz, id
LIMIT 30;
```

Nesta versão, muitas datas ainda são armazenadas como `text`. A conversão `::timestamptz` funciona com datas válidas; um texto inválido provoca erro. `NULLIF` trata textos vazios. Datas antigas importadas precisam ser verificadas antes de aplicar conversões em relatórios. `expires_at` das sessões já é um timestamp com fuso.

## 9. Ver planos publicados

```sql
SELECT mp.id, mp.name AS plano, p.name AS paciente,
       v.number AS versao, v."publishedAt"
FROM public.meal_plans mp
JOIN public.patients p ON p.id = mp."patientId" AND p."userId" = mp."userId"
JOIN public.meal_plan_versions v
  ON v.id = mp."publishedVersionId" AND v."planId" = mp.id
WHERE mp."userId" = 'ID_DO_PROFISSIONAL' AND v.status = 'published'
ORDER BY v."publishedAt" DESC NULLS LAST, mp.id
LIMIT 20;
```

Para conferir o histórico de um plano:

```sql
SELECT v.id, v.number, v.status, v."createdAt", v."publishedAt"
FROM public.meal_plan_versions v
JOIN public.meal_plans mp ON mp.id = v."planId"
WHERE mp."userId" = 'ID_DO_PROFISSIONAL' AND mp.id = 'ID_DO_PLANO'
ORDER BY v.number;
```

## 10. Ler refeições em JSONB

As refeições ficam em um campo JSONB dentro da versão. `->` mantém o formato JSON; `->>` extrai texto. `jsonb_array_elements` transforma um array em linhas:

```sql
SELECT mp.name AS plano, v.number AS versao,
       refeicao.value ->> 'name' AS refeicao,
       refeicao.value ->> 'time' AS horario
FROM public.meal_plans mp
JOIN public.meal_plan_versions v ON v."planId" = mp.id
CROSS JOIN LATERAL jsonb_array_elements(COALESCE(v.meals, '[]'::jsonb)) AS refeicao(value)
WHERE mp."userId" = 'ID_DO_PROFISSIONAL' AND mp.id = 'ID_DO_PLANO'
ORDER BY v.number
LIMIT 100;
```

O exemplo pressupõe que `meals` contém um array, como nos planos criados pela aplicação. Dados legados fora desse formato precisam ser tratados antes.

## 11. Conferir acessos sem expor segredos

```sql
SELECT professional_id, patient_account_id, expires_at,
       expires_at > now() AS ainda_valida
FROM public.auth_sessions
ORDER BY expires_at DESC
LIMIT 20;
```

Isso confere apenas a expiração. A API também valida a conta e a credencial vinculadas à sessão; `ainda_valida` não comprova sozinho que o acesso será aceito.

```sql
SELECT action, type, "recordId", at
FROM public.audit_events
WHERE "userId" = 'ID_DO_PROFISSIONAL'
ORDER BY at DESC NULLS LAST, id
LIMIT 30;
```

Evite `SELECT *` em tabelas de autenticação. Não compartilhe `hash`, `salt`, `tokenHash`, `token_hash`, `credential_hash`, `legacy_snapshot`, cookies ou URLs de conexão. O snapshot legado pode conter uma cópia completa de dados pessoais.

## 12. Entender alterações e transações

`INSERT` cria linhas; `UPDATE` altera; `DELETE` remove; `CREATE` cria estruturas; `DROP` remove estruturas. Para treinar, o bloco abaixo cria uma tabela temporária e desfaz todas as ações. Execute somente em um ambiente de aprendizado separado e rode o bloco completo:

```sql
BEGIN;
CREATE TEMP TABLE treino_sql (id integer PRIMARY KEY, nome text, status text);
INSERT INTO treino_sql VALUES (1, 'Paciente fictício', 'Ativo');
UPDATE treino_sql SET status = 'Em pausa' WHERE id = 1;
SELECT id, nome, status FROM treino_sql;
DELETE FROM treino_sql WHERE id = 1;
SELECT count(*) AS restantes FROM treino_sql;
ROLLBACK;
```

`BEGIN` inicia uma transação. `ROLLBACK` desfaz; `COMMIT` confirma. Uma gravação sem `WHERE` pode alterar todas as linhas da tabela.

No NutriTrack, altere cadastros pelo aplicativo. A persistência também usa `record_keys`, `extras`, `position` e a revisão em `storage_migrations`. Uma alteração SQL direta pode ignorar validações, auditoria, cálculos e esse controle de concorrência. Não atualize tabelas do aplicativo seguindo o exemplo de treino.

## 13. Problemas comuns

| Mensagem ou sintoma              | O que conferir                                                        |
| -------------------------------- | --------------------------------------------------------------------- |
| `relation does not exist`        | Banco, schema e nome da tabela                                        |
| `column does not exist`          | Aspas duplas nas colunas como `"userId"`                              |
| Nenhuma linha retornada          | ID de exemplo ainda não substituído ou filtro sem registros           |
| `permission denied`              | Permissão da conta usada; não ampliar acesso só para contornar o erro |
| Erro ao converter uma data       | Texto vazio ou formato inválido no dado legado                        |
| `foreign key violation`          | Referência a registro inexistente ou de outro profissional            |
| `current transaction is aborted` | Execute `ROLLBACK` antes de começar outra transação                   |

## 14. Levar consultas para o código

No backend, use parâmetros para valores vindos do usuário:

```js
const result = await pool.query('SELECT id, name FROM patients WHERE "userId" = $1 AND id = $2', [
  professionalId,
  patientId,
]);
```

Não monte SQL concatenando texto digitado por alguém. `$1` e `$2` são parâmetros do driver `pg`; para executar o exemplo no editor SQL, use valores literais como nos blocos anteriores.

Os nomes deste manual foram conferidos em `apps/api/src/relational-schema.ts`. Ao mudar o schema, revise os exemplos. Para backup e permissões, consulte o [guia de operação](../security/operations.md).
