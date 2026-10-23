import type postgres from "postgres";
import { AdminRepository } from "../../src/modules/admin/admin.repository.js";

describe("AdminRepository manager state changes", () => {
  it("restricts deactivation to sector managers in the SQL predicate", async () => {
    let query = "";
    const sql = ((strings: TemplateStringsArray) => {
      query = strings.join("?");
      return Promise.resolve([]);
    }) as unknown as postgres.Sql;

    await new AdminRepository(sql).deactivateManager(1);

    expect(query).toContain("from roles r");
    expect(query).toContain("r.code = 'sector_manager'");
  });

  it("restricts reactivation to deactivated sector managers in the SQL predicate", async () => {
    let query = "";
    const sql = ((strings: TemplateStringsArray) => {
      query = strings.join("?");
      return Promise.resolve([]);
    }) as unknown as postgres.Sql;

    await new AdminRepository(sql).reactivateManager(1, "hash", new Date("2026-01-03T00:00:00Z"));

    expect(query).toContain("r.code = 'sector_manager'");
    expect(query).toContain("u.deleted_at is not null");
  });
});
