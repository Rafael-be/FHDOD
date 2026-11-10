import { z } from "zod";

const runtimeConfigSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  ALLOWED_ORIGIN: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET deve ter pelo menos 32 caracteres"),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
  PERFORMANCE_MEASUREMENTS: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  CACHE_ENABLED: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  REDIS_URL: z.string().url().default("redis://127.0.0.1:6379"),
  CACHE_QUESTIONS_TTL_SECONDS: z.coerce.number().int().min(30).max(120).default(60),
  SECURITY_REDIS_ENABLED: z.enum(["true", "false"]).default("true").transform((value) => value === "true"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
  RATE_LIMIT_LOGIN_PER_IP: z.coerce.number().int().min(5).max(500).default(30),
  RATE_LIMIT_ADMIN_PER_IP: z.coerce.number().int().min(10).max(2_000).default(300),
  RATE_LIMIT_SUBMISSION_PER_IP: z.coerce.number().int().min(30).max(2_000).default(180),
  LOGIN_FAILURE_LIMIT_PER_IP: z.coerce.number().int().min(3).max(50).default(5),
  LOGIN_FAILURE_LIMIT_PER_IDENTIFIER: z.coerce.number().int().min(3).max(50).default(5),
  LOGIN_BLOCK_BASE_SECONDS: z.coerce.number().int().min(1).max(300).default(1),
  LOGIN_BLOCK_MAX_SECONDS: z.coerce.number().int().min(5).max(3_600).default(60),
});

const migrationConfigSchema = z.object({
  DATABASE_URL_MIGRATIONS: z.string().url(),
});

const auditRetentionConfigSchema = z.object({
  AUDIT_RETENTION_DATABASE_URL: z.string().url().superRefine((value, context) => {
    const username = new URL(value).username;

    if (username !== "fhdod_audit_maintenance") {
      context.addIssue({
        code: "custom",
        message: "AUDIT_RETENTION_DATABASE_URL deve usar fhdod_audit_maintenance",
      });
    }
  }),
});

export type AppConfig = z.infer<typeof runtimeConfigSchema>;
export type MigrationConfig = z.infer<typeof migrationConfigSchema>;
export type AuditRetentionConfig = z.infer<typeof auditRetentionConfigSchema>;

function parseConfig<T>(schema: z.ZodType<T>, source: NodeJS.ProcessEnv): T {
  const result = schema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Configuração inválida: verifique ${fields}.`);
  }

  return result.data;
}

/** Validates only credentials required by the running HTTP service. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  return parseConfig(runtimeConfigSchema, source);
}

/** Validates administrative credentials used exclusively by offline operations. */
export function loadMigrationConfig(source: NodeJS.ProcessEnv = process.env): MigrationConfig {
  return parseConfig(migrationConfigSchema, source);
}

/** Validates the dedicated, non-runtime credential used by the retention job. */
export function loadAuditRetentionConfig(
  source: NodeJS.ProcessEnv = process.env,
): AuditRetentionConfig {
  return parseConfig(auditRetentionConfigSchema, source);
}
