import "dotenv/config";
import postgres from "postgres";
import { loadAuditRetentionConfig } from "../config/env.js";
import {
  PostgresAuditRetentionCleanup,
  runAuditRetentionCleanup,
  type AuditRetentionLogger,
} from "./audit-retention.js";

const logger: AuditRetentionLogger = {
  info(record) {
    console.info(JSON.stringify(record));
  },
  error(record) {
    console.error(JSON.stringify(record));
  },
};

async function main(): Promise<void> {
  const config = loadAuditRetentionConfig();
  const sql = postgres(config.AUDIT_RETENTION_DATABASE_URL, {
    max: 1,
    prepare: false,
  });

  try {
    await runAuditRetentionCleanup(
      new PostgresAuditRetentionCleanup(sql),
      logger,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}

void main().catch((error: unknown) => {
  const code = (error as { code?: unknown }).code;

  logger.error({
    event: "audit_retention.process_failed",
    code: typeof code === "string" ? code : null,
  });
  process.exitCode = 1;
});
