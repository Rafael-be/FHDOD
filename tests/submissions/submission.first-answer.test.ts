import { SubmissionService } from "../../src/modules/submissions/submission.service.js";
import { jest } from "@jest/globals";
import type { SubmissionRepository } from "../../src/modules/submissions/submission.repository.js";

const first = { questionId: 1, questionVersionId: 11, status: "answered" as const, score: 5 };
const token = "A".repeat(43);
const attemptId = "00000000-0000-4000-8000-000000000001";
const now = new Date("2026-11-25T12:00:00.000Z");

function fixture() {
  let persisted = false;
  const create = jest.fn(async (input: { sessionId: string; sectorId: number; now: Date }, version?: number) => {
    persisted = true;
    return { session: { id: input.sessionId, sectorId: input.sectorId, formVersionId: version!, expiresAt: new Date(input.now.getTime() + 180_000).toISOString(), shiftSheetVersionId: null, shiftRangeId: null }, questions: [] };
  });
  const save = jest.fn(async (id: string, answer: typeof first, _at: Date, initial?: boolean) => {
    expect(initial).toBe(true);
    expect(answer).toEqual(first);
    return { sessionId: id, status: "incomplete" as const, answered: true, expiresAt: new Date(now.getTime() + 180_000).toISOString() };
  });
  const repository = {
    transaction: async <T>(work: (repository: SubmissionRepository) => Promise<T>) => {
      try { return await work(repository); } catch (error) { persisted = false; throw error; }
    },
    createSessionSnapshot: create,
    saveAnswer: save,
    lockAttempt: jest.fn(async () => undefined),
    firstAttempt: jest.fn(async () => null),
    currentForm: jest.fn(async () => ({ formVersionId: 7, questions: [
      { questionId: 1, questionVersionId: 11, text: "Atendimento", questionKind: "standard" as const, isNps: false, position: 1 },
      { questionId: 2, questionVersionId: 12, text: "NPS", questionKind: "standard" as const, isNps: true, position: 2 },
    ] })),
  } as unknown as SubmissionRepository;
  return { repository, create, save, exists: () => persisted };
}

describe("public survey first answer", () => {
  it("resolves a complete public snapshot without creating a session", async () => {
    const f = fixture();
    const service = new SubmissionService(f.repository, { now: () => now });
    const form = await service.currentForm(9);
    expect(form).toMatchObject({ sectorId: 9, formVersionId: 7, questions: [
      { required: true, options: [1, 2, 3, 4, 5], minScore: 1, maxScore: 5 },
      { required: true, minScore: 0, maxScore: 10 },
    ] });
    expect(form.etag).toBe((await service.currentForm(9)).etag);
    expect(f.create).not.toHaveBeenCalled();
  });

  it("creates and persists the first answer together with a three-minute deadline", async () => {
    const f = fixture();
    const result = await new SubmissionService(f.repository, { now: () => now }).startWithFirstAnswer(9, 7, attemptId, token, first);
    expect(result.session.expiresAt).toBe("2026-11-25T12:03:00.000Z");
    expect(result.answer.expiresAt).toBe(result.session.expiresAt);
    expect(f.create).toHaveBeenCalledTimes(1);
    expect(f.save).toHaveBeenCalledTimes(1);
    expect(f.exists()).toBe(true);
  });

  it("does not create a session on validation or persistence failure", async () => {
    const f = fixture();
    const service = new SubmissionService(f.repository, { now: () => now });
    await expect(service.startWithFirstAnswer(9, 7, attemptId, token, { ...first, score: null })).rejects.toMatchObject({ code: "INVALID_ANSWER" });
    expect(f.create).not.toHaveBeenCalled();
    (f.repository.saveAnswer as jest.Mock).mockRejectedValueOnce(new Error("database failure"));
    await expect(service.startWithFirstAnswer(9, 7, attemptId, token, first)).rejects.toThrow("database failure");
    expect(f.exists()).toBe(false);
  });
});
