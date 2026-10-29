import { QuestionsService } from "../../src/modules/questions/questions.service.js";
import { jest } from "@jest/globals";
import type { AuthIdentity } from "../../src/modules/auth/auth.service.js";
import type { QuestionsRepository } from "../../src/modules/questions/questions.repository.js";

const superuser: AuthIdentity = { userId: 1, sessionId: "s", role: "superuser", mustChangePassword: false };
const manager: AuthIdentity = { userId: 2, sessionId: "s", role: "sector_manager", mustChangePassword: false };

function repository(overrides: Partial<QuestionsRepository> = {}) {
  return {
    sectorAccess: async () => true,
    listEffective: async () => [],
    transaction: async (work: (repository: QuestionsRepository) => Promise<unknown>) => work(repository(overrides) as unknown as QuestionsRepository),
    createStandard: async () => ({ id: 9, questionKind: "standard", scope: "all_sectors", sectorId: null, isNps: false, displayOrder: 1, deletedAt: null, versionNumber: 1, text: "Pergunta" }),
    createNps: async () => ({ id: 10, questionKind: "standard", scope: "all_sectors", sectorId: null, isNps: true, displayOrder: 2147483647, deletedAt: null, versionNumber: 1, text: "NPS" }),
    audit: async () => undefined,
    activeNps: async () => true,
    activeSector: async () => true,
    activeSectorCount: async (sectorIds: number[]) => sectorIds.length,
    sectorHasNps: async () => false,
    assignNps: async () => undefined,
    ...overrides,
  } as unknown as QuestionsRepository;
}

describe("QuestionsService", () => {
  it("keeps standard and NPS management restricted to superusers", async () => {
    const service = new QuestionsService(repository());
    await expect(service.createStandard(manager, { text: "x", scope: "all_sectors", sectorIds: [], displayOrder: 1 })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(service.createNps(manager, { text: "x", scope: "all_sectors", sectorIds: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("rejects a second NPS assignment unless replacement is explicit", async () => {
    const service = new QuestionsService(repository({ sectorHasNps: async () => true }));
    await expect(service.assignNps(superuser, 7, 10, false)).rejects.toMatchObject({ code: "NPS_ALREADY_ASSIGNED" });
  });

  it("rejects a selected scope containing a missing or inactive sector before opening a transaction", async () => {
    let transactions = 0;
    const service = new QuestionsService(repository({ activeSectorCount: async () => 1, transaction: async () => { transactions += 1; throw new Error("must not start"); } }));
    await expect(service.createStandard(superuser, { text: "Pergunta", scope: "selected_sectors", sectorIds: [7, 8], displayOrder: 1 }))
      .rejects.toMatchObject({ code: "NOT_FOUND", status: 404 });
    expect(transactions).toBe(0);
  });

  it("rejects reactivation of an already active scoped question before recreating assignments", async () => {
    const activeStandard = { id: 9, questionKind: "standard" as const, scope: "all_sectors" as const, sectorId: null, isNps: false, displayOrder: 1, deletedAt: null, versionNumber: 1, text: "Pergunta" };
    const reactivateScoped = jest.fn(async () => undefined);
    const service = new QuestionsService(repository({ findQuestion: async () => activeStandard, reactivateScoped }));
    await expect(service.setDeleted(superuser, 9, false)).rejects.toMatchObject({ code: "QUESTION_ALREADY_ACTIVE", status: 409 });
    expect(reactivateScoped).not.toHaveBeenCalled();
  });
});
