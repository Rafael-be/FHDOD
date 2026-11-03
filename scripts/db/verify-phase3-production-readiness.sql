-- Read-only preflight for the future production application of migrations 0003,
-- 0004 and 0005. Run only with an approved administrative read connection to
-- the confirmed project. This script neither invokes application functions nor
-- changes data, schema, roles, grants, policies or the Drizzle ledger.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '10s';
SET LOCAL lock_timeout = '2s';

-- Record only non-sensitive session identity information with the operator log.
SELECT current_database() AS database_name,
       current_user AS database_role,
       current_setting('transaction_read_only') AS transaction_read_only;

-- Ledger contract: rows 0..2 must match and rows 3..5 must be absent before
-- this operation. Any other result is a blocker; never repair this ledger by SQL.
WITH expected(position, tag, hash, created_at) AS (
  VALUES
    (1, '0000_enforce_runtime_rls_policies', 'b642fb03d4c9b7a6058adc35f89d55faae427dfea122ad19d9e1d058997dde73', 1792621938065::bigint),
    (2, '0001_add_questions_runtime_rls', '2fd073c471546c8dc202f4ad12b6f49082e49844b6e256030416351791221dc1', 1792700000000::bigint),
    (3, '0002_add_question_versions_update_rls', '9ea865b9f2e509496bec3f19c0de48c17ae3e133bd0b77aa5bcbd8e1ff8d9726', 1792700001000::bigint),
    (4, '0003_make_global_nps_dynamic', '90954af8cff4f995c7194fd31f5a10ad42e17e74229517777afbd7bbbeaf9539', 1792700002000::bigint),
    (5, '0004_reconcile_runtime_rls_phase3', 'dd79954fcea2b059ad855fa3fe18cc56100c9f62c1ad40f4922f9feac62a3aeb', 1793487670540::bigint),
    (6, '0005_opposite_romulus', 'a88fbac69749a7a705428dd415ad53440692ef820471032a77462252befb2403', 1793636951186::bigint)
), actual AS (
  SELECT row_number() OVER (ORDER BY created_at, id)::integer AS position,
         id, hash, created_at
  FROM drizzle.__drizzle_migrations
)
SELECT coalesce(expected.position, actual.position) AS position,
       expected.tag,
       actual.id,
       expected.hash AS expected_hash,
       actual.hash AS actual_hash,
       expected.created_at AS expected_created_at,
       actual.created_at AS actual_created_at,
       CASE
         WHEN expected.position IS NULL THEN 'UNEXPECTED_LEDGER_ROW'
         WHEN actual.position IS NULL AND expected.position <= 3 THEN 'MISSING_APPLIED_ROW'
         WHEN actual.position IS NULL THEN 'EXPECTED_PENDING'
         WHEN expected.hash = actual.hash AND expected.created_at = actual.created_at THEN 'MATCH'
         ELSE 'DIVERGENT'
       END AS status
FROM expected
FULL OUTER JOIN actual USING (position)
ORDER BY position;

-- 0003: exactly the rows its UPDATE can close. No patient or employee content
-- is returned. Zero eligible rows is valid, not an automatic failure.
WITH eligible AS (
  SELECT a.id, a.question_id, a.sector_id, a.assigned_at
  FROM public.sector_nps_assignments AS a
  JOIN public.questions AS q ON q.id = a.question_id
  WHERE a.ended_at IS NULL
    AND a.assignment_source = 'global'
    AND q.is_nps = true
    AND q.scope = 'all_sectors'
)
SELECT count(*) AS assignments_0003_would_close,
       count(DISTINCT question_id) AS global_nps_questions,
       count(DISTINCT sector_id) AS affected_sectors,
       min(assigned_at) AS oldest_assignment,
       max(assigned_at) AS newest_assignment
FROM eligible;

WITH eligible_questions AS (
  SELECT DISTINCT a.question_id
  FROM public.sector_nps_assignments AS a
  JOIN public.questions AS q ON q.id = a.question_id
  WHERE a.ended_at IS NULL
    AND a.assignment_source = 'global'
    AND q.is_nps = true
    AND q.scope = 'all_sectors'
)
SELECT a.question_id,
       count(*) FILTER (WHERE a.assignment_source = 'global' AND a.ended_at IS NULL) AS active_global,
       count(*) FILTER (WHERE a.assignment_source = 'specific' AND a.ended_at IS NULL) AS active_specific
FROM public.sector_nps_assignments AS a
JOIN eligible_questions AS q USING (question_id)
GROUP BY a.question_id
ORDER BY a.question_id;

-- Snapshots are not updated by 0003. This only reports their existing count.
SELECT count(*) AS existing_nps_snapshot_rows
FROM public.submission_session_questions
WHERE is_nps = true;

