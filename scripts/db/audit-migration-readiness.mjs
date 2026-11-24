import { readMigrationFiles } from "drizzle-orm/migrator";
import postgres from "postgres";

const url = process.env.AUDIT_DATABASE_URL;
if (!url) throw new Error("AUDIT_DATABASE_URL is required");

const expected = readMigrationFiles({ migrationsFolder: "src/db/migrations" });
const client = postgres(url, { max: 1, connect_timeout: 8 });

try {
  const report = await client.begin(async (tx) => {
    await tx`set transaction read only`;
    await tx`set local statement_timeout = '8s'`;
    await tx`set local lock_timeout = '2s'`;

    const [identity] = await tx`
      select current_database() as database, current_user as role,
             current_setting('server_version') as postgres_version
    `;
    const ledger = await tx`
      select hash, created_at from drizzle.__drizzle_migrations order by created_at
    `;
    const schemas = await tx`
      select schema_name from information_schema.schemata
      where schema_name not like 'pg_%' and schema_name <> 'information_schema'
      order by schema_name
    `;
    const tables = await tx`
      select c.relname as name, c.relrowsecurity as rls,
             (select count(*)::int from pg_policies p
              where p.schemaname = 'public' and p.tablename = c.relname) as policies
      from pg_class c where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p')
      order by c.relname
    `;
    const columns = await tx`
      select table_name, column_name, udt_name, is_nullable, column_default
      from information_schema.columns where table_schema = 'public'
      order by table_name, ordinal_position
    `;
    const policies = await tx`
      select tablename, policyname, cmd, roles, qual, with_check
      from pg_policies where schemaname = 'public'
      order by tablename, policyname
    `;
    const objects = await tx`
      select 'index' as kind, indexname as name from pg_indexes where schemaname = 'public'
      union all select 'constraint', conname from pg_constraint
        where connamespace = 'public'::regnamespace
      union all select 'trigger', tgname from pg_trigger t
        join pg_class c on c.oid = t.tgrelid
        where c.relnamespace = 'public'::regnamespace and not t.tgisinternal
      union all select 'function', p.proname from pg_proc p
        where p.pronamespace = 'public'::regnamespace
      union all select 'view', viewname from pg_views where schemaname = 'public'
      order by kind, name
    `;
    const definitions = await tx`
      select 'index' as kind, tablename as parent, indexname as name, indexdef as definition
      from pg_indexes where schemaname = 'public'
      union all
      select 'constraint', c.conrelid::regclass::text, c.conname,
             pg_get_constraintdef(c.oid)
      from pg_constraint c where c.connamespace = 'public'::regnamespace
        and c.conrelid <> 0
      union all
      select 'trigger', t.tgrelid::regclass::text, t.tgname,
             pg_get_triggerdef(t.oid)
      from pg_trigger t join pg_class c on c.oid=t.tgrelid
      where c.relnamespace='public'::regnamespace and not t.tgisinternal
      order by kind, parent, name
    `;
    const extensions = await tx`select extname, extversion from pg_extension order by extname`;
    const roles = await tx`
      select rolname, rolcanlogin from pg_roles
      where rolname in ('fhdod_api', 'fhdod_audit_maintenance')
      order by rolname
    `;
    const grants = await tx`
      select grantee, privilege_type, count(*)::int as count
      from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'fhdod_api'
      group by grantee, privilege_type order by privilege_type
    `;
    const tableGrants = await tx`
      select table_name, privilege_type from information_schema.role_table_grants
      where table_schema = 'public' and grantee = 'fhdod_api'
      order by table_name, privilege_type
    `;
    const data = await tx`
      select
        (select count(*)::int from sectors) as sectors,
        (select count(*)::int from submission_form_versions) as form_versions,
        (select count(*)::int from submission_form_questions) as form_questions,
        (select count(*)::int from submission_sessions) as sessions,
        (select count(*)::int from submission_answers) as legacy_answers
    `;
    const readiness = await tx`
      with latest as (
        select distinct on (sector_id) id, sector_id
        from submission_form_versions order by sector_id, version_number desc
      )
      select
        count(*)::int as latest_forms,
        count(*) filter (where s.deleted_at is null)::int as latest_active_forms,
        count(*) filter (where s.deleted_at is null and
          (select count(*) from submission_form_questions q where q.form_version_id=l.id and q.is_nps)=1 and
          exists (select 1 from submission_form_questions q where q.form_version_id=l.id
                  and q.question_kind='standard' and not q.is_nps))::int as backfill_candidates
      from latest l join sectors s on s.id=l.sector_id
    `;

    return {
      identity, schemas: schemas.map((r) => r.schema_name),
      migrations: {
        expected: expected.length, actual: ledger.length,
        prefixMatches: ledger.every((row, i) =>
          row.hash === expected[i]?.hash && Number(row.created_at) === expected[i]?.folderMillis),
        positions: ledger.map((row, i) => ({ index: i, createdAt: Number(row.created_at),
          hashMatches: row.hash === expected[i]?.hash,
          timestampMatches: Number(row.created_at) === expected[i]?.folderMillis })),
      },
      tables, columns, policies, objects, definitions, extensions, roles, grants, tableGrants,
      data: data[0], readiness: readiness[0],
    };
  });
  console.log(JSON.stringify(report, null, 2));
} finally {
  await client.end({ timeout: 1 });
}
