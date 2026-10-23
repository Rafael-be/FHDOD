import argon2 from "argon2";
import { jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import type { AdminService } from "../../src/modules/admin/admin.service.js";
import type { AuthRepository, AuthUser, RefreshToken, Session } from "../../src/modules/auth/auth.repository.js";
import { AuthService } from "../../src/modules/auth/auth.service.js";
import type { Clock } from "../../src/shared/core.js";

const config: AppConfig = { NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://api:pass@localhost/fhdod", ALLOWED_ORIGIN: "http://localhost:5173", JWT_SECRET: "12345678901234567890123456789012", JWT_ISSUER: "fhdod-api", JWT_AUDIENCE: "fhdod-web", PERFORMANCE_MEASUREMENTS: false };
class Repository implements AuthRepository {
  sessions = new Map<string, Session>(); refreshes = new Map<string, RefreshToken>();
  constructor(readonly user: AuthUser) {}
  async transaction<T>(work: (repository: AuthRepository) => Promise<T>) { return work(this); } async findUserByEmail(email: string) { return email === this.user.email ? this.user : null; } async findUserById(id: number) { return id === this.user.id ? this.user : null; } async lockUser(id: number) { return id === this.user.id ? this.user : null; }
  async findSession(id: string) { return this.sessions.get(id) ?? null; } async findAuthenticatedSession(id: string) { const session = this.sessions.get(id); return session ? { ...session, role: this.user.role, deletedAt: this.user.deletedAt, mustChangePassword: this.user.mustChangePassword } : null; } async findRefresh(hash: string) { return [...this.refreshes.values()].find((token) => token.tokenHash === hash) ?? null; }
  async revokeUserSessions(userId: number, at: Date) { for (const session of this.sessions.values()) if (session.userId === userId && !session.revokedAt) session.revokedAt = at; } async createSession(session: Session) { this.sessions.set(session.id, session); } async createRefresh(token: RefreshToken) { this.refreshes.set(token.id, token); } async consumeRefresh(id: string, at: Date) { const token = this.refreshes.get(id); if (!token || token.consumedAt) return false; token.consumedAt = at; return true; } async linkRefreshReplacement(): Promise<void> {} async revokeSession(id: string, at: Date) { const session = this.sessions.get(id); if (session) session.revokedAt = at; } async touchSession(): Promise<void> {} async changePassword(): Promise<void> {} async changeEmail(): Promise<void> {}
}
const clock: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };

describe("administrative HTTP contracts", () => {
  it("requires a current superuser and CSRF token for manager creation", async () => {
    const hash = await argon2.hash("superuser-password");
    const repository = new Repository({ id: 1, email: "admin@hospital.test", passwordHash: hash, role: "superuser", deletedAt: null, mustChangePassword: false, temporaryPasswordExpiresAt: null });
    const auth = new AuthService(repository, clock, config);
    const received: unknown[] = [];
    const admin = { listManagers: async () => [{ id: 2, fullName: "Gestor", email: "gestor@hospital.test" }], createManager: async (...args: unknown[]) => { received.push(args); return { id: 2, fullName: "Novo gestor", email: "novo@hospital.test" }; } } as unknown as AdminService;
    const app = createApp(config, auth, admin);
    await request(app).get("/api/managers").expect(401).expect({ error: { code: "UNAUTHENTICATED", message: "Autenticação necessária." } });
    const login = await auth.login("admin@hospital.test", "superuser-password");
    const cookies = [`access_token=${login.accessToken}`, `refresh_token=${login.refreshToken}`];
    await request(app).get("/api/managers").set("Cookie", cookies).expect(200).expect({ data: [{ id: 2, fullName: "Gestor", email: "gestor@hospital.test" }] });
    const body = { fullName: "Novo gestor", email: "novo@hospital.test", temporaryPassword: "temporary-password", sectorIds: [] };
    await request(app).post("/api/managers").set("Cookie", cookies).send(body).expect(403).expect({ error: { code: "CSRF_INVALID", message: "Token CSRF inválido." } });
    await request(app).post("/api/managers").set("Cookie", cookies).set("x-csrf-token", login.csrfToken).send(body).expect(201).expect({ data: { id: 2, fullName: "Novo gestor", email: "novo@hospital.test" } });
    expect(received).toHaveLength(1);
  });

  it("uses the authenticated session CSRF token for sectors without a refresh cookie", async () => {
    const hash = await argon2.hash("superuser-password");
    const repository = new Repository({ id: 1, email: "admin@hospital.test", passwordHash: hash, role: "superuser", deletedAt: null, mustChangePassword: false, temporaryPasswordExpiresAt: null });
    const auth = new AuthService(repository, clock, config);
    const createSector = jest.fn(async () => ({ id: 1, code: "ER", name: "Emergência" }));
    const app = createApp(config, auth, { createSector } as unknown as AdminService);
    const login = await auth.login("admin@hospital.test", "superuser-password");
    const accessCookie = `access_token=${login.accessToken}`;
    const body = { code: "ER", name: "Emergência" };

    await request(app).post("/api/sectors").set("Cookie", accessCookie).send(body).expect(403).expect({ error: { code: "CSRF_INVALID", message: "Token CSRF inválido." } });
    await request(app).post("/api/sectors").set("Cookie", accessCookie).set("x-csrf-token", "incorrect").send(body).expect(403).expect({ error: { code: "CSRF_INVALID", message: "Token CSRF inválido." } });
    await request(app).post("/api/sectors").set("Cookie", accessCookie).set("x-csrf-token", login.csrfToken).send(body).expect(201);
    await request(app).post("/api/sectors").set("x-csrf-token", login.csrfToken).send(body).expect(401).expect({ error: { code: "UNAUTHENTICATED", message: "Autenticação necessária." } });

    expect(createSector).toHaveBeenCalledTimes(1);
  });
});
