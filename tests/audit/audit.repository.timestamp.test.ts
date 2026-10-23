import type postgres from "postgres";
import { AuditRepository } from "../../src/modules/audit/audit.repository.js";

function repositoryReturning(row: object): AuditRepository {
  const sql = (() => Promise.resolve([row])) as unknown as postgres.Sql;
  return new AuditRepository(sql);
}

describe("AuditRepository timestamp normalization", () => {
  const row = {
    id: 1,
    actorUserId: 2,
    action: "sector.created",
    entityType: "sector",
    entityId: 3,
    oldValues: null,
    newValues: null,
    createdAt: "2026-01-01T00:00:00.123Z",
    cursorTimestamp: "2026-01-01T00:00:00.123456Z",
  };

  it("normalizes the response date while retaining the exact pagination timestamp", async () => {
    const records = await repositoryReturning(row).list(null, 50);

    expect(records[0]?.createdAt).toBeInstanceOf(Date);
    expect(records[0]?.cursorTimestamp).toBe("2026-01-01T00:00:00.123456Z");
  });

  it("rejects malformed cursor timestamps from the driver", async () => {
    await expect(repositoryReturning({ ...row, cursorTimestamp: "invalid" }).list(null, 50))
      .rejects.toThrow("audit_logs.created_at");
  });
});
