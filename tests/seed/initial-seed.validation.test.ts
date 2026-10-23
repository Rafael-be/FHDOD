import type postgres from "postgres";
import { seedInitialData } from "../../src/db/seed/initial-seed.js";

describe("initial seed credential validation", () => {
  it("rejects an invalid email before any database access", async () => {
    await expect(seedInitialData({} as postgres.Sql, { name: "Initial admin", email: "not-an-email", password: "temporary-password" })).rejects.toThrow("Credenciais iniciais inválidas");
  });

  it("requires a temporary bootstrap password with at least 12 characters", async () => {
    await expect(seedInitialData({} as postgres.Sql, { name: "Initial admin", email: "admin@example.test", password: "short-pass" })).rejects.toThrow("Credenciais iniciais inválidas");
  });

  it("rejects an existing account that is not a superuser", async () => {
    const responses = [[{ id: 1 }], [{ id: 2, role: "sector_manager" }]];
    const sql = (() => Promise.resolve(responses.shift() ?? [])) as unknown as postgres.Sql;

    await expect(seedInitialData(sql, { name: "Initial admin", email: "admin@example.test", password: "temporary-password" })).rejects.toThrow("não é superusuária");
  });
});
