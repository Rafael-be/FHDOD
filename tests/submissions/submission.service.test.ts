import { SubmissionService } from "../../src/modules/submissions/submission.service.js";
import type { SubmissionRepository } from "../../src/modules/submissions/submission.repository.js";
import type { Clock } from "../../src/shared/core.js";
import { DomainError } from "../../src/shared/core.js";

const clock: Clock = { now: () => new Date("2026-01-01T12:00:00Z") };

describe("SubmissionService", () => {
  it("passes an out-of-hours session and the exact NPS answer to persistence", async () => {
    const saved: Array<{ sessionId: string; input: { questionId: number; questionVersionId: number; status: "answered" | "skipped"; score: number | null }; now: Date }> = [];
    const repository: SubmissionRepository = {
      transaction: async (work) => work(repository),
      createSessionSnapshot: async (input) => ({ session: { id: input.sessionId, sectorId: input.sectorId, formVersionId: 1, expiresAt: "2026-01-01T12:03:00Z", shiftSheetVersionId: 42, shiftRangeId: null }, questions: [{ questionId: 19, questionVersionId: 29, text: "NPS", questionKind: "standard", isNps: true, position: 1 }] }),
      saveAnswer: async (sessionId, input, now) => { saved.push({ sessionId, input, now }); return { sessionId, status: "complete", answered: true, expiresAt: "2026-01-01T12:05:00Z" }; },
      refreshSession: async () => ({ expiresAt: "2026-01-01T12:05:00Z", refreshesUsed: 1, refreshesRemaining: 2 }),
      closeSession: async (sessionId) => ({ sessionId, status: "closed" }),
    };
    const service = new SubmissionService(repository, clock);
    const started = await service.start(7, 4, "23:30");
    expect(started.session).toMatchObject({ sectorId: 7, shiftSheetVersionId: 42, shiftRangeId: null });
    expect(started.questions).toEqual([{ questionId: 19, questionVersionId: 29, text: "NPS", questionKind: "standard", isNps: true, position: 1 }]);
    await expect(service.answer(started.capability.sessionId, "wrong", { questionId: 19, questionVersionId: 29, status: "answered", score: 9 })).rejects.toMatchObject({ code: "SUBMISSION_CAPABILITY_INVALID" });
    expect(saved).toHaveLength(0);
    await expect(service.answer(started.capability.sessionId, started.capability.token, { questionId: 19, questionVersionId: 29, status: "answered", score: 9 })).resolves.toMatchObject({ status: "complete" });
    expect(saved).toEqual([{ sessionId: started.capability.sessionId, input: { questionId: 19, questionVersionId: 29, status: "answered", score: 9 }, now: clock.now() }]);
    await expect(service.refresh(started.capability.sessionId, started.capability.token)).resolves.toMatchObject({ refreshesUsed: 1, refreshesRemaining: 2 });
    await expect(service.close(started.capability.sessionId, started.capability.token)).resolves.toMatchObject({ status: "closed" });
  });
  it("creates a capability only after the repository snapshot succeeds", async () => {
    const repository: SubmissionRepository = {
      transaction: async (work) => work(repository),
      createSessionSnapshot: async (input) => ({ session: { id: input.sessionId, sectorId: input.sectorId, formVersionId: 1, expiresAt: "2026-01-01T12:03:00Z", shiftSheetVersionId: 1, shiftRangeId: 2 }, questions: [{ questionId: 3, questionVersionId: 4, text: "Como foi?", questionKind: "standard", isNps: true, position: 1 }] }),
    };
    const result = await new SubmissionService(repository, clock).start(7, 4, "09:00");
    expect(result.capability.sessionId).toBe(result.session.id);
  });

  it("does not authorize a guessed or reused capability", async () => {
    const repository: SubmissionRepository = { transaction: async (work) => work(repository), createSessionSnapshot: async (input) => ({ session: { id: input.sessionId, sectorId: input.sectorId, shiftSheetVersionId: 1, shiftRangeId: 2 }, questions: [] }) };
    const service = new SubmissionService(repository, clock);
    const result = await service.start(7, 4, "09:00");
    await expect(service.authorize(result.capability.sessionId, result.capability.token)).resolves.toBe(true);
    await expect(service.authorize(result.capability.sessionId, "wrong-token")).resolves.toBe(false);
    await expect(service.authorize("other-session", result.capability.token)).resolves.toBe(false);
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
    await expect(service.answer(result.capability.sessionId, "invalid", { questionId: 1, questionVersionId: 1, status: "answered", score: 3 })).rejects.toMatchObject({ code: "SUBMISSION_CAPABILITY_INVALID" });
    await expect(service.answer(result.capability.sessionId, result.capability.token, { questionId: 1, questionVersionId: 1, status: "answered", score: null })).rejects.toMatchObject({ code: "INVALID_ANSWER" });
  });

  it("ends the old session and issues a new capability on restart", async () => {
    const repository: SubmissionRepository = { transaction: async (work) => work(repository), createSessionSnapshot: async (input) => ({ session: { id: input.sessionId, sectorId: input.sectorId, shiftSheetVersionId: 1, shiftRangeId: 2 }, questions: [] }), saveAnswer: async (sessionId, input) => ({ sessionId, status: "incomplete", answered: input.status === "answered" }), endSession: async () => ({ sectorId: 7 }) };
    const service = new SubmissionService(repository, clock);
    const first = await service.start(7, 4, "09:00");
    const restarted = await service.restart(first.capability.sessionId, first.capability.token);
    expect(restarted.capability.sessionId).not.toBe(first.capability.sessionId);
    await expect(service.authorize(first.capability.sessionId, first.capability.token)).resolves.toBe(false);
  });

  it("persists expiration after the answer transaction rolls back", async () => {
    const expired: string[] = [];
    const repository: SubmissionRepository = {
      transaction: async (work) => work(repository),
      createSessionSnapshot: async (input) => ({ session: { id: input.sessionId, sectorId: input.sectorId, shiftSheetVersionId: null, shiftRangeId: null }, questions: [] }),
      saveAnswer: async () => { throw new DomainError("SUBMISSION_EXPIRED", "Expirada", 410); },
      expireSession: async (id) => { expired.push(id); return true; },
    };
    const service = new SubmissionService(repository, clock);
    const started = await service.start(7, 4, "09:00");
    await expect(service.answer(started.capability.sessionId, started.capability.token, { questionId: 1, questionVersionId: 1, status: "answered", score: 3 })).rejects.toMatchObject({ code: "SUBMISSION_EXPIRED" });
    expect(expired).toEqual([started.capability.sessionId]);
  });
});
