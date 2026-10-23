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
});

const migrationConfigSchema = z.object({
  DATABASE_URL_MIGRATIONS: z.string().url(),
});

export type AppConfig = z.infer<typeof runtimeConfigSchema>;
export type MigrationConfig = z.infer<typeof migrationConfigSchema>;

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
