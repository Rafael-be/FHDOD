import "dotenv/config";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { PostgresAuthRepository } from "../../src/modules/auth/auth.repository.js";
import { testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";

const testUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const integration = usesIsolatedDatabase(testUrl, runtimeUrl) ? describe : describe.skip;

integration("PostgresAuthRepository refresh consumption", () => {
  it("consumes a token when application time predates database issuance", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 12);
    const userEmail = `refresh-order-${suffix}@test.invalid`;
    const sessionId = randomUUID();
    const refreshId = randomUUID();

    try {
      await expect(sql.begin(async (transaction) => {
        const [role] = await transaction<{ id: number }[]>`
          select id from roles where code = 'superuser'
        `;
        if (!role) {
          throw new Error("TEST_SUPERUSER_ROLE_MISSING");
        }

        const [user] = await transaction<{ id: number }[]>`
          insert into users (role_id, full_name, email, password_hash, created_at, updated_at)
          values (${role.id}, 'Refresh order test', ${userEmail}, 'test-hash', now(), now())
          returning id
        `;
        if (!user) {
          throw new Error("TEST_USER_CREATION_FAILED");
        }

        const applicationNow = new Date();
        await transaction`
          insert into auth_sessions (id, user_id, csrf_token, created_at, expires_at)
          values (${sessionId}, ${user.id}, ${"x".repeat(32)}, now(), now() + interval '1 day')
        `;

        const repository = new PostgresAuthRepository(
          transaction as unknown as postgres.Sql,
        );
        await repository.createRefresh({
          id: refreshId,
          sessionId,
          tokenHash: `hash-${refreshId}`,
          expiresAt: new Date(applicationNow.getTime() + 86_400_000),
          consumedAt: null,
        });

        expect(await repository.consumeRefresh(
          refreshId,
          new Date(applicationNow.getTime() - 60_000),
        )).toBe(true);
        expect(await repository.consumeRefresh(refreshId, applicationNow)).toBe(false);

        const [token] = await transaction<{ valid: boolean }[]>`
          select consumed_at >= issued_at as valid
          from auth_refresh_tokens
          where id = ${refreshId}
        `;
        expect(token?.valid).toBe(true);

        throw new Error("ROLLBACK_REFRESH_CONSUMPTION");
      })).rejects.toThrow("ROLLBACK_REFRESH_CONSUMPTION");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
