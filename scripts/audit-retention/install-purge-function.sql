-- Execute with the administrative migration credential after the dedicated role
-- has been provisioned. This is intentionally not a Drizzle migration while the
-- project baseline remains unreconciled.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'fhdod_audit_maintenance'
  ) OR NOT EXISTS (
    SELECT 1
    FROM pg_roles
    WHERE rolname = 'fhdod_audit_retention_owner'
  ) THEN
    RAISE EXCEPTION
      'Audit retention roles must be provisioned before installing audit retention.';
  END IF;
END
$$;

-- SECURITY DEFINER still obeys RLS for its non-owner table access. These
-- policies grant the no-login function owner visibility and deletion only for
-- the same expired rows enforced by the function body.
DROP POLICY IF EXISTS fhdod_audit_retention_owner_expired_select ON public.audit_logs;
CREATE POLICY fhdod_audit_retention_owner_expired_select
ON public.audit_logs
FOR SELECT
TO fhdod_audit_retention_owner
USING (created_at < now() - interval '48 hours');

DROP POLICY IF EXISTS fhdod_audit_retention_owner_expired_delete ON public.audit_logs;
CREATE POLICY fhdod_audit_retention_owner_expired_delete
ON public.audit_logs
FOR DELETE
TO fhdod_audit_retention_owner
USING (created_at < now() - interval '48 hours');

CREATE OR REPLACE FUNCTION public.purge_expired_audit_logs()
RETURNS TABLE (acquired_lock boolean, deleted_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $$
DECLARE
  deleted_rows integer;
BEGIN
  IF NOT pg_try_advisory_xact_lock(
    hashtextextended('fhdod.audit_retention', 0)
  ) THEN
    RETURN QUERY SELECT false, 0;
    RETURN;
  END IF;

  WITH expired_rows AS (
    SELECT id
    FROM public.audit_logs
    WHERE created_at < now() - interval '48 hours'
    ORDER BY created_at, id
    LIMIT 1000
  ),
  deleted_rows_result AS (
    DELETE FROM public.audit_logs AS audit_logs
    USING expired_rows
    WHERE audit_logs.id = expired_rows.id
    RETURNING audit_logs.id
  )
  SELECT count(*)::integer
  INTO deleted_rows
  FROM deleted_rows_result;

  RETURN QUERY SELECT true, deleted_rows;
END;
$$;

ALTER FUNCTION public.purge_expired_audit_logs()
OWNER TO fhdod_audit_retention_owner;

REVOKE ALL ON FUNCTION public.purge_expired_audit_logs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_audit_logs()
TO fhdod_audit_maintenance;
