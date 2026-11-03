# Runbook — migrations da Fase 3 no Supabase

## Escopo e limite de autorização

Este roteiro prepara uma operação futura para as migrations `0003`, `0004` e
`0005`. Ele **não autoriza** conexão, SQL, backup, migration, deploy ou mudança
de configuração no Supabase. O banco principal foi confirmado anteriormente
somente com os hashes de `0000`–`0002`; a presença de tabelas não prova o
registro no ledger e deve ser confirmada de novo na janela autorizada.

Nunca use o bootstrap em banco existente, nunca insira linhas manualmente em
`drizzle.__drizzle_migrations`, e nunca use a URL runtime (`fhdod_api`) para
migrations. Não grave URLs, dumps ou credenciais neste repositório.

## Estado local validado

O journal local contém, nesta ordem, `0000`, `0001`, `0002`, `0003`, `0004` e
`0005`. O único SQL fora do journal é o órfão histórico documentado
`0001_shift_sheet_versions.sql`, que não deve ser aplicado nem adicionado ao
journal. O migrador oficial é `npm run migrate`; ele compara hashes e
timestamps do ledger após a execução.

| Migration | Efeito principal | Risco operacional |
| --- | --- | --- |
| `0003_make_global_nps_dynamic` | Fecha associações ativas materializadas de NPS global; overrides específicos permanecem ativos. | A mudança é de dados históricos; validar associações antes da janela. |
| `0004_reconcile_runtime_rls_phase3` | Habilita RLS nas 30 tabelas e cria policies necessárias ao runtime `fhdod_api`. | Policies permissivas não implementam isolamento por setor; a autorização continua no Express. |
| `0005_opposite_romulus` | Copia código/nome de `employees` para atribuições, torna `employee_id` opcional e recria índices. | Pode bloquear em DDL; falha se legado não tiver funcionário/código/nome válido ou houver colisão normalizada. |

Em PostgreSQL descartável, `0005` foi validada para upgrade de ledger
`0000`–`0002`, segunda execução idempotente e falha atômica diante de dado
histórico inválido. Isso não substitui as pré-verificações produtivas.

## Fase 1 — pré-verificação somente leitura

**PRODUÇÃO — NÃO EXECUTAR SEM AUTORIZAÇÃO.** Execute estas consultas somente
com conexão administrativa aprovada, no projeto confirmado pelo responsável.

```sql
-- Ledger: hashes e ordem devem ser comparados ao journal local.
select id, hash, created_at
from drizzle.__drizzle_migrations
order by created_at, id;

-- Schema de atribuições esperado antes de 0005.
select column_name, data_type, is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'employee_shift_assignments'
order by ordinal_position;

-- Pré-condição exata de 0005: FK ausente ou código/nome inválido bloqueia.
select a.id, a.employee_id, e.employee_code, e.full_name
from public.employee_shift_assignments a
left join public.employees e on e.id = a.employee_id
where e.id is null
   or btrim(e.employee_code) = ''
   or btrim(e.full_name) = '';

-- Colisões que surgiriam nos índices de 0005, com a mesma normalização SQL.
select a.shift_range_id, lower(btrim(e.employee_code)) as employee_code,
       lower(btrim(e.full_name)) as employee_name, a.work_date, count(*)
from public.employee_shift_assignments a
join public.employees e on e.id = a.employee_id
where a.work_date is not null
group by a.shift_range_id, lower(btrim(e.employee_code)),
         lower(btrim(e.full_name)), a.work_date
having count(*) > 1;

select a.shift_range_id, lower(btrim(e.employee_code)) as employee_code,
       lower(btrim(e.full_name)) as employee_name, a.day_of_week, count(*)
from public.employee_shift_assignments a
join public.employees e on e.id = a.employee_id
where a.day_of_week is not null
group by a.shift_range_id, lower(btrim(e.employee_code)),
         lower(btrim(e.full_name)), a.day_of_week
having count(*) > 1;

-- Dados que 0003 pode encerrar como histórico materializado.
select a.id, a.sector_id, a.question_id, a.assigned_at
from public.sector_nps_assignments a
join public.questions q on q.id = a.question_id
where a.ended_at is null
  and a.assignment_source = 'global'
  and q.is_nps = true
  and q.scope = 'all_sectors';

-- RLS, policies, grants e atributos relevantes da role runtime.
select c.relname, c.relrowsecurity, c.relforcerowsecurity
from pg_class c
where c.relnamespace = 'public'::regnamespace and c.relkind = 'r'
order by c.relname;

select schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
from pg_policies
where schemaname = 'public'
order by tablename, policyname;

select rolname, rolbypassrls, rolsuper, rolcreaterole, rolcreatedb
from pg_roles
where rolname = 'fhdod_api';

select table_name, privilege_type
from information_schema.role_table_grants
where grantee = 'fhdod_api' and table_schema = 'public'
order by table_name, privilege_type;
```

