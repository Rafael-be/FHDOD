import {
  loadAuditRetentionConfig,
  loadConfig,
  loadMigrationConfig,
} from "../../src/config/env.js";

const runtimeEnvironment = {
  DATABASE_URL: "postgres://api:pass@localhost/fhdod",
  ALLOWED_ORIGIN: "http://localhost:5173",
  JWT_SECRET: "12345678901234567890123456789012",
  JWT_ISSUER: "fhdod-api",
  JWT_AUDIENCE: "fhdod-web",
};

describe("configuration boundaries", () => {
  it("starts the runtime without administrative migration credentials", () => {
    expect(loadConfig(runtimeEnvironment)).toMatchObject({
      DATABASE_URL: runtimeEnvironment.DATABASE_URL,
      NODE_ENV: "development",
    });
  });

  it("requires migration credentials only for offline operations", () => {
    expect(() => loadMigrationConfig(runtimeEnvironment)).toThrow("DATABASE_URL_MIGRATIONS");
    expect(loadMigrationConfig({
      ...runtimeEnvironment,
      DATABASE_URL_MIGRATIONS: "postgres://admin:pass@localhost/fhdod",
    })).toEqual({ DATABASE_URL_MIGRATIONS: "postgres://admin:pass@localhost/fhdod" });
  });

  it("accepts only the dedicated maintenance role for audit retention", () => {
    expect(() => loadAuditRetentionConfig({})).toThrow("AUDIT_RETENTION_DATABASE_URL");
    expect(() => loadAuditRetentionConfig({
      AUDIT_RETENTION_DATABASE_URL: "postgres://fhdod_api:pass@localhost/fhdod",
    })).toThrow("AUDIT_RETENTION_DATABASE_URL");
    expect(loadAuditRetentionConfig({
      AUDIT_RETENTION_DATABASE_URL: "postgres://fhdod_audit_maintenance:pass@localhost/fhdod",
    })).toEqual({
      AUDIT_RETENTION_DATABASE_URL: "postgres://fhdod_audit_maintenance:pass@localhost/fhdod",
    });
  });
});
