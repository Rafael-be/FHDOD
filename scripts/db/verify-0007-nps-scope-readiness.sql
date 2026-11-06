-- Read-only preflight for migration 0007_enforce_nps_scope_integrity.
-- Run only against the confirmed Supabase project using an approved
-- administrative read connection. This script does not modify data, schema,
-- roles, policies, grants, functions, triggers, or the Drizzle ledger.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

SELECT current_database() AS database_name,
       current_user AS database_role,
       current_setting('transaction_read_only') AS transaction_read_only;

-- The target must contain precisely migrations 0000..0006. Any row for 0007
-- or any unexpected row is a blocker; do not repair the ledger manually.
WITH expected(position, tag, hash, created_at) AS (
  VALUES
    (1, '0000', 'b642fb03d4c9b7a6058adc35f89d55faae427dfea122ad19d9e1d058997dde73', 1792621938065::bigint),
    (2, '0001', '2fd073c471546c8dc202f4ad12b6f49082e49844b6e256030416351791221dc1', 1792700000000::bigint),
    (3, '0002', '9ea865b9f2e509496bec3f19c0de48c17ae3e133bd0b77aa5bcbd8e1ff8d9726', 1792700001000::bigint),
    (4, '0003', '90954af8cff4f995c7194fd31f5a10ad42e17e74229517777afbd7bbbeaf9539', 1792700002000::bigint),
    (5, '0004', 'dd79954fcea2b059ad855fa3fe18cc56100c9f62c1ad40f4922f9feac62a3aeb', 1793487670540::bigint),
    (6, '0005', 'a88fbac69749a7a705428dd415ad53440692ef820471032a77462252befb2403', 1793636951186::bigint),
    (7, '0006', 'd4f6245133125beddd6f92dc8ac863d1c0a4b4cbbd0a4648335b3aeab6c7c88a', 1793903993237::bigint)
), actual AS (
  SELECT row_number() OVER (ORDER BY created_at, id)::integer AS position,
         id, hash, created_at
  FROM drizzle.__drizzle_migrations
)
SELECT coalesce(expected.position, actual.position) AS position,
       expected.tag,
       actual.id,
       CASE
         WHEN expected.position IS NULL THEN 'UNEXPECTED_LEDGER_ROW'
         WHEN actual.position IS NULL THEN 'MISSING_APPLIED_ROW'
         WHEN expected.hash = actual.hash AND expected.created_at = actual.created_at THEN 'MATCH'
         ELSE 'DIVERGENT'
       END AS status
FROM expected
FULL OUTER JOIN actual USING (position)
ORDER BY position;

-- This is the 0007 precondition: only active NPS links must be selected-sector
-- specific overrides. Closed rows are immutable history and are reported only.
SELECT count(*) AS active_nps_scope_incompatibilities
FROM public.sector_nps_assignments AS a
JOIN public.questions AS q ON q.id = a.question_id
WHERE a.ended_at IS NULL
  AND (q.question_kind <> 'standard'
       OR NOT q.is_nps
       OR q.scope <> 'selected_sectors'
       OR a.assignment_source <> 'specific');

SELECT q.scope,
       a.assignment_source,
       count(*) AS closed_nps_history_rows
FROM public.sector_nps_assignments AS a
JOIN public.questions AS q ON q.id = a.question_id
WHERE a.ended_at IS NOT NULL
  AND q.question_kind = 'standard'
  AND q.is_nps
GROUP BY q.scope, a.assignment_source
ORDER BY q.scope, a.assignment_source;

SELECT count(*) AS orphan_nps_assignments
FROM public.sector_nps_assignments AS a
LEFT JOIN public.questions AS q ON q.id = a.question_id
WHERE q.id IS NULL;

-- 0006 protections must exist before 0007 replaces their function bodies.
SELECT tgname AS trigger_name, tgenabled AS enabled
FROM pg_trigger
WHERE tgrelid IN ('public.questions'::regclass, 'public.sector_nps_assignments'::regclass)
  AND tgname IN (
    'questions_validate_linked_question_classification',
    'sector_nps_assignments_validate_question_kind'
  )
  AND NOT tgisinternal
ORDER BY tgname;

SELECT c.relname AS table_name,
       c.relrowsecurity AS rls_enabled,
       count(p.policyname) AS policy_count
FROM pg_class AS c
JOIN pg_namespace AS n ON n.oid = c.relnamespace
LEFT JOIN pg_policies AS p ON p.schemaname = n.nspname AND p.tablename = c.relname
WHERE n.nspname = 'public'
  AND c.relname IN ('questions', 'sector_nps_assignments')
GROUP BY c.relname, c.relrowsecurity
ORDER BY c.relname;

SELECT r.rolname,
       r.rolsuper,
       r.rolbypassrls,
       has_table_privilege(r.rolname, 'public.questions', 'SELECT, INSERT, UPDATE') AS questions_runtime_grants,
       has_table_privilege(r.rolname, 'public.sector_nps_assignments', 'SELECT, INSERT, UPDATE') AS nps_runtime_grants
FROM pg_roles AS r
WHERE r.rolname = 'fhdod_api';

COMMIT;
