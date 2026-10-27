import { SubmissionService } from "../../src/modules/submissions/submission.service.js";
import type { SubmissionRepository } from "../../src/modules/submissions/submission.repository.js";
import type { Clock } from "../../src/shared/core.js";

const clock: Clock = { now: () => new Date("2026-01-01T12:00:00Z") };

describe("SubmissionService", () => {
  it("creates a capability only after the repository snapshot succeeds", async () => {
    const repository: SubmissionRepository = {
      transaction: async (work) => work(repository),
      createSessionSnapshot: async (input) => ({ session: { id: input.sessionId, sectorId: input.sectorId, shiftSheetVersionId: 1, shiftRangeId: 2 }, questions: [{ questionId: 3, questionVersionId: 4, text: "Como foi?", questionKind: "standard", isNps: true, position: 1 }] }),
    };
    const result = await new SubmissionService(repository, clock).start(7, 4, "09:00");
    expect(result.capability.sessionId).toBe(result.session.id);
  });

  it("does not authorize a guessed or reused capability", async () => {
    const repository: SubmissionRepository = { transaction: async (work) => work(repository), createSessionSnapshot: async (input) => ({ session: { id: input.sessionId, sectorId: input.sectorId, shiftSheetVersionId: 1, shiftRangeId: 2 }, questions: [] }) };
    const service = new SubmissionService(repository, clock);
    const result = await service.start(7, 4, "09:00");
    expect(service.authorize(result.capability.sessionId, result.capability.token)).toBe(true);
    expect(service.authorize(result.capability.sessionId, "wrong-token")).toBe(false);
    expect(service.authorize("other-session", result.capability.token)).toBe(false);
  });
});
