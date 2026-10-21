import { AdminService } from "../src/modules/admin/admin.service.js";
import type { AuthIdentity } from "../src/modules/auth/auth.service.js";
import type { Clock } from "../src/shared/core.js";
import type { AdminRepository } from "../src/modules/admin/admin.repository.js";

const clock: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };
const manager: AuthIdentity = { userId: 10, sessionId: "session", role: "sector_manager", mustChangePassword: false };
const superuser: AuthIdentity = { userId: 1, sessionId: "session", role: "superuser", mustChangePassword: false };
describe("AdminService manager sector scope", () => {
  it("allows a manager to query only their own assignments", async () => {
    const repository = { managerSectors: async () => [{ id: 7, code: "uti", name: "UTI", deletedAt: null }] } as unknown as AdminRepository;
    const service = new AdminService(repository, clock);
    await expect(service.listManagerSectors(manager, 10)).resolves.toHaveLength(1);
    await expect(service.listManagerSectors(manager, 11)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("allows a superuser to query a manager after its existence is checked", async () => {
    const repository = { manager: async () => ({ id: 11 }), managerSectors: async () => [] } as unknown as AdminRepository;
    await expect(new AdminService(repository, clock).listManagerSectors(superuser, 11)).resolves.toEqual([]);
  });
});
