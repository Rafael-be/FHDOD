import { hasDisposableMarker, postgresIntegrationTestsEnabled, testDatabaseUrl, usesIsolatedDatabase } from "./database.js";

describe("usesIsolatedDatabase", () => {
  const originalIntegrationFlag = process.env.POSTGRES_INTEGRATION_TESTS;
  const localAdminUrl = "postgres://postgres:admin-password@127.0.0.1:5432/fhdod_test";
  const localRuntimeUrl = "postgres://fhdod_api:runtime-password@127.0.0.1:5432/fhdod_test";
  const remoteRuntimeUrl = "postgres://fhdod_api:runtime-password@db.example.test:5432/fhdod";

  beforeEach(() => { process.env.POSTGRES_INTEGRATION_TESTS = "true"; });
  afterAll(() => {
    if (originalIntegrationFlag === undefined) delete process.env.POSTGRES_INTEGRATION_TESTS;
    else process.env.POSTGRES_INTEGRATION_TESTS = originalIntegrationFlag;
  });

  it("requires explicit opt-in before any PostgreSQL integration can run", () => {
    process.env.POSTGRES_INTEGRATION_TESTS = "false";
    expect(postgresIntegrationTestsEnabled()).toBe(false);
    expect(usesIsolatedDatabase(localAdminUrl, localRuntimeUrl)).toBe(false);
  });

  it("accepts the same local test endpoint with the fhdod_api runtime role", () => {
    expect(usesIsolatedDatabase(
      localAdminUrl,
      localRuntimeUrl,
    )).toBe(true);
  });

  it("rejects remote, different-endpoint and non-test runtime targets", () => {
    expect(usesIsolatedDatabase(
      localAdminUrl,
      remoteRuntimeUrl,
    )).toBe(false);
    expect(usesIsolatedDatabase(
      "postgres://postgres:admin-password@db.example.test:5432/fhdod_test",
      localRuntimeUrl,
    )).toBe(false);
    expect(usesIsolatedDatabase(
      localAdminUrl,
      "postgres://fhdod_api:runtime-password@127.0.0.1:55439/postgres",
    )).toBe(false);
    expect(usesIsolatedDatabase(
      localAdminUrl,
      "postgres://fhdod_api:runtime-password@127.0.0.1:5432/fhdod",
    )).toBe(false);
    expect(usesIsolatedDatabase(
      localAdminUrl,
      "postgres://fhdod_api:runtime-password@localhost:5432/fhdod_test",
    )).toBe(false);
  });

  it("rejects a wrong runtime role and divergent ports, while normalizing the omitted default port", () => {
    expect(usesIsolatedDatabase(
      localAdminUrl,
      "postgres://postgres:runtime-password@127.0.0.1:5432/fhdod_test",
    )).toBe(false);
    expect(usesIsolatedDatabase(
      localAdminUrl,
      "postgres://fhdod_api:runtime-password@127.0.0.1:5433/fhdod_test",
    )).toBe(false);
    expect(usesIsolatedDatabase(
      "postgres://postgres:admin-password@127.0.0.1/fhdod_test",
      localRuntimeUrl,
    )).toBe(true);
    expect(usesIsolatedDatabase(
      "postgres://postgres:admin-password@[::1]:5432/fhdod_test",
      "postgres://fhdod_api:runtime-password@[::1]:5432/fhdod_test",
    )).toBe(true);
    expect(usesIsolatedDatabase(
      "postgres://postgres:admin-password@localhost.evil.test:5432/fhdod_test",
      localRuntimeUrl,
    )).toBe(false);
    expect(usesIsolatedDatabase("not a URL", localRuntimeUrl)).toBe(false);
    expect(usesIsolatedDatabase(localAdminUrl, "")).toBe(false);
    expect(usesIsolatedDatabase(undefined, localRuntimeUrl)).toBe(false);
  });

  it("rejects malformed, empty and missing URLs", () => {
    expect(usesIsolatedDatabase(localAdminUrl, "")).toBe(false);
    expect(usesIsolatedDatabase(undefined, localRuntimeUrl)).toBe(false);
    expect(usesIsolatedDatabase("not a URL", localRuntimeUrl)).toBe(false);
  });

  it("rejects test-like names outside the approved exact database name", () => {
    expect(usesIsolatedDatabase(
      "postgres://postgres:admin-password@127.0.0.1:5432/fhdod_test_producao",
      "postgres://fhdod_api:runtime-password@127.0.0.1:5432/fhdod_test_producao",
    )).toBe(false);
  });

  it("accepts only the exact disposable marker and expected runtime identity", () => {
    const admin = { database: "fhdod_test", marker: "true" };
    const runtime = { database: "fhdod_test", role: "fhdod_api", marker: "true" };
    expect(hasDisposableMarker(admin, runtime)).toBe(true);
    expect(hasDisposableMarker({ ...admin, marker: null }, runtime)).toBe(false);
    expect(hasDisposableMarker({ ...admin, marker: "false" }, runtime)).toBe(false);
    expect(hasDisposableMarker({ ...admin, marker: "" }, runtime)).toBe(false);
    expect(hasDisposableMarker({ ...admin, marker: "true-ish" }, runtime)).toBe(false);
    expect(hasDisposableMarker(admin, { ...runtime, role: "postgres" })).toBe(false);
    expect(hasDisposableMarker(admin, { ...runtime, database: "postgres" })).toBe(false);
  });

  it("prefers the dedicated local URL", () => {
    const originalLocal = process.env.LOCAL_DATABASE_URL;
    const originalTest = process.env.DATABASE_URL_TEST;
    try {
      process.env.LOCAL_DATABASE_URL = "postgres://test:pass@127.0.0.1:54329/fhdod_test";
      process.env.DATABASE_URL_TEST = "postgres://test:pass@127.0.0.1:54330/fhdod_test_other";
      expect(testDatabaseUrl()).toBe(process.env.LOCAL_DATABASE_URL);
    } finally {
      if (originalLocal === undefined) delete process.env.LOCAL_DATABASE_URL; else process.env.LOCAL_DATABASE_URL = originalLocal;
      if (originalTest === undefined) delete process.env.DATABASE_URL_TEST; else process.env.DATABASE_URL_TEST = originalTest;
    }
  });
});
