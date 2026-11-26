import type postgres from "postgres";
import { jest } from "@jest/globals";
import { PublishedFormCache, publishedFormCache } from "../../src/modules/submissions/form-cache.js";
import { SubmissionService, type SubmissionQuestion } from "../../src/modules/submissions/submission.service.js";
import type { SubmissionRepository } from "../../src/modules/submissions/submission.repository.js";

const question: SubmissionQuestion = { questionId: 7, questionVersionId: 11, text: "Atendimento", questionKind: "standard", isNps: false, position: 1 };
const now = new Date("2026-01-05T12:00:00.000Z");

function repository(committed: boolean): SubmissionRepository {
  return {
    transaction: async (work) => {
      const result = await work(repository(false));
      if (!committed) throw new Error("rollback");
      return result;
    },
    createSessionSnapshot: async (input) => ({
      session: { id: input.sessionId, sectorId: input.sectorId, formVersionId: 987654, expiresAt: now.toISOString(), shiftSheetVersionId: null, shiftRangeId: null },
      questions: [question],
    }),
    capabilityHash: async () => null,
    saveAnswer: async () => { throw new Error("unused"); },
    endSession: async () => { throw new Error("unused"); },
  };
}

describe("published form cache commit boundary", () => {
  afterEach(() => jest.restoreAllMocks());

  it("stores the published form only after a successful transaction", async () => {
    let committed = false;
    const base = repository(true);
    const transaction = jest.spyOn(base, "transaction").mockImplementation(async (work) => {
      const value = await work(repository(false));
      committed = true;
      return value;
    });
    const put = jest.spyOn(publishedFormCache, "put").mockImplementation(() => { expect(committed).toBe(true); });
    const result = await new SubmissionService(base, { now: () => now }).start(3, 1, "09:00");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(put).toHaveBeenCalledWith(987654, [question]);
    expect(result.session.formVersionId).toBe(987654);
  });

  it("does not store an uncommitted form after rollback", async () => {
    const put = jest.spyOn(publishedFormCache, "put");
    await expect(new SubmissionService(repository(false), { now: () => now }).start(3, 1, "09:00")).rejects.toThrow("rollback");
    expect(put).not.toHaveBeenCalled();
  });

  it("keeps a committed session successful when cache insertion fails", async () => {
    jest.spyOn(publishedFormCache, "put").mockImplementation(() => { throw new Error("cache unavailable"); });
    const result = await new SubmissionService(repository(true), { now: () => now }).start(3, 1, "09:00");
    expect(result.session.formVersionId).toBe(987654);
    expect(result.capability.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("loads persisted historical versions on miss and coalesces concurrent reads", async () => {
    const cache = new PublishedFormCache();
    const query = jest.fn(async () => [question]);
    const sql = query as unknown as postgres.Sql;
    const [first, second] = await Promise.all([cache.get(sql, 101), cache.get(sql, 101)]);
    expect(first).toEqual([question]);
    expect(second).toEqual([question]);
    expect(query).toHaveBeenCalledTimes(1);
    const historical = await cache.get(sql, 202);
    expect(historical).toEqual([question]);
    expect(query).toHaveBeenCalledTimes(2);
  });
});
