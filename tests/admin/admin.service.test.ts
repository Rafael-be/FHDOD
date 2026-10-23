import { AdminService } from "../../src/modules/admin/admin.service.js";
import type { AuthIdentity } from "../../src/modules/auth/auth.service.js";
import type { Clock } from "../../src/shared/core.js";
import type { AdminRepository } from "../../src/modules/admin/admin.repository.js";

const clock: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };
const manager: AuthIdentity = { userId: 10, sessionId: "session", role: "sector_manager", mustChangePassword: false };
const superuser: AuthIdentity = { userId: 1, sessionId: "session", role: "superuser", mustChangePassword: false };
describe("AdminService manager sector scope", () => {
  it("returns manager detail with assignments only to a superuser",async()=>{const repository={manager:async()=>({id:10,fullName:"Gestor",email:"gestor@hospital.test",role:"sector_manager",deletedAt:null}),managerSectors:async()=>[{id:7,code:"uti",name:"UTI",deletedAt:null}]} as unknown as AdminRepository;await expect(new AdminService(repository,clock).getManager(superuser,10)).resolves.toMatchObject({id:10,sectors:[{id:7}]});await expect(new AdminService(repository,clock).getManager(manager,10)).rejects.toMatchObject({code:"FORBIDDEN"});});
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
  it("calculates preparation requirements and rejects a manager outside the sector scope", async () => {
    const repository = { sector: async () => ({ id: 7 }), readiness: async () => ({ hasShiftRanges: false, hasNps: false }), managerSectors: async () => [] } as unknown as AdminRepository;
    const service = new AdminService(repository, clock);
    await expect(service.sectorStatus(superuser, 7)).resolves.toEqual({ sectorId: 7, status: "preparing", missingRequirements: ["shift_ranges", "nps"] });
    await expect(service.sectorStatus(manager, 7)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("does not revoke sessions or audit when the target is not a sector manager", async () => {
    let revoked = false;
    let audited = false;
    const repository = {
      transaction: async (work: (repository: AdminRepository) => Promise<void>) => work(repository as unknown as AdminRepository),
      deactivateManager: async () => false,
      revokeSessions: async () => { revoked = true; },
      audit: async () => { audited = true; },
    } as unknown as AdminRepository;

    await expect(new AdminService(repository, clock).deactivateManager(superuser, 1))
      .rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(revoked).toBe(false);
    expect(audited).toBe(false);
  });

  it("returns a sector-code conflict only for the sector code constraint", async () => {
    const duplicateCode = Object.assign(new Error("duplicate"), {
      code: "23505",
      table_name: "sectors",
      constraint_name: "sectors_code_key",
    });
    const repository = {
      transaction: async () => { throw duplicateCode; },
    } as unknown as AdminRepository;

    await expect(new AdminService(repository, clock).createSector(superuser, { code: "UTI", name: "UTI" }))
      .rejects.toMatchObject({ code: "SECTOR_CODE_ALREADY_EXISTS", status: 409 });
  });

  it("does not relabel unrelated unique violations as sector-code conflicts", async () => {
    const unrelatedViolation = Object.assign(new Error("duplicate"), {
      code: "23505",
      table_name: "sectors",
      constraint_name: "other_constraint",
    });
    const repository = {
      transaction: async () => { throw unrelatedViolation; },
    } as unknown as AdminRepository;

    await expect(new AdminService(repository, clock).createSector(superuser, { code: "UTI", name: "UTI" }))
      .rejects.toBe(unrelatedViolation);
  });
});
