import request from "supertest";
import { jest } from "@jest/globals";
import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import type { AuthService } from "../../src/modules/auth/auth.service.js";
import { loginCredentialsSchema } from "../../src/modules/auth/auth.schemas.js";
import { DomainError } from "../../src/shared/core.js";

const config: AppConfig = { NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://api:pass@localhost/fhdod", ALLOWED_ORIGIN: "http://localhost:5173", JWT_SECRET: "12345678901234567890123456789012", JWT_ISSUER: "fhdod-api", JWT_AUDIENCE: "fhdod-web", PERFORMANCE_MEASUREMENTS: false };
const validBody = { email: "admin@example.test", password: "senha-de-desenvolvimento" };

function makeApp(login: (email: string, password: string) => Promise<unknown>) {
  const auth = { login, authenticate: async () => { throw new Error("unused without cookie"); }, recoverCsrf: async () => "csrf", recoverCsrfForIdentity: async () => "csrf" } as unknown as AuthService;
  return createApp(config, auth);
}

describe("POST /api/auth/login validation", () => {
  it("accepts the documented JSON and delegates authentication", async () => {
    const received: unknown[] = [];
    const app = makeApp(async (...input) => { received.push(input); return { accessToken: "access", refreshToken: "refresh", csrfToken: "csrf", expiresAt: new Date("2026-12-31T00:00:00Z") }; });
    const response = await request(app).post("/api/auth/login").set("Content-Type", "application/json").send(validBody).expect(200).expect(({ body }) => expect(body.data.csrfToken).toBe("csrf"));
    const cookies = response.headers["set-cookie"] as string[];
    expect(cookies).toEqual(expect.arrayContaining([expect.stringMatching(/^access_token=.*; Path=\/api;/), expect.stringMatching(/^refresh_token=.*; Path=\/api\/auth;/)]));
    expect(received).toEqual([[validBody.email, validBody.password]]);
  });

  it("returns CSRF immediately after login using the refresh cookie", async () => {
    await request(makeApp(async () => ({ accessToken: "access", refreshToken: "refresh", csrfToken: "csrf", expiresAt: new Date("2026-12-31T00:00:00Z") }))).get("/api/auth/csrf").set("Cookie", "refresh_token=refresh").expect(200).expect({ data: { csrfToken: "csrf" } });
  });

  it("uses the valid access token when a legacy empty duplicate is sent and clears both paths on logout", async () => {
    const logout = jest.fn(async () => undefined);
    const authenticate = jest.fn(async (token: string) => { if (token !== "valid-access-token") throw new Error("invalid"); return { userId: 1, sessionId: "session", role: "superuser" as const, mustChangePassword: false }; });
    const auth = { login: async () => { throw new Error("unused"); }, authenticate, recoverCsrf: async () => "csrf", recoverCsrfForIdentity: async () => "csrf", logout } as unknown as AuthService;
    const response = await request(createApp(config, auth)).post("/api/auth/logout").set("Cookie", "access_token=; refresh_token=refresh; access_token=valid-access-token").set("X-CSRF-Token", "csrf").expect(204);
    expect(authenticate).toHaveBeenCalledWith("valid-access-token");
    expect(logout).toHaveBeenCalledWith("session");
    const cookies = response.headers["set-cookie"] as string[];
    expect(cookies).toEqual(expect.arrayContaining([expect.stringMatching(/^access_token=; Path=\/api;/), expect.stringMatching(/^access_token=; Path=\/api\/auth;/), expect.stringMatching(/^refresh_token=; Path=\/api\/auth;/)]));
  });

  it("does not authenticate when retrieving CSRF from the refresh-token flow", async () => {
    const failure = Object.assign(new Error("permission denied"), { code: "42501" });
    const authenticate = jest.fn(async () => { throw failure; });
    const auth = { login: async () => { throw new Error("unused"); }, authenticate, recoverCsrf: async () => "csrf", recoverCsrfForIdentity: async () => "csrf" } as unknown as AuthService;
    await request(createApp(config, auth)).get("/api/auth/csrf").set("Cookie", "access_token=valid; refresh_token=refresh").expect(200).expect({ data: { csrfToken: "csrf" } });
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("logs a CSRF rejection without recording request credentials", async () => {
    const stderrWrite = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    const auth = { login: async () => { throw new Error("unused"); }, authenticate: async () => ({ userId: 1, sessionId: "session", role: "superuser" as const, mustChangePassword: true }), recoverCsrf: async () => "csrf", recoverCsrfForIdentity: async () => "csrf", changeTemporaryPassword: async () => undefined } as unknown as AuthService;
    try {
      await request(createApp(config, auth)).post("/api/auth/change-temporary-password").set("Cookie", "access_token=access-secret; refresh_token=refresh-secret").send({ currentPassword: "current-secret", newPassword: "new-password-safe" }).expect(403).expect({ error: { code: "CSRF_INVALID", message: "Token CSRF inválido." } });
      const output = String(stderrWrite.mock.calls.at(-1)?.[0]);
      expect(output).toContain('"reason":"csrf_invalid"');
      expect(output).not.toContain("access-secret");
      expect(output).not.toContain("refresh-secret");
      expect(output).not.toContain("current-secret");
    } finally {
      stderrWrite.mockRestore();
    }
  });

  it("accepts a legacy short current password but requires a compliant new password", async () => {
    const changeTemporaryPassword = jest.fn(async () => undefined);
    const auth = { login: async () => { throw new Error("unused"); }, authenticate: async () => ({ userId: 1, sessionId: "session", role: "superuser" as const, mustChangePassword: true }), recoverCsrf: async () => "csrf", recoverCsrfForIdentity: async () => "csrf", changeTemporaryPassword } as unknown as AuthService;
    await request(createApp(config, auth)).post("/api/auth/change-temporary-password").set("Cookie", "access_token=access; refresh_token=refresh").set("X-CSRF-Token", "csrf").send({ currentPassword: "short123", newPassword: "new-password-safe" }).expect(204);
    expect(changeTemporaryPassword).toHaveBeenCalledWith(expect.objectContaining({ userId: 1 }), "short123", "new-password-safe");
  });

  it.each([{ currentPassword: "short123", newPassword: "short123" }, { currentPassword: "short123" }, { currentPassword: 123, newPassword: true }])("rejects invalid temporary-password body %# before changing the password", async (body) => {
    const changeTemporaryPassword = jest.fn(async () => undefined);
    const stderrWrite = jest.spyOn(process.stderr, "write").mockImplementation(() => true);
    const auth = { login: async () => { throw new Error("unused"); }, authenticate: async () => ({ userId: 1, sessionId: "session", role: "superuser" as const, mustChangePassword: true }), recoverCsrf: async () => "csrf", recoverCsrfForIdentity: async () => "csrf", changeTemporaryPassword } as unknown as AuthService;
    try {
      await request(createApp(config, auth)).post("/api/auth/change-temporary-password").set("Cookie", "access_token=access; refresh_token=refresh").set("X-CSRF-Token", "csrf").send(body).expect(400).expect({ error: { code: "VALIDATION_ERROR", message: "Dados de entrada inválidos." } });
      expect(changeTemporaryPassword).not.toHaveBeenCalled();
      const output = String(stderrWrite.mock.calls.at(-1)?.[0]);
      expect(output).toContain('"event":"http.validation_failed"');
      expect(output).not.toContain("short123");
      if (body.newPassword === "short123") expect(output).toContain('"fields":["newPassword"]');
    } finally {
      stderrWrite.mockRestore();
    }
  });

  it.each([{ password: "senha" }, { email: validBody.email }, { userEmail: validBody.email, userPassword: "senha" }, { email: 123, password: true }, { email: "invalido", password: "senha" }])("rejects invalid JSON body %# with 400", async (body) => {
    await request(makeApp(async () => { throw new Error("must not authenticate"); })).post("/api/auth/login").set("Content-Type", "application/json").send(body).expect(400).expect({ error: { code: "VALIDATION_ERROR", message: "Dados de entrada inválidos." } });
  });

  it("rejects a body ignored because Content-Type is not application/json", async () => {
    await request(makeApp(async () => { throw new Error("must not authenticate"); })).post("/api/auth/login").set("Content-Type", "text/plain").send(JSON.stringify(validBody)).expect(400).expect({ error: { code: "VALIDATION_ERROR", message: "Dados de entrada inválidos." } });
  });

  it("returns 401 only after valid JSON reaches authentication", async () => {
    await request(makeApp(async () => { throw new DomainError("INVALID_CREDENTIALS", "E-mail ou senha inválidos.", 401); })).post("/api/auth/login").set("Content-Type", "application/json").send(validBody).expect(401).expect({ error: { code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." } });
  });

  it("returns 401 for five credential failures and blocks the sixth request before authentication", async () => {
    const login = jest.fn(async (_email: string, _password: string) => { throw new DomainError("INVALID_CREDENTIALS", "E-mail ou senha inválidos.", 401); });
    const app = makeApp(login);
    for (let index = 0; index < 5; index += 1) {
      await request(app).post("/api/auth/login").set("Content-Type", "application/json").send({ email: `attempt-${index}@example.test`, password: validBody.password }).expect(401).expect({ error: { code: "INVALID_CREDENTIALS", message: "E-mail ou senha inválidos." } });
    }
    await request(app).post("/api/auth/login").set("Content-Type", "application/json").send({ email: "sixth@example.test", password: validBody.password }).expect(429).expect({ error: { code: "LOGIN_FAILED_RATE_LIMITED", message: "Muitas tentativas. Aguarde alguns minutos." } });
    expect(login).toHaveBeenCalledTimes(5);
  });

  it("keeps the Zod and documented input contract aligned", () => {
    expect(loginCredentialsSchema.safeParse(validBody).success).toBe(true);
    expect(loginCredentialsSchema.safeParse({ email: "{{superuserEmail}}", password: "senha" }).success).toBe(false);
  });
});
