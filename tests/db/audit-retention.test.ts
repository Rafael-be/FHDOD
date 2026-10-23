import {
  runAuditRetentionCleanup,
  type AuditRetentionCleanup,
  type AuditRetentionLogger,
} from "../../src/db/audit-retention.js";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

function logger() {
  const records: Record<string, unknown>[] = [];

  return {
    records,
    logger: {
      info(record) {
        records.push(record);
      },
      error(record) {
        records.push(record);
      },
    } satisfies AuditRetentionLogger,
  };
}

async function runPurgeWithUnavailableLocalDatabase(): Promise<{
  exitCode: number | null;
  stderr: string;
}> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [
        resolve(process.cwd(), "node_modules/tsx/dist/cli.mjs"),
        resolve(process.cwd(), "src/db/purge-audit-logs.ts"),
      ],
      {
        env: {
          ...process.env,
          AUDIT_RETENTION_DATABASE_URL:
            "postgres://fhdod_audit_maintenance:secret@127.0.0.1:1/fhdod",
        },
      },
    );
    let stderr = "";

    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", reject);
    child.once("close", (exitCode) => {
      resolvePromise({ exitCode, stderr });
    });
  });
}

describe("audit retention job", () => {
  it("keeps the strict 48-hour boundary in the fixed database routine", async () => {
    const script = await readFile(
      resolve(process.cwd(), "scripts/audit-retention/install-purge-function.sql"),
      "utf8",
    );

    expect(script).toContain("WHERE created_at < now() - interval '48 hours'");
    expect(script).toContain("LIMIT 1000");
    expect(script).toContain("pg_try_advisory_xact_lock");
    expect(script).toContain("SECURITY DEFINER");
    expect(script).toContain("SET search_path = pg_catalog");
    expect(script).toContain("ALTER FUNCTION public.purge_expired_audit_logs()");
    expect(script).toContain("OWNER TO fhdod_audit_retention_owner");
    expect(script).toContain("REVOKE ALL ON FUNCTION public.purge_expired_audit_logs() FROM PUBLIC");
    expect(script).not.toContain("FOR UPDATE");
  });

  it("records aggregate completion data without audit content", async () => {
    const output = logger();
    const cleanup: AuditRetentionCleanup = {
      purgeExpiredAuditLogs: async () => ({ lockAcquired: true, deletedCount: 1000 }),
    };

    await expect(runAuditRetentionCleanup(cleanup, output.logger)).resolves.toEqual({
      lockAcquired: true,
      deletedCount: 1000,
    });
    expect(output.records).toEqual([
      expect.objectContaining({
        event: "audit_retention.completed",
        lockAcquired: true,
        deletedCount: 1000,
        durationMs: expect.any(Number),
      }),
    ]);
  });

  it("reports a concurrent execution as skipped without treating it as a failure", async () => {
    const output = logger();
    const cleanup: AuditRetentionCleanup = {
      purgeExpiredAuditLogs: async () => ({ lockAcquired: false, deletedCount: 0 }),
    };

    await expect(runAuditRetentionCleanup(cleanup, output.logger)).resolves.toEqual({
      lockAcquired: false,
      deletedCount: 0,
    });
    expect(output.records[0]).toMatchObject({
      event: "audit_retention.skipped",
      lockAcquired: false,
      deletedCount: 0,
    });
  });

  it("logs only an error code and preserves connection or permission failures", async () => {
    const output = logger();
    const failure = Object.assign(new Error("password=secret must not be logged"), {
      code: "42501",
    });
    const cleanup: AuditRetentionCleanup = {
      purgeExpiredAuditLogs: async () => {
        throw failure;
      },
    };

    await expect(runAuditRetentionCleanup(cleanup, output.logger)).rejects.toBe(failure);
    expect(output.records).toEqual([
      expect.objectContaining({
        event: "audit_retention.failed",
        code: "42501",
        durationMs: expect.any(Number),
      }),
    ]);
    expect(JSON.stringify(output.records)).not.toContain("password=secret");
  });

  it("returns a non-zero exit code for a local connection failure without logging credentials", async () => {
    const result = await runPurgeWithUnavailableLocalDatabase();

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("audit_retention.process_failed");
    expect(result.stderr).not.toContain("postgres://");
    expect(result.stderr).not.toContain("secret");
  });
});
