import request from "supertest";
import { jest } from "@jest/globals";
import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import type { AuthRepository } from "../../src/modules/auth/auth.repository.js";
import { AuthService } from "../../src/modules/auth/auth.service.js";
import type { AdminService } from "../../src/modules/admin/admin.service.js";
import type { AuditService } from "../../src/modules/audit/audit.service.js";
import type { ContentService } from "../../src/modules/content/content.service.js";
import type { HealthService } from "../../src/modules/health/health.service.js";
import type { Clock } from "../../src/shared/core.js";

const config: AppConfig = { NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://api:pass@localhost/fhdod", ALLOWED_ORIGIN: "http://localhost:5173", JWT_SECRET: "12345678901234567890123456789012", JWT_ISSUER: "fhdod-api", JWT_AUDIENCE: "fhdod-web", PERFORMANCE_MEASUREMENTS: false };
const repository: AuthRepository = {
  transaction: async (work) => work(repository), findUserByEmail: async () => null, findUserById: async () => null, lockUser: async () => null, findSession: async () => null, findAuthenticatedSession: async () => null, findRefresh: async () => null,
  revokeUserSessions: async () => undefined, createSession: async () => undefined, createRefresh: async () => undefined, consumeRefresh: async () => false, linkRefreshReplacement: async () => undefined, revokeSession: async () => undefined, touchSession: async () => undefined, changePassword: async () => undefined, changeEmail: async () => undefined,
};
const clock: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };
const app = createApp(config, {
  authService: new AuthService(repository, clock, config),
});

function runtimeDependencies() {
  return {
    authService: new AuthService(repository, clock, config),
    adminService: {} as AdminService,
    auditService: {} as AuditService,
    healthService: {
      live: () => ({ status: "ok" as const }),
    } as HealthService,
    contentService: {} as ContentService,
  };
}

describe("HTTP boundary", () => {
  it("exposes health and allows only the configured CORS origin", async () => {
    await request(app).get("/health").set("Origin", config.ALLOWED_ORIGIN).expect(200).expect("access-control-allow-origin", config.ALLOWED_ORIGIN).expect({ data: { status: "ok" } });
    const response = await request(app).get("/health").set("Origin", "https://untrusted.example").expect(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("authorizes PUT preflight only for the configured CORS origin", async () => {
    const preflight = await request(app)
      .options("/api/pages/")
      .set("Origin", config.ALLOWED_ORIGIN)
      .set("Access-Control-Request-Method", "PUT")
      .expect(204)
      .expect("access-control-allow-origin", config.ALLOWED_ORIGIN);

    expect(preflight.headers["access-control-allow-methods"])
      .toContain("PUT");

    const untrusted = await request(app)
      .options("/api/pages/")
      .set("Origin", "https://untrusted.example")
      .set("Access-Control-Request-Method", "PUT");

    expect(untrusted.headers["access-control-allow-origin"]).toBeUndefined();
    expect(untrusted.headers["access-control-allow-methods"]).toBeUndefined();
  });

  it("writes a safe completion log for successful development requests", async () => {
    const stdoutWrite = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await request(createApp({ ...config, NODE_ENV: "development" }, runtimeDependencies()))
        .get("/health")
        .expect(200);
      const output = String(stdoutWrite.mock.calls.at(-1)?.[0]);
      expect(output).toContain('"event":"http.request_completed"');
      expect(output).toContain('"operation":"GET /health"');
      expect(output).toContain('"status":200');
      expect(output).not.toContain("cookie");
      expect(output).not.toContain("authorization");
    } finally {
      stdoutWrite.mockRestore();
    }
  });

  it("rejects missing application modules outside the test environment", () => {
    expect(() => createApp({ ...config, NODE_ENV: "development" }, {
      authService: new AuthService(repository, clock, config),
    })).toThrow("adminService, auditService, healthService, contentService");
  });

  it("returns the documented validation envelope for invalid input", async () => {
    await request(app).post("/api/auth/login").send({ email: "not-an-email" }).expect(400).expect({ error: { code: "VALIDATION_ERROR", message: "Dados de entrada inválidos." } });
  });

  it("returns client errors for malformed JSON and oversized JSON bodies", async () => {
    await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send('{"email":')
      .expect(400)
      .expect({ error: { code: "INVALID_JSON", message: "JSON inválido." } });

    await request(app)
      .post("/api/auth/login")
      .set("Content-Type", "application/json")
      .send({ padding: "x".repeat(33 * 1024) })
      .expect(413)
      .expect({ error: { code: "PAYLOAD_TOO_LARGE", message: "Corpo da requisição excede o limite permitido." } });
  });

  it("limits failed logins by IP even when identifiers change", async () => {
    for (let index = 0; index < 5; index += 1) await request(app).post("/api/auth/login").send({ email: `unknown-${index}@hospital.test`, password: "invalid-password" }).expect(401);
    await request(app).post("/api/auth/login").send({ email: "other@hospital.test", password: "invalid-password" }).expect(429).expect({ error: { code: "LOGIN_FAILED_RATE_LIMITED", message: "Muitas tentativas. Aguarde alguns minutos." } });
  });

  it("returns the standard not-found envelope for unmatched routes", async () => {
    await request(app).get("/api/does-not-exist").expect(404).expect({ error: { code: "NOT_FOUND", message: "Recurso não encontrado." } });
  });

  it("serves the OpenAPI interface", async () => {
    await request(app).get("/api-docs/").expect(200).expect("content-type", /html/);
  });

  it("logs internal failures without exposing sensitive values", async () => {
    const stderrWrite = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    const failingRepository: AuthRepository = { ...repository, findUserByEmail: async () => { throw Object.assign(new Error("password=senha-super-secreta token=abc123 email=person@example.com"), { code: "23505" }); } };
    const failingApp = createApp(config, {
      authService: new AuthService(failingRepository, clock, config),
    });
    try {
      await request(failingApp).post("/api/auth/login").send({ email: "person@example.com", password: "senha-super-secreta" }).expect(500).expect({ error: { code: "INTERNAL_ERROR", message: "Ocorreu um erro interno." } });
      const output = stderrWrite.mock.calls.at(-1)?.[0];
      expect(typeof output).toBe("string");
      expect(output).toContain('"code":"23505"');
      expect(output).toContain("POST /api/auth/login");
      expect(output).toContain('"stack":');
      expect(output).not.toContain("senha-super-secreta");
      expect(output).not.toContain("abc123");
      expect(output).not.toContain("person@example.com");
    } finally {
      stderrWrite.mockRestore();
    }
  });
});
