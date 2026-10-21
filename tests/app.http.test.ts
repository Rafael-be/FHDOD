import request from "supertest";
import { createApp } from "../src/app.js";
import type { AppConfig } from "../src/config/env.js";
import type { AuthRepository } from "../src/modules/auth/auth.repository.js";
import { AuthService } from "../src/modules/auth/auth.service.js";
import type { Clock } from "../src/shared/core.js";

const config: AppConfig = { NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://api:pass@localhost/fhdod", DATABASE_URL_MIGRATIONS: "postgres://admin:pass@localhost/fhdod", ALLOWED_ORIGIN: "http://localhost:5173", JWT_SECRET: "12345678901234567890123456789012", JWT_ISSUER: "fhdod-api", JWT_AUDIENCE: "fhdod-web" };
const repository: AuthRepository = {
  transaction: async (work) => work(repository), findUserByEmail: async () => null, findUserById: async () => null, findSession: async () => null, findRefresh: async () => null,
  revokeUserSessions: async () => undefined, createSession: async () => undefined, createRefresh: async () => undefined, consumeRefresh: async () => false, revokeSession: async () => undefined, touchSession: async () => undefined, changePassword: async () => undefined, changeEmail: async () => undefined,
};
const clock: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };
const app = createApp(config, new AuthService(repository, clock, config));

describe("HTTP boundary", () => {
  it("exposes health and allows only the configured CORS origin", async () => {
    await request(app).get("/health").set("Origin", config.ALLOWED_ORIGIN).expect(200).expect("access-control-allow-origin", config.ALLOWED_ORIGIN).expect({ data: { status: "ok" } });
    const response = await request(app).get("/health").set("Origin", "https://untrusted.example").expect(200);
    expect(response.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("returns the documented validation envelope for invalid input", async () => {
    await request(app).post("/api/auth/login").send({ email: "not-an-email" }).expect(400).expect({ error: { code: "VALIDATION_ERROR", message: "Dados de entrada inválidos." } });
  });

  it("returns the standard not-found envelope for unmatched routes", async () => {
    await request(app).get("/api/does-not-exist").expect(404).expect({ error: { code: "NOT_FOUND", message: "Recurso não encontrado." } });
  });

  it("serves the OpenAPI interface", async () => {
    await request(app).get("/api-docs/").expect(200).expect("content-type", /html/);
  });
});
