-- The API authenticates and authorizes requests in its service layer. These
-- policies make that trusted runtime role usable while preserving SQL grants
-- as the first privilege boundary. They deliberately do not grant DELETE.
DO $$
DECLARE
  policy_definition record;
BEGIN
  FOR policy_definition IN
    SELECT * FROM (VALUES
      ('fhdod_api_roles_select', 'roles', 'SELECT', 'USING (true)'),
      ('fhdod_api_users_select', 'users', 'SELECT', 'USING (true)'),
      ('fhdod_api_users_insert', 'users', 'INSERT', 'WITH CHECK (true)'),
      ('fhdod_api_users_update', 'users', 'UPDATE', 'USING (true) WITH CHECK (true)'),
      ('fhdod_api_auth_sessions_select', 'auth_sessions', 'SELECT', 'USING (true)'),
      ('fhdod_api_auth_sessions_insert', 'auth_sessions', 'INSERT', 'WITH CHECK (true)'),
      ('fhdod_api_auth_sessions_update', 'auth_sessions', 'UPDATE', 'USING (true) WITH CHECK (true)'),
      ('fhdod_api_auth_refresh_tokens_select', 'auth_refresh_tokens', 'SELECT', 'USING (true)'),
      ('fhdod_api_auth_refresh_tokens_insert', 'auth_refresh_tokens', 'INSERT', 'WITH CHECK (true)'),
      ('fhdod_api_auth_refresh_tokens_update', 'auth_refresh_tokens', 'UPDATE', 'USING (true) WITH CHECK (true)'),
      ('fhdod_api_sectors_select', 'sectors', 'SELECT', 'USING (true)'),
      ('fhdod_api_sectors_insert', 'sectors', 'INSERT', 'WITH CHECK (true)'),
      ('fhdod_api_sectors_update', 'sectors', 'UPDATE', 'USING (true) WITH CHECK (true)'),
      ('fhdod_api_user_sector_assignments_select', 'user_sector_assignments', 'SELECT', 'USING (true)'),
      ('fhdod_api_user_sector_assignments_insert', 'user_sector_assignments', 'INSERT', 'WITH CHECK (true)'),
      ('fhdod_api_user_sector_assignments_update', 'user_sector_assignments', 'UPDATE', 'USING (true) WITH CHECK (true)'),
      ('fhdod_api_audit_logs_select', 'audit_logs', 'SELECT', 'USING (true)'),
      ('fhdod_api_audit_logs_insert', 'audit_logs', 'INSERT', 'WITH CHECK (true)'),
      ('fhdod_api_content_pages_select', 'content_pages', 'SELECT', 'USING (true)'),
      ('fhdod_api_content_pages_update', 'content_pages', 'UPDATE', 'USING (true) WITH CHECK (true)'),
      ('fhdod_api_content_page_versions_select', 'content_page_versions', 'SELECT', 'USING (true)'),
      ('fhdod_api_content_page_versions_insert', 'content_page_versions', 'INSERT', 'WITH CHECK (true)'),
      ('fhdod_api_content_page_versions_update', 'content_page_versions', 'UPDATE', 'USING (true) WITH CHECK (true)'),
      ('fhdod_api_sector_shift_ranges_select', 'sector_shift_ranges', 'SELECT', 'USING (true)'),
      ('fhdod_api_shift_sheet_versions_select', 'shift_sheet_versions', 'SELECT', 'USING (true)'),
      ('fhdod_api_sector_nps_assignments_select', 'sector_nps_assignments', 'SELECT', 'USING (true)')
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
