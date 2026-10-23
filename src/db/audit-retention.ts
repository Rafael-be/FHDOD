import type postgres from "postgres";

export interface AuditRetentionResult {
  lockAcquired: boolean;
  deletedCount: number;
}

interface RawAuditRetentionResult {
  lockAcquired: boolean;
  deletedCount: number;
}

export interface AuditRetentionCleanup {
  purgeExpiredAuditLogs(): Promise<AuditRetentionResult>;
}

export interface AuditRetentionLogger {
  info(record: Record<string, unknown>): void;
  error(record: Record<string, unknown>): void;
}

/** Calls the fixed database routine; retention rules remain owned by PostgreSQL. */
export class PostgresAuditRetentionCleanup implements AuditRetentionCleanup {
  constructor(private readonly sql: postgres.Sql) {}

  async purgeExpiredAuditLogs(): Promise<AuditRetentionResult> {
    const rows = await this.sql<RawAuditRetentionResult[]>`
      select
        acquired_lock as "lockAcquired",
        deleted_count as "deletedCount"
      from public.purge_expired_audit_logs()
    `;
    const result = rows[0];

    if (!result) {
      throw new Error("A limpeza de auditoria não retornou resultado.");
    }

    return result;
  }
}

function databaseErrorCode(error: unknown): string | null {
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

/** Emits aggregate operational state and preserves failures for the scheduler. */
export async function runAuditRetentionCleanup(
  cleanup: AuditRetentionCleanup,
  logger: AuditRetentionLogger,
): Promise<AuditRetentionResult> {
  const startedAt = performance.now();

  try {
    const result = await cleanup.purgeExpiredAuditLogs();

    logger.info({
      event: result.lockAcquired
        ? "audit_retention.completed"
        : "audit_retention.skipped",
      lockAcquired: result.lockAcquired,
      deletedCount: result.deletedCount,
      durationMs: Math.round(performance.now() - startedAt),
    });

    return result;
  } catch (error) {
    logger.error({
      event: "audit_retention.failed",
      code: databaseErrorCode(error),
      durationMs: Math.round(performance.now() - startedAt),
    });
    throw error;
  }
}