Bloqueie a operação se o ledger não for exatamente reconciliável com os hashes
locais, se qualquer consulta de `0005` retornar linha, se existirem policies
homônimas inesperadas para `0004`, se o backup não for verificável, ou se a
Data API não puder ser confirmada como fora da arquitetura administrativa.

## Fase 2 — backup e janela

**PRODUÇÃO — NÃO EXECUTAR SEM AUTORIZAÇÃO.** Antes da aplicação, o responsável
deve confirmar projeto/ambiente, autorização, horário, armazenamento protegido,
backup recente e procedimento de restauração testável. Backups podem conter
dados hospitalares: mantenha-os cifrados, com acesso mínimo, sem enviá-los a
serviços externos ou ao repositório.

Registre: operador, data/hora, projeto, hashes do ledger anterior, resultado das
pré-verificações, localização protegida do backup e decisão de compatibilidade
do backend. Prepare comunicação para indisponibilidade e impeça escritas se a
janela exigir consistência operacional.

## Fase 3 — aplicação controlada futura

**PRODUÇÃO — NÃO EXECUTAR SEM AUTORIZAÇÃO.** Somente após todas as condições
anteriores, forneça ao ambiente administrativo uma `DATABASE_URL_MIGRATIONS`
efêmera e execute o migrador oficial:

```bash
# A URL administrativa não deve ser exibida, registrada em shell history ou
# compartilhada com o runtime. O comando aplica o journal na ordem 0003, 0004, 0005.
npm run migrate
```

Não execute SQL avulso para “marcar” migrations. O migrador valida o ledger ao
fim. Em caso de falha, pare: não tente reaplicar bootstrap nem corrigir o ledger
manualmente.

## Fase 4 — validação pós-migration e deploy separado

Confirme novamente ledger, schema de `employee_shift_assignments`, RLS, policies,
grants e atributos de `fhdod_api`. Valide, em ambiente e janela autorizados:

- upload CSV com profissional não cadastrado;
- seleção por setor e plantão noturno;
- criação de sessão, snapshots e NPS efetivo;
- conclusão com pergunta setorial omitida;
- inexistência de respostas fictícias;
- Data API isolada da arquitetura administrativa.

Deploy é uma decisão separada. O backend Fase 3 não é compatível com schema
produtivo ainda em `0000`–`0002`: a importação CSV depende das colunas de
`0005`, e operações runtime da Fase 3 dependem das policies de `0004`.

| Backend | Schema até `0002` | Schema após `0003`–`0005` |
| --- | --- | --- |
| Implantado atualmente | Não verificado nesta preparação. | Não verificado; `0003` pode alterar a expectativa de NPS materializado. |
| Fase 3 | Incompatível para CSV/RLS de Fase 3. | Compatibilidade validada localmente. |

## Recuperação

Não há rollback automático. Uma falha antes do commit da migration deve deixar o
ledger sem a entrada correspondente; confirme isso antes de qualquer ação.
Depois de uma migration confirmada, recuperação pode exigir migration corretiva
ou restauração do backup, com avaliação dos dados criados após a janela. Não
restaure sem decisão humana sobre esses dados e sobre a versão do backend ativa.
