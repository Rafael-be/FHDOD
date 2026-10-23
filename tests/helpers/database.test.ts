import { usesIsolatedDatabase } from "./database.js";

describe("usesIsolatedDatabase", () => {
  const runtimeUrl = "postgres://fhdod_api:runtime-password@db.example.test:5432/fhdod";

  it("rejects URLs that differ only by credentials or query parameters", () => {
    expect(usesIsolatedDatabase(
      "postgres://test_user:test-password@db.example.test:5432/fhdod?application_name=test",
      runtimeUrl,
    )).toBe(false);
  });

  it("accepts a different database, host, or port", () => {
    expect(usesIsolatedDatabase(
      "postgres://test_user:test-password@db.example.test:5432/fhdod_test",
      runtimeUrl,
    )).toBe(true);
    expect(usesIsolatedDatabase(
      "postgres://test_user:test-password@test-db.example.test:5432/fhdod",
      runtimeUrl,
    )).toBe(true);
    expect(usesIsolatedDatabase(
      "postgres://test_user:test-password@db.example.test:5433/fhdod",
      runtimeUrl,
    )).toBe(true);
  });

  it("rejects missing or malformed URLs", () => {
    expect(usesIsolatedDatabase(undefined, runtimeUrl)).toBe(false);
    expect(usesIsolatedDatabase("not a URL", runtimeUrl)).toBe(false);
  });
});
