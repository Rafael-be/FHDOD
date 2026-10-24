import argon2 from "argon2";
import request from "supertest";
import { createApp } from "../../src/app.js";
import type { AuditService } from "../../src/modules/audit/audit.service.js";
import type { ContentService } from "../../src/modules/content/content.service.js";
import type { AppConfig } from "../../src/config/env.js";
import type { AuthRepository, AuthUser, RefreshToken, Session } from "../../src/modules/auth/auth.repository.js";
import { AuthService } from "../../src/modules/auth/auth.service.js";
import type { Clock } from "../../src/shared/core.js";

const config: AppConfig = { NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://api:pass@localhost/fhdod", ALLOWED_ORIGIN: "http://localhost:5173", JWT_SECRET: "12345678901234567890123456789012", JWT_ISSUER: "fhdod-api", JWT_AUDIENCE: "fhdod-web", PERFORMANCE_MEASUREMENTS: false };
class Repository implements AuthRepository {
  sessions = new Map<string, Session>(); refreshes = new Map<string, RefreshToken>();
  constructor(readonly user: AuthUser) {}
  async transaction<T>(work: (repository: AuthRepository) => Promise<T>) { return work(this); } async findUserByEmail(email: string) { return email === this.user.email ? this.user : null; } async findUserById(id: number) { return id === this.user.id ? this.user : null; } async lockUser(id: number) { return id === this.user.id ? this.user : null; } async findSession(id: string) { return this.sessions.get(id) ?? null; } async findAuthenticatedSession(id: string) { const session = this.sessions.get(id); return session ? { ...session, role: this.user.role, deletedAt: this.user.deletedAt, mustChangePassword: this.user.mustChangePassword } : null; } async findRefresh(hash: string) { return [...this.refreshes.values()].find((token) => token.tokenHash === hash) ?? null; }
  async revokeUserSessions(userId: number, at: Date) { for (const session of this.sessions.values()) if (session.userId === userId && !session.revokedAt) session.revokedAt = at; } async createSession(session: Session) { this.sessions.set(session.id, session); } async createRefresh(token: RefreshToken) { this.refreshes.set(token.id, token); } async consumeRefresh(id: string, at: Date) { const token = this.refreshes.get(id); if (!token || token.consumedAt) return false; token.consumedAt = at; return true; } async linkRefreshReplacement(): Promise<void> {} async revokeSession(id: string, at: Date) { const session = this.sessions.get(id); if (session) session.revokedAt = at; } async touchSession(): Promise<void> {} async changePassword(): Promise<void> {} async changeEmail(): Promise<void> {}
}
const clock: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };

describe("content and audit HTTP contracts", () => {
  it("keeps LGPD public while protecting publishing and audit access", async () => {
    const hash = await argon2.hash("superuser-password");
    const repository = new Repository({ id: 1, fullName: "Admin", email: "admin@hospital.test", passwordHash: hash, role: "superuser", deletedAt: null, mustChangePassword: false, temporaryPasswordExpiresAt: null });
    const auth = new AuthService(repository, clock, config);
    const published: unknown[] = [];
    const content = { getPublished: async () => ({ slug: "lgpd", title: "Privacidade", content: "Texto público", versionNumber: 1, publishedAt: "2026-01-01" }), publish: async (...args: unknown[]) => { published.push(args); return { slug: "lgpd", title: "Privacidade", content: "Texto atualizado", versionNumber: 2, publishedAt: "2026-01-02" }; } } as unknown as ContentService;
    const audit = { list: async () => ({ records: [], nextCursor: null }) } as unknown as AuditService;
    const app = createApp(config, {
      authService: auth,
      auditService: audit,
      contentService: content,
    });
    await request(app).get("/api/pages/lgpd").expect(200).expect({ data: { slug: "lgpd", title: "Privacidade", content: "Texto público", versionNumber: 1, publishedAt: "2026-01-01" } });
    await request(app).get("/api/audit-logs").expect(401);
    const login = await auth.login("admin@hospital.test", "superuser-password"); const cookies = [`access_token=${login.accessToken}`, `refresh_token=${login.refreshToken}`];
    repository.user.role = "sector_manager";
    await request(app).get("/api/audit-logs").set("Cookie", cookies).expect(403);
    repository.user.role = "superuser";
    await request(app).put("/api/pages/lgpd").set("Cookie", cookies).send({ title: "Privacidade", content: "Texto atualizado" }).expect(403);
    await request(app).put("/api/pages/lgpd").set("Cookie", cookies).set("x-csrf-token", login.csrfToken).send({ title: "Privacidade", content: "Texto atualizado" }).expect(200).expect({ data: { slug: "lgpd", title: "Privacidade", content: "Texto atualizado", versionNumber: 2, publishedAt: "2026-01-02" } });
    expect(published).toHaveLength(1);
  });
});
