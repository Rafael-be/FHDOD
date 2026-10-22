import "dotenv/config";
import { randomUUID } from "node:crypto";
import argon2 from "argon2";
import postgres from "postgres";
import request from "supertest";
import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import { PostgresAuthRepository } from "../../src/modules/auth/auth.repository.js";
import { AuthService } from "../../src/modules/auth/auth.service.js";
import { SystemClock } from "../../src/shared/core.js";

const testUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL;
const integration = testUrl && runtimeUrl && new URL(testUrl).href !== new URL(runtimeUrl).href ? describe : describe.skip;
const config: AppConfig = { NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://test:pass@localhost/fhdod_test", DATABASE_URL_MIGRATIONS: "postgres://admin:pass@localhost/fhdod_test", ALLOWED_ORIGIN: "http://localhost:5173", JWT_SECRET: "12345678901234567890123456789012", JWT_ISSUER: "fhdod-api", JWT_AUDIENCE: "fhdod-web" };

integration("authentication lifecycle PostgreSQL integration", () => {
  it("persists, validates, revokes and renews a temporary-password session", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const email = `auth-lifecycle-${randomUUID().slice(0, 12)}@test.invalid`;
    try {
      const [role] = await sql<{ id: number }[]>`select id from roles where code = 'superuser'`;
      const passwordHash = await argon2.hash("temporary-password", { type: argon2.argon2id });
      const [user] = await sql<{ id: number }[]>`insert into users (role_id, full_name, email, password_hash, must_change_password, temporary_password_expires_at, created_at, updated_at) values (${role!.id}, 'Authentication lifecycle', ${email}, ${passwordHash}, true, now() + interval '1 day', now(), now()) returning id`;
      const auth = new AuthService(new PostgresAuthRepository(sql), new SystemClock(), config);
      const agent = request.agent(createApp(config, auth));

      await agent.post("/api/auth/login").send({ email, password: "temporary-password" }).expect(200);
      const csrf = await agent.get("/api/auth/csrf").expect(200);
      expect(csrf.body.data.csrfToken).toEqual(expect.any(String));
      const [persisted] = await sql<{ active: number; refreshes: number }[]>`select count(s.id) filter (where s.revoked_at is null)::int as active, (select count(*)::int from auth_refresh_tokens t join auth_sessions rs on rs.id=t.session_id where rs.user_id=${user!.id}) as refreshes from auth_sessions s where s.user_id=${user!.id}`;
      expect(persisted).toEqual({ active: 1, refreshes: 1 });

      await agent.post("/api/auth/change-temporary-password").set("X-CSRF-Token", csrf.body.data.csrfToken).send({ currentPassword: "temporary-password", newPassword: "replacement-password" }).expect(204);
      const [revoked] = await sql<{ active: number }[]>`select count(*) filter (where revoked_at is null)::int as active from auth_sessions where user_id=${user!.id}`;
      expect(revoked!.active).toBe(0);

      await agent.post("/api/auth/login").send({ email, password: "replacement-password" }).expect(200);
      const refreshed = await agent.post("/api/auth/refresh").expect(200);
      await agent.post("/api/auth/logout").set("X-CSRF-Token", refreshed.body.data.csrfToken).expect(204);
      const [afterLogout] = await sql<{ active: number }[]>`select count(*) filter (where revoked_at is null)::int as active from auth_sessions where user_id=${user!.id}`;
      expect(afterLogout!.active).toBe(0);
    } finally {
      await sql`delete from auth_refresh_tokens where session_id in (select id from auth_sessions where user_id in (select id from users where email=${email}))`;
      await sql`delete from auth_sessions where user_id in (select id from users where email=${email})`;
      await sql`delete from users where email=${email}`;
      await sql.end({ timeout: 5 });
    }
  }, 30_000);
});
