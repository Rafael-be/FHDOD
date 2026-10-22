import type postgres from "postgres";
import { PostgresAuthRepository } from "../../src/modules/auth/auth.repository.js";

function repositoryReturning(row: object): PostgresAuthRepository {
  const sql = (() => Promise.resolve([row])) as unknown as postgres.Sql;
  return new PostgresAuthRepository(sql);
}

describe("PostgresAuthRepository timestamp normalization", () => {
  const base = { id: "11111111-1111-4111-8111-111111111111", userId: 1, csrfToken: "csrf", createdAt: "2026-01-01T00:00:00.123Z", expiresAt: "2026-01-02T00:00:00.456Z", revokedAt: null };

  it("normalizes textual session timestamps before authentication services receive them", async () => {
    const session = await repositoryReturning({ ...base, lastUsedAt: "2026-01-01T01:00:00.789Z", role: "superuser", deletedAt: null, mustChangePassword: false }).findAuthenticatedSession(base.id);
    expect(session?.createdAt).toBeInstanceOf(Date);
    expect(session?.lastUsedAt).toBeInstanceOf(Date);
    expect(session?.expiresAt).toBeInstanceOf(Date);
    expect(session?.lastUsedAt?.toISOString()).toBe("2026-01-01T01:00:00.789Z");
  });

  it("preserves a null last-used timestamp for newly created sessions", async () => {
    const session = await repositoryReturning({ ...base, lastUsedAt: null }).findSession(base.id);
    expect(session?.lastUsedAt).toBeNull();
    expect(session?.createdAt).toBeInstanceOf(Date);
  });

  it("rejects malformed timestamps instead of exposing a value that will fail later in authentication", async () => {
    await expect(repositoryReturning({ ...base, lastUsedAt: "not-a-timestamp" }).findSession(base.id)).rejects.toThrow("auth_sessions.last_used_at");
  });

  it("normalizes temporary-password and refresh-token expiry timestamps", async () => {
    const user = await repositoryReturning({ id: 1, email: "test@example.test", passwordHash: "hash", role: "superuser", deletedAt: null, mustChangePassword: true, temporaryPasswordExpiresAt: "2026-01-03T00:00:00.000Z" }).findUserById(1);
    const refresh = await repositoryReturning({ id: base.id, sessionId: base.id, tokenHash: "hash", expiresAt: "2026-01-02T00:00:00.456Z", consumedAt: "2026-01-01T02:00:00.000Z" }).findRefresh("hash");
    expect(user?.temporaryPasswordExpiresAt).toBeInstanceOf(Date);
    expect(refresh?.expiresAt).toBeInstanceOf(Date);
    expect(refresh?.consumedAt).toBeInstanceOf(Date);
  });
});