-- 0004: all target tables must exist. RLS must already be enabled by the
-- baseline; FORCE RLS and ownership are reported for human review.
WITH expected_tables(table_name) AS (
  VALUES
    ('audit_logs'), ('auth_refresh_tokens'), ('auth_sessions'),
    ('content_page_versions'), ('content_pages'), ('dashboard_dirty_groups'),
    ('dashboard_summary_state'), ('employee_shift_assignments'), ('employees'),
    ('hourly_answer_summaries'), ('hourly_ombudsman_summaries'),
    ('hourly_session_summaries'), ('ombudsman_notes'), ('ombudsman_tickets'),
    ('permissions'), ('question_sector_assignments'), ('question_versions'),
    ('questions'), ('role_permissions'), ('roles'), ('sector_nps_assignments'),
    ('sector_shift_ranges'), ('sectors'), ('shift_sheet_versions'),
    ('shift_upload_attempts'), ('submission_answers'),
    ('submission_session_questions'), ('submission_sessions'),
    ('user_sector_assignments'), ('users')
)
SELECT e.table_name,
       c.oid IS NOT NULL AS table_exists,
       c.relrowsecurity AS rls_enabled,
       c.relforcerowsecurity AS force_rls,
       pg_get_userbyid(c.relowner) AS table_owner
FROM expected_tables AS e
LEFT JOIN pg_class AS c
  ON c.relnamespace = 'public'::regnamespace
 AND c.relname = e.table_name
 AND c.relkind = 'r'
ORDER BY e.table_name;

-- Every row returned here blocks 0004: its CREATE POLICY statements are not
-- idempotent, even if an existing definition appears identical.
WITH expected_policies(table_name, policy_name, command) AS (
  VALUES
    ('dashboard_dirty_groups', 'fhdod_api_dashboard_dirty_groups_insert', 'INSERT'),
    ('employee_shift_assignments', 'fhdod_api_employee_shift_assignments_insert', 'INSERT'),
    ('employee_shift_assignments', 'fhdod_api_employee_shift_assignments_select', 'SELECT'),
    ('employees', 'fhdod_api_employees_select', 'SELECT'),
    ('sector_shift_ranges', 'fhdod_api_sector_shift_ranges_insert', 'INSERT'),
    ('shift_sheet_versions', 'fhdod_api_shift_sheet_versions_update', 'UPDATE'),
    ('shift_sheet_versions', 'fhdod_api_shift_sheet_versions_insert', 'INSERT'),
    ('shift_upload_attempts', 'fhdod_api_shift_upload_attempts_insert', 'INSERT'),
    ('submission_answers', 'fhdod_api_submission_answers_update', 'UPDATE'),
    ('submission_answers', 'fhdod_api_submission_answers_insert', 'INSERT'),
    ('submission_answers', 'fhdod_api_submission_answers_select', 'SELECT'),
    ('submission_session_questions', 'fhdod_api_submission_session_questions_insert', 'INSERT'),
    ('submission_session_questions', 'fhdod_api_submission_session_questions_select', 'SELECT'),
    ('submission_sessions', 'fhdod_api_submission_sessions_update', 'UPDATE'),
    ('submission_sessions', 'fhdod_api_submission_sessions_insert', 'INSERT'),
    ('submission_sessions', 'fhdod_api_submission_sessions_select', 'SELECT')
)
SELECT e.table_name, e.policy_name, e.command AS expected_command,
       p.permissive, p.roles, p.cmd AS actual_command, p.qual, p.with_check
FROM expected_policies AS e
JOIN pg_policies AS p
  ON p.schemaname = 'public'
 AND p.tablename = e.table_name
 AND p.policyname = e.policy_name
ORDER BY e.table_name, e.policy_name;

WITH expected_operations(table_name, command) AS (
  VALUES
    ('dashboard_dirty_groups', 'INSERT'),
    ('employee_shift_assignments', 'INSERT'), ('employee_shift_assignments', 'SELECT'),
    ('employees', 'SELECT'), ('sector_shift_ranges', 'INSERT'),
    ('shift_sheet_versions', 'UPDATE'), ('shift_sheet_versions', 'INSERT'),
    ('shift_upload_attempts', 'INSERT'), ('submission_answers', 'UPDATE'),
    ('submission_answers', 'INSERT'), ('submission_answers', 'SELECT'),
    ('submission_session_questions', 'INSERT'), ('submission_session_questions', 'SELECT'),
    ('submission_sessions', 'UPDATE'), ('submission_sessions', 'INSERT'),
    ('submission_sessions', 'SELECT')
)
SELECT table_name, command,
       has_table_privilege('fhdod_api', format('public.%I', table_name), command) AS granted
FROM expected_operations
ORDER BY table_name, command;

SELECT rolname, rolsuper, rolbypassrls, rolcanlogin, rolinherit,
       rolcreaterole, rolcreatedb
FROM pg_roles
WHERE rolname = 'fhdod_api';

