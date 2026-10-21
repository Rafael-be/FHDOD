import "dotenv/config";
import argon2 from "argon2";
import postgres from "postgres";
import { loadConfig } from "../../config/env.js";

const required = ["INITIAL_SUPERUSER_NAME", "INITIAL_SUPERUSER_EMAIL", "INITIAL_SUPERUSER_PASSWORD"] as const;
async function seed(): Promise<void> {
  const config = loadConfig();
  const missing = required.filter((key) => !process.env[key]?.trim());
  if (missing.length) throw new Error(`Seed requer ${missing.join(", ")}.`);
  const sql = postgres(config.DATABASE_URL_MIGRATIONS, { max: 1 });
  const name = process.env.INITIAL_SUPERUSER_NAME!.trim(), email = process.env.INITIAL_SUPERUSER_EMAIL!.trim().toLocaleLowerCase("pt-BR"), password = process.env.INITIAL_SUPERUSER_PASSWORD!;
  try { await sql.begin(async (tx) => { const role = await tx<{ id: number }[]>`select id from roles where code='superuser'`; if (!role[0]) throw new Error("Papel superuser ausente: aplique o bootstrap primeiro."); const existing = await tx<{ id: number }[]>`select id from users where lower(btrim(email))=lower(btrim(${email}))`; let userId = existing[0]?.id; if (!userId) { const passwordHash = await argon2.hash(password, { type: argon2.argon2id, memoryCost: 19456, timeCost: 2, parallelism: 1, hashLength: 32 }); const inserted = await tx<{ id: number }[]>`insert into users(role_id,full_name,email,password_hash,must_change_password,created_at,updated_at) values(${role[0].id},${name},${email},${passwordHash},false,now(),now()) returning id`; userId = inserted[0]!.id; } const page = await tx<{ id: number }[]>`insert into content_pages(slug,title,created_by_user_id,created_at,updated_at) values('lgpd','Política de Privacidade',${userId},now(),now()) on conflict(slug) do update set slug=excluded.slug returning id`; await tx`insert into content_page_versions(page_id,version_number,content,is_current,created_by_user_id,created_at,published_at) select ${page[0]!.id},1,'',true,${userId},now(),now() where not exists (select 1 from content_page_versions where page_id=${page[0]!.id})`; }); console.info("Seed inicial concluído sem expor credenciais."); } finally { await sql.end({ timeout: 5 }); }
}
void seed();
