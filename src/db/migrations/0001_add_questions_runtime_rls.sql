-- Fase 2: allow the trusted API role to use the question-management tables.
-- Authorization remains in the API services; RLS remains enabled as a
-- privilege boundary and is intentionally permissive for this runtime role.

DO $$
DECLARE
  policy_definition record;
BEGIN
  FOR policy_definition IN
    SELECT * FROM (VALUES
      ('fhdod_api_questions_select', 'questions', 'SELECT', 'USING (true)'),
      ('fhdod_api_questions_insert', 'questions', 'INSERT', 'WITH CHECK (true)'),
      ('fhdod_api_questions_update', 'questions', 'UPDATE', 'USING (true) WITH CHECK (true)'),
      ('fhdod_api_question_versions_select', 'question_versions', 'SELECT', 'USING (true)'),
      ('fhdod_api_question_versions_insert', 'question_versions', 'INSERT', 'WITH CHECK (true)'),
      ('fhdod_api_question_sector_assignments_select', 'question_sector_assignments', 'SELECT', 'USING (true)'),
      ('fhdod_api_question_sector_assignments_insert', 'question_sector_assignments', 'INSERT', 'WITH CHECK (true)'),
      ('fhdod_api_question_sector_assignments_update', 'question_sector_assignments', 'UPDATE', 'USING (true) WITH CHECK (true)'),
      ('fhdod_api_sector_nps_assignments_select', 'sector_nps_assignments', 'SELECT', 'USING (true)'),
      ('fhdod_api_sector_nps_assignments_insert', 'sector_nps_assignments', 'INSERT', 'WITH CHECK (true)'),
      ('fhdod_api_sector_nps_assignments_update', 'sector_nps_assignments', 'UPDATE', 'USING (true) WITH CHECK (true)')
    ) AS policies(policy_name, table_name, operation, expression)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = policy_definition.table_name
        AND policyname = policy_definition.policy_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR %s TO fhdod_api %s',
        policy_definition.policy_name,
        policy_definition.table_name,
        policy_definition.operation,
        policy_definition.expression
      );
    END IF;
  END LOOP;
END
$$;
