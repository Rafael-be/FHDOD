-- Read-only preflight for a database initialized from src/db/bootstrap/FHDOD.sql.
-- Run with an administrative connection against an isolated or approved database.
-- It deliberately performs no DDL and does not mark migrations as applied.
WITH expected_tables(table_name) AS (
  VALUES ('questions'), ('question_versions'), ('question_sector_assignments'), ('sector_nps_assignments')
), expected_indexes(index_name) AS (
  VALUES
    ('questions_active_sector_order_uq'),
    ('questions_one_active_global_nps_uq'),
    ('question_versions_one_current_uq'),
    ('question_sector_assignment_active_question_uq'),
    ('question_sector_assignment_active_order_uq'),
    ('sector_nps_one_current_per_sector_uq')
)
SELECT 'missing_table' AS kind, table_name AS name
FROM expected_tables
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_tables
  WHERE schemaname = 'public' AND tablename = expected_tables.table_name
)
UNION ALL
SELECT 'missing_index' AS kind, index_name AS name
FROM expected_indexes
WHERE NOT EXISTS (
  SELECT 1 FROM pg_catalog.pg_indexes
  WHERE schemaname = 'public' AND indexname = expected_indexes.index_name
)
ORDER BY kind, name;

SELECT c.relname AS table_name, c.relrowsecurity AS rls_enabled, c.relforcerowsecurity AS rls_forced
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('questions', 'question_versions', 'question_sector_assignments', 'sector_nps_assignments')
ORDER BY c.relname;
