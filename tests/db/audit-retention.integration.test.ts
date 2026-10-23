import "dotenv/config";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { PostgresAuditRetentionCleanup } from "../../src/db/audit-retention.js";

const maintenanceUrl = process.env.AUDIT_RETENTION_DATABASE_URL_TEST;
const adminUrl = process.env.AUDIT_RETENTION_ADMIN_DATABASE_URL_TEST;
const apiUrl = process.env.AUDIT_RETENTION_API_DATABASE_URL_TEST;

function isLocalAuditRetentionTestDatabase(value: string | undefined): boolean {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);

    return ["127.0.0.1", "localhost", "::1"].includes(url.hostname)
      && url.pathname === "/fhdod_audit_retention_test";
  } catch {
    return false;
  }
}

const integration = isLocalAuditRetentionTestDatabase(maintenanceUrl)
  && isLocalAuditRetentionTestDatabase(adminUrl)
  && isLocalAuditRetentionTestDatabase(apiUrl)
  ? describe
  : describe.skip;

integration("audit retention database routine", () => {
  const prefix = `audit-retention-test-${randomUUID()}`;
  const admin = postgres(adminUrl!, { max: 1, prepare: false });
  const maintenance = postgres(maintenanceUrl!, { max: 1, prepare: false });
  const api = postgres(apiUrl!, { max: 1, prepare: false });
  const cleanup = new PostgresAuditRetentionCleanup(maintenance);

  async function insertAuditLog(action: string, createdAt: Date): Promise<void> {
    await admin`
      insert into public.audit_logs (
        action,
        entity_type,
        created_at
      )
      values (${action}, 'test', ${createdAt.toISOString()})
    `;
  }

  async function countAuditLogs(action: string): Promise<number> {
    const rows = await admin<{ count: string }[]>`
      select count(*)::text as count
      from public.audit_logs
      where action = ${action}
    `;

    return Number(rows[0]?.count ?? "0");
  }

  afterEach(async () => {
    await admin`
      delete from public.audit_logs
      where action like ${`${prefix}%`}
    `;
  });

  afterAll(async () => {
    await Promise.all([
      admin.end({ timeout: 5 }),
      maintenance.end({ timeout: 5 }),
      api.end({ timeout: 5 }),
    ]);
  });

  it("preserves recent logs and deletes expired logs in one bounded batch", async () => {
    const expiredAction = `${prefix}-expired`;
    const recentAction = `${prefix}-recent`;
    const now = Date.now();

    await insertAuditLog(expiredAction, new Date(now - 48 * 3_600_000 - 60_000));
    await insertAuditLog(recentAction, new Date(now - 48 * 3_600_000 + 60_000));

    await expect(cleanup.purgeExpiredAuditLogs()).resolves.toMatchObject({
      lockAcquired: true,
      deletedCount: expect.any(Number),
    });
    await expect(countAuditLogs(expiredAction)).resolves.toBe(0);
    await expect(countAuditLogs(recentAction)).resolves.toBe(1);
  });

  it("does not delete when another cleanup transaction owns the advisory lock", async () => {
    const expiredAction = `${prefix}-concurrent`;
    await insertAuditLog(expiredAction, new Date(Date.now() - 48 * 3_600_000 - 60_000));

    await admin.begin(async (transaction) => {
      await transaction`
        select pg_advisory_xact_lock(
          hashtextextended('fhdod.audit_retention', 0)
        )
      `;

      await expect(cleanup.purgeExpiredAuditLogs()).resolves.toEqual({
        lockAcquired: false,
        deletedCount: 0,
      });
      const rows = await transaction<{ count: string }[]>`
        select count(*)::text as count
        from public.audit_logs
        where action = ${expiredAction}
      `;

      expect(Number(rows[0]?.count ?? "0")).toBe(1);
    });

    await expect(cleanup.purgeExpiredAuditLogs()).resolves.toMatchObject({
      lockAcquired: true,
    });
    await expect(countAuditLogs(expiredAction)).resolves.toBe(0);
  });

  it("does not grant delete or cleanup execution to fhdod_api", async () => {
    await expect(api`
      delete from public.audit_logs
      where action = ${`${prefix}-never-created`}
    `).rejects.toMatchObject({ code: "42501" });
    await expect(api`
      select *
      from public.purge_expired_audit_logs()
    `).rejects.toMatchObject({ code: "42501" });
    await expect(maintenance`
      delete from public.audit_logs
      where action = ${`${prefix}-never-created`}
    `).rejects.toMatchObject({ code: "42501" });
  });

  it("uses a restricted SECURITY DEFINER owner and grants execution only to maintenance", async () => {
    const functions = await admin<{
      owner: string;
      securityDefiner: boolean;
    }[]>`
      select
        pg_get_userbyid(proowner) as owner,
        prosecdef as "securityDefiner"
      from pg_proc
      where oid = 'public.purge_expired_audit_logs()'::regprocedure
    `;

    expect(functions).toEqual([{
      owner: "fhdod_audit_retention_owner",
      securityDefiner: true,
    }]);
    await expect(admin<{ canExecute: boolean }[]>`
      select has_function_privilege(
        'fhdod_audit_maintenance',
        'public.purge_expired_audit_logs()',
        'EXECUTE'
      ) as "canExecute"
    `).resolves.toEqual([{ canExecute: true }]);
    await expect(admin<{ canExecute: boolean }[]>`
      select has_function_privilege(
        'fhdod_api',
        'public.purge_expired_audit_logs()',
        'EXECUTE'
      ) as "canExecute"
    `).resolves.toEqual([{ canExecute: false }]);
    await expect(admin<{ canReadContent: boolean }[]>`
      select has_column_privilege(
        'fhdod_audit_retention_owner',
        'public.audit_logs',
        'action',
        'SELECT'
      ) as "canReadContent"
    `).resolves.toEqual([{ canReadContent: false }]);
  });
});
