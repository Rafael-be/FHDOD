import "dotenv/config";
import argon2 from "argon2";
import postgres from "postgres";
import { z } from "zod";
import { loadConfig } from "../../config/env.js";
import { normalizeEmail } from "../../shared/core.js";

const required = ["INITIAL_SUPERUSER_NAME", "INITIAL_SUPERUSER_EMAIL", "INITIAL_SUPERUSER_PASSWORD"] as const;

const initialSeedSchema = z.object({
  name: z.string().trim().min(2).max(160),
  email: z.string().email().max(254),
  password: z.string().min(12).max(256),
});

export interface InitialSeedInput {
  name: string;
  email: string;
  password: string;
}

interface ExistingUser {
  id: number;
  role: string;
}

function parseInitialSeedInput(input: InitialSeedInput) {
  const parsed = initialSeedSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error("Credenciais iniciais inválidas: informe nome, e-mail e senha temporária de ao menos 12 caracteres.");
  }

  return {
    ...parsed.data,
    email: normalizeEmail(parsed.data.email),
  };
}

/** Runs inside a caller-owned transaction and creates only the initial superuser and an unpublished LGPD placeholder. */
export async function seedInitialData(
  sql: postgres.Sql,
  input: InitialSeedInput,
): Promise<{ createdUser: boolean; createdLgpdPage: boolean }> {
  const seed = parseInitialSeedInput(input);
  const role = await sql<{ id: number }[]>`select id from roles where code = 'superuser'`;
  if (!role[0]) {
    throw new Error("Papel superuser ausente: aplique o bootstrap primeiro.");
  }

  const existing = await sql<ExistingUser[]>`
    select u.id, r.code as role
    from users u
    join roles r on r.id = u.role_id
    where lower(btrim(u.email)) = lower(btrim(${seed.email}))
  `;

  const existingUser = existing[0];
  if (existingUser && existingUser.role !== "superuser") {
    throw new Error("O e-mail inicial já pertence a uma conta que não é superusuária.");
  }

  let userId = existingUser?.id;
  const createdUser = !userId;

  if (!userId) {
    const passwordHash = await argon2.hash(seed.password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    });
    const inserted = await sql<{ id: number }[]>`
      insert into users (
        role_id, full_name, email, password_hash, must_change_password,
        temporary_password_expires_at, created_at, updated_at
      )
      values (${role[0].id}, ${seed.name}, ${seed.email}, ${passwordHash}, true, now() + interval '48 hours', now(), now())
      returning id
    `;
    userId = inserted[0]!.id;
  }

  const createdPage = await sql<{ id: number }[]>`
    insert into content_pages (slug, title, created_by_user_id, created_at, updated_at)
    values ('lgpd', 'Política de Privacidade', ${userId}, now(), now())
    on conflict (slug) do nothing
    returning id
  `;
  const page = createdPage[0] ?? (
    await sql<{ id: number }[]>`select id from content_pages where slug = 'lgpd'`
  )[0];

  if (!page) {
    throw new Error("Não foi possível criar ou localizar a página LGPD.");
  }

  await sql`
    insert into content_page_versions (
      page_id, version_number, content, is_current, created_by_user_id, created_at, published_at
    )
    select ${page.id}, 1, '', true, ${userId}, now(), now()
    where not exists (select 1 from content_page_versions where page_id = ${page.id})
  `;

  return {
    createdUser,
    createdLgpdPage: createdPage.length === 1,
  };
}

export async function runInitialSeed(): Promise<void> {
  const config = loadConfig();
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) {
    throw new Error(`Seed requer ${missing.join(", ")}.`);
  }

  const sql = postgres(config.DATABASE_URL_MIGRATIONS, { max: 1 });
  const input: InitialSeedInput = {
    name: process.env.INITIAL_SUPERUSER_NAME!,
    email: process.env.INITIAL_SUPERUSER_EMAIL!,
    password: process.env.INITIAL_SUPERUSER_PASSWORD!,
  };

  try {
    await sql.begin((transaction) => seedInitialData(transaction as unknown as postgres.Sql, input));
    console.info("Seed inicial concluído sem expor credenciais.");
  } finally {
    await sql.end({ timeout: 5 });
  }
}

if (process.argv[1]?.endsWith("initial-seed.ts") || process.argv[1]?.endsWith("initial-seed.js")) {
  void runInitialSeed();
}
