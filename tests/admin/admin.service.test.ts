import { AdminService } from "../../src/modules/admin/admin.service.js";
import { jest } from "@jest/globals";
import type { AuthIdentity } from "../../src/modules/auth/auth.service.js";
import type { Clock } from "../../src/shared/core.js";
import type { AdminRepository } from "../../src/modules/admin/admin.repository.js";

const clock: Clock = { now: () => new Date("2026-01-01T00:00:00Z") };
const managerA: AuthIdentity = { userId: 10, sessionId: "session-a", role: "sector_manager", mustChangePassword: false };
const managerB: AuthIdentity = { userId: 11, sessionId: "session-b", role: "sector_manager", mustChangePassword: false };
const superuser: AuthIdentity = { userId: 1, sessionId: "session", role: "superuser", mustChangePassword: false };
describe("AdminService manager sector scope", () => {
  it("returns manager detail with assignments only to a superuser",async()=>{const repository={manager:async()=>({id:10,fullName:"Gestor",email:"gestor@hospital.test",role:"sector_manager",deletedAt:null}),managerSectors:async()=>[{id:7,code:"uti",name:"UTI",deletedAt:null}]} as unknown as AdminRepository;await expect(new AdminService(repository,clock).getManager(superuser,10)).resolves.toMatchObject({id:10,sectors:[{id:7}]});await expect(new AdminService(repository,clock).getManager(managerA,10)).rejects.toMatchObject({code:"FORBIDDEN"});});
  it("allows a manager to query only their own assignments", async () => {
    const repository = { managerSectors: async () => [{ id: 7, code: "uti", name: "UTI", deletedAt: null }] } as unknown as AdminRepository;
    const service = new AdminService(repository, clock);
    await expect(service.listManagerSectors(managerA, 10)).resolves.toHaveLength(1);
    await expect(service.listManagerSectors(managerA, 11)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
  it("allows a superuser to query a manager after its existence is checked", async () => {
    const repository = { manager: async () => ({ id: 11 }), managerSectors: async () => [] } as unknown as AdminRepository;
    await expect(new AdminService(repository, clock).listManagerSectors(superuser, 11)).resolves.toEqual([]);
  });
  it("calculates preparation requirements and rejects a manager outside the sector scope", async () => {
    const repository = { sector: async () => ({ id: 7 }), readiness: async () => ({ hasShiftRanges: false, hasNps: false }), managerSectors: async () => [] } as unknown as AdminRepository;
    const service = new AdminService(repository, clock);
    await expect(service.sectorStatus(superuser, 7)).resolves.toEqual({ sectorId: 7, status: "preparing", missingRequirements: ["shift_ranges", "nps"] });
    await expect(service.sectorStatus(managerA, 7)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns a lightweight sector detail and loads effective questions only when requested", async () => {
    const effectiveQuestions = jest.fn(async () => [
      { id: 1, questionKind: "sector" as const, isNps: false, text: "Local", versionNumber: 1, displayOrder: 1 },
      { id: 2, questionKind: "standard" as const, isNps: false, text: "Padrão", versionNumber: 1, displayOrder: 1 },
      { id: 3, questionKind: "standard" as const, isNps: true, text: "NPS", versionNumber: 1, displayOrder: 2147483647 },
    ]);
    const repository = { sector: async () => ({ id: 7, code: "uti", name: "UTI", deletedAt: null }), readiness: async () => ({ hasShiftRanges: true, hasNps: true }), effectiveQuestions } as unknown as AdminRepository;
    const service = new AdminService(repository, clock);
    await expect(service.getSector(superuser, 7, false)).resolves.toMatchObject({ isActive: true, operationalStatus: "active" });
    expect(effectiveQuestions).not.toHaveBeenCalled();
    await expect(service.getSector(superuser, 7, true)).resolves.toMatchObject({ questions: { sector: [{ id: 1 }], standard: [{ id: 2 }], nps: { id: 3 } } });
  });

  it("keeps manager A and manager B isolated to their own sectors", async () => {
    const sectorsByManager = new Map([
      [10, [{ id: 7, code: "uti", name: "UTI", deletedAt: null }]],
      [11, [{ id: 8, code: "ps", name: "Pronto-socorro", deletedAt: null }]],
    ]);
    const repository = {
      managerSectors: async (managerId: number) => sectorsByManager.get(managerId) ?? [],
      sector: async (sectorId: number) => ({ id: sectorId }),
      readiness: async () => ({ hasShiftRanges: true, hasNps: true }),
    } as unknown as AdminRepository;
    const service = new AdminService(repository, clock);

    await expect(service.listSectors(managerA)).resolves.toEqual(sectorsByManager.get(10));
    await expect(service.listSectors(managerB)).resolves.toEqual(sectorsByManager.get(11));
    await expect(service.listManagerSectors(managerA, managerB.userId))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.listManagerSectors(managerB, managerA.userId))
      .rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.sectorStatus(managerA, 8)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.sectorStatus(managerB, 7)).rejects.toMatchObject({ code: "FORBIDDEN" });
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

  it("does not audit an assignment that already exists", async () => {
    let auditCalls = 0;
    const repository = {
      transaction: async (work: (repository: AdminRepository) => Promise<void>) => work(repository as unknown as AdminRepository),
      manager: async () => ({ id: 10 }),
      sector: async () => ({ id: 7 }),
      assign: async () => false,
      audit: async () => { auditCalls += 1; },
    } as unknown as AdminRepository;

    await expect(new AdminService(repository, clock).assignment(superuser, 10, 7, true))
      .resolves.toBeUndefined();
    expect(auditCalls).toBe(0);
  });

  it("audits an assignment only when the repository creates it", async () => {
    let auditCalls = 0;
    const repository = {
      transaction: async (work: (repository: AdminRepository) => Promise<void>) => work(repository as unknown as AdminRepository),
      manager: async () => ({ id: 10 }),
      sector: async () => ({ id: 7 }),
      assign: async () => true,
      audit: async () => { auditCalls += 1; },
    } as unknown as AdminRepository;

    await new AdminService(repository, clock).assignment(superuser, 10, 7, true);
    expect(auditCalls).toBe(1);
  });
});