SELECT c.relname AS table_name,
       has_table_privilege('fhdod_api', c.oid, 'DELETE') AS api_can_delete
FROM pg_class AS c
WHERE c.relnamespace = 'public'::regnamespace
  AND c.relkind = 'r'
ORDER BY c.relname;

-- 0005: inspect the expected pre-migration schema and any partial state.
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'employee_shift_assignments'
ORDER BY ordinal_position;

SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'employee_shift_assignments'
  AND indexname IN ('employee_shift_date_assignment_uq', 'employee_shift_weekday_assignment_uq')
ORDER BY indexname;

SELECT conname, pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.employee_shift_assignments'::regclass
  AND conname IN ('employee_shift_code_nonempty_check', 'employee_shift_name_nonempty_check')
ORDER BY conname;

-- Classifies NULL, empty and whitespace-only source values separately. The
-- first DO block of 0005 catches missing employees and empty/whitespace values;
-- NULL source values are additionally reported because the later NOT NULL step
-- would reject their backfill.
WITH classified AS (
  SELECT a.id,
         CASE
           WHEN e.id IS NULL THEN 'missing_employee'
           WHEN e.employee_code IS NULL THEN 'null_employee_code'
           WHEN e.full_name IS NULL THEN 'null_employee_name'
           WHEN e.employee_code = '' THEN 'empty_employee_code'
           WHEN e.full_name = '' THEN 'empty_employee_name'
           WHEN btrim(e.employee_code) = '' THEN 'whitespace_employee_code'
           WHEN btrim(e.full_name) = '' THEN 'whitespace_employee_name'
         END AS issue
  FROM public.employee_shift_assignments AS a
  LEFT JOIN public.employees AS e ON e.id = a.employee_id
)
SELECT issue, count(*) AS assignment_count, array_agg(id ORDER BY id) AS assignment_ids
FROM classified
WHERE issue IS NOT NULL
GROUP BY issue
ORDER BY issue;

-- The two queries below reproduce exactly the expressions and partial filters
-- of the two new unique indexes. IDs are returned instead of employee data.
SELECT array_agg(a.id ORDER BY a.id) AS assignment_ids,
       a.shift_range_id, a.work_date, count(*) AS collision_count
FROM public.employee_shift_assignments AS a
JOIN public.employees AS e ON e.id = a.employee_id
WHERE a.work_date IS NOT NULL
  AND e.employee_code IS NOT NULL AND e.full_name IS NOT NULL
  AND btrim(e.employee_code) <> '' AND btrim(e.full_name) <> ''
GROUP BY a.shift_range_id, lower(btrim(e.employee_code)),
         lower(btrim(e.full_name)), a.work_date
HAVING count(*) > 1
ORDER BY a.shift_range_id, a.work_date;

SELECT array_agg(a.id ORDER BY a.id) AS assignment_ids,
       a.shift_range_id, a.day_of_week, count(*) AS collision_count
FROM public.employee_shift_assignments AS a
JOIN public.employees AS e ON e.id = a.employee_id
WHERE a.day_of_week IS NOT NULL
  AND e.employee_code IS NOT NULL AND e.full_name IS NOT NULL
  AND btrim(e.employee_code) <> '' AND btrim(e.full_name) <> ''
GROUP BY a.shift_range_id, lower(btrim(e.employee_code)),
         lower(btrim(e.full_name)), a.day_of_week
HAVING count(*) > 1
ORDER BY a.shift_range_id, a.day_of_week;

-- This remains valid before and after 0005. Any partial schema or data state
-- makes the result non-APTO and requires manual investigation.
WITH schema_state AS (
  SELECT count(*) FILTER (WHERE column_name IN ('employee_code', 'employee_name')) AS new_columns
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'employee_shift_assignments'
), rows_as_json AS (
  SELECT to_jsonb(a) AS row_data
  FROM public.employee_shift_assignments AS a
)
SELECT CASE new_columns
         WHEN 0 THEN 'PRE_0005_SCHEMA'
         WHEN 2 THEN 'POST_OR_PARTIAL_0005_SCHEMA'
         ELSE 'PARTIAL_0005_SCHEMA'
       END AS schema_state,
       count(*) FILTER (WHERE new_columns = 2 AND (row_data ->> 'employee_code') IS NULL) AS null_backfilled_codes,
       count(*) FILTER (WHERE new_columns = 2 AND (row_data ->> 'employee_name') IS NULL) AS null_backfilled_names,
       count(*) FILTER (WHERE new_columns = 2 AND btrim(coalesce(row_data ->> 'employee_code', '')) = '') AS blank_backfilled_codes,
       count(*) FILTER (WHERE new_columns = 2 AND btrim(coalesce(row_data ->> 'employee_name', '')) = '') AS blank_backfilled_names
FROM schema_state
LEFT JOIN rows_as_json ON true
GROUP BY new_columns;

COMMIT;
