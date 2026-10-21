import { z } from "zod";

const environmentSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().max(65535).default(3000),
  DATABASE_URL: z.string().url(),
  DATABASE_URL_MIGRATIONS: z.string().url(),
  ALLOWED_ORIGIN: z.string().url(),
  JWT_SECRET: z.string().min(32, "JWT_SECRET deve ter pelo menos 32 caracteres"),
  JWT_ISSUER: z.string().min(1),
  JWT_AUDIENCE: z.string().min(1),
});

export type AppConfig = z.infer<typeof environmentSchema>;

/** Validates configuration without ever echoing secret values. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const result = environmentSchema.safeParse(source);
  if (!result.success) {
    const fields = result.error.issues.map((issue) => issue.path.join(".")).join(", ");
    throw new Error(`Configuração inválida: verifique ${fields}.`);
  }
  return result.data;
}
