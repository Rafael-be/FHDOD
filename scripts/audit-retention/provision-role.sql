-- Execute once with psql and an administrative connection, outside the API.
-- This command intentionally contains no password. Set it interactively after
-- provisioning with: \password fhdod_audit_maintenance
CREATE ROLE fhdod_audit_maintenance
    LOGIN
    NOINHERIT
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOREPLICATION
    NOBYPASSRLS;

CREATE ROLE fhdod_audit_retention_owner
    NOLOGIN
    NOINHERIT
    NOSUPERUSER
    NOCREATEDB
    NOCREATEROLE
    NOREPLICATION
    NOBYPASSRLS;

GRANT USAGE ON SCHEMA public TO fhdod_audit_maintenance;
GRANT USAGE ON SCHEMA public TO fhdod_audit_retention_owner;
GRANT SELECT (id, created_at) ON TABLE public.audit_logs
TO fhdod_audit_retention_owner;
GRANT DELETE ON TABLE public.audit_logs TO fhdod_audit_retention_owner;
