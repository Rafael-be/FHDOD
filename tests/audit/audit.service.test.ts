import { AuditService, decodeAuditCursor } from "../../src/modules/audit/audit.service.js";
import type { AuditRepository } from "../../src/modules/audit/audit.repository.js";
import type { AuthIdentity } from "../../src/modules/auth/auth.service.js";

const admin: AuthIdentity = {
  userId: 1,
  sessionId: "session",
  role: "superuser",
  mustChangePassword: false,
};

const manager: AuthIdentity = {
  userId: 2,
  sessionId: "session",
  role: "sector_manager",
  mustChangePassword: false,
};

describe("AuditService", () => {
  it("returns a cursor with PostgreSQL microsecond precision without exposing its internal timestamp", async () => {
    const repository = {
      list: async () => [{
        id: 3,
        actorUserId: 1,
        action: "sector.created",
        entityType: "sector",
        entityId: 1,
        oldValues: null,
        newValues: { code: "uti" },
        createdAt: new Date("2026-01-01T00:00:00.123Z"),
        cursorTimestamp: "2026-01-01T00:00:00.123456Z",
      }],
    } as unknown as AuditRepository;

    const result = await new AuditService(repository).list(admin, null, 50);

    expect(result.records).toEqual([expect.objectContaining({ id: 3 })]);
    expect(result.records[0]).not.toHaveProperty("cursorTimestamp");
    expect(decodeAuditCursor(result.nextCursor!)).toEqual({
      id: 3,
      createdAt: "2026-01-01T00:00:00.123456Z",
    });
  });

  it("accepts legacy millisecond cursors and rejects malformed cursors", async () => {
    const legacy = Buffer.from(JSON.stringify({ id: 3, createdAt: "2026-01-01T00:00:00.123Z" })).toString("base64url");

    expect(decodeAuditCursor(legacy)).toEqual({ id: 3, createdAt: "2026-01-01T00:00:00.123Z" });
    expect(() => decodeAuditCursor("not-a-cursor")).toThrow("Cursor");
  });

  it("rejects non-superuser access", async () => {
    const repository = { list: async () => [] } as unknown as AuditRepository;

    await expect(new AuditService(repository).list(manager, null, 50)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
