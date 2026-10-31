-- Execute once with psql and an administrative connection, outside the API.
-- This command intentionally contains no password. Set it interactively after
-- provisioning with: \password fhdod_audit_maintenance
DO $provision$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fhdod_audit_maintenance') THEN
        CREATE ROLE fhdod_audit_maintenance
            LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'fhdod_audit_retention_owner') THEN
        CREATE ROLE fhdod_audit_retention_owner
            NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
    END IF;
END;
$provision$;

GRANT USAGE ON SCHEMA public TO fhdod_audit_maintenance;
GRANT USAGE ON SCHEMA public TO fhdod_audit_retention_owner;
GRANT SELECT (id, created_at) ON TABLE public.audit_logs
TO fhdod_audit_retention_owner;
GRANT DELETE ON TABLE public.audit_logs TO fhdod_audit_retention_owner;
