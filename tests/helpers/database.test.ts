import { testDatabaseUrl, usesIsolatedDatabase } from "./database.js";

describe("usesIsolatedDatabase", () => {
  const runtimeUrl = "postgres://fhdod_api:runtime-password@db.example.test:5432/fhdod";

  it("rejects URLs that differ only by credentials or query parameters", () => {
    expect(usesIsolatedDatabase(
      "postgres://test_user:test-password@db.example.test:5432/fhdod?application_name=test",
      runtimeUrl,
    )).toBe(false);
  });

  it("accepts only a dedicated local test database", () => {
    expect(usesIsolatedDatabase(
      "postgres://test_user:test-password@127.0.0.1:54329/fhdod_test",
      runtimeUrl,
    )).toBe(true);
    expect(usesIsolatedDatabase(
      "postgres://test_user:test-password@localhost:54329/fhdod_test_phase2",
      runtimeUrl,
    )).toBe(true);
  });

  it("rejects remote databases and local databases without the dedicated test name", () => {
    expect(usesIsolatedDatabase(
      "postgres://test_user:test-password@db.example.test:5432/fhdod_test",
      runtimeUrl,
    )).toBe(false);
    expect(usesIsolatedDatabase(
      "postgres://test_user:test-password@127.0.0.1:54329/postgres",
      runtimeUrl,
    )).toBe(false);
  });

  it("rejects missing or malformed URLs", () => {
    expect(usesIsolatedDatabase(undefined, runtimeUrl)).toBe(false);
    expect(usesIsolatedDatabase("not a URL", runtimeUrl)).toBe(false);
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
