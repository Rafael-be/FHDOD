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

  it("computes the start window in America/Sao_Paulo", async () => {
    let received: { dayOfWeek?: number; localTime?: string } = {};
    const repository: SubmissionRepository = { transaction: async (work) => work(repository), createSessionSnapshot: async (input) => { received = input; return { session: { id: input.sessionId, sectorId: input.sectorId, shiftSheetVersionId: 1, shiftRangeId: 2 }, questions: [] }; } };
    await new SubmissionService(repository, clock).startNow(7);
    expect(received).toMatchObject({ dayOfWeek: 4, localTime: "09:00" });
  });

  it("requires the ephemeral capability before saving an answer", async () => {
    const repository: SubmissionRepository = { transaction: async (work) => work(repository), createSessionSnapshot: async (input) => ({ session: { id: input.sessionId, sectorId: input.sectorId, shiftSheetVersionId: 1, shiftRangeId: 2 }, questions: [] }), saveAnswer: async (sessionId, input) => ({ sessionId, status: input.status === "answered" ? "incomplete" : "incomplete", answered: input.status === "answered" }) };
    const service = new SubmissionService(repository, clock);
    const result = await service.start(7, 4, "09:00");
    await expect(service.answer(result.capability.sessionId, "invalid", { sessionQuestionId: 1, status: "answered", score: 3 })).rejects.toMatchObject({ code: "SUBMISSION_CAPABILITY_INVALID" });
    await expect(service.answer(result.capability.sessionId, result.capability.token, { sessionQuestionId: 1, status: "answered", score: null })).rejects.toMatchObject({ code: "INVALID_ANSWER" });
  });

  it("ends the old session and issues a new capability on restart", async () => {
    const repository: SubmissionRepository = { transaction: async (work) => work(repository), createSessionSnapshot: async (input) => ({ session: { id: input.sessionId, sectorId: input.sectorId, shiftSheetVersionId: 1, shiftRangeId: 2 }, questions: [] }), saveAnswer: async (sessionId, input) => ({ sessionId, status: "incomplete", answered: input.status === "answered" }), endSession: async () => ({ sectorId: 7 }) };
    const service = new SubmissionService(repository, clock);
    const first = await service.start(7, 4, "09:00");
    const restarted = await service.restart(first.capability.sessionId, first.capability.token);
    expect(restarted.capability.sessionId).not.toBe(first.capability.sessionId);
    expect(service.authorize(first.capability.sessionId, first.capability.token)).toBe(false);
  });
});
