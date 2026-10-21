import type postgres from "postgres";
import { seedInitialData } from "../src/db/seed/initial-seed.js";

describe("initial seed credential validation", () => {
  it("rejects an invalid email before any database access", async () => {
    await expect(seedInitialData({} as postgres.Sql, { name: "Initial admin", email: "not-an-email", password: "temporary-password" })).rejects.toThrow("Credenciais iniciais inválidas");
  });
});
