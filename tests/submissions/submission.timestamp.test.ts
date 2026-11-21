import { PostgresSubmissionRepository, timestampToIso, timestampToMillis } from "../../src/modules/submissions/submission.repository.js";

describe("submission database timestamps", () => {
  it("accepts postgres-js Date and string timestamp representations", () => {
    const iso = "2026-01-01T12:00:00.000Z";
    expect(timestampToMillis(iso)).toBe(new Date(iso).getTime());
    expect(timestampToMillis(new Date(iso))).toBe(new Date(iso).getTime());
    expect(timestampToIso(iso)).toBe(iso);
  });

  it("rejects malformed timestamps instead of applying a wrong expiry decision", () => {
    expect(() => timestampToMillis("not-a-timestamp")).toThrow("Timestamp inválido");
  });

  it("validates an invalid score after reading string timestamps from postgres-js", async () => {
    const sql = (async () => [{
      sectorId: 7,
      shiftRangeId: null,
      startedAt: "2026-01-01T12:00:00.000Z",
      lastActivityAt: "2026-01-01T12:00:00.000Z",
      endedAt: null,
      questionId: 10,
      questionKind: "standard" as const,
      isNps: false,
      questionVersionId: 3,
    }]) as unknown as import("postgres").Sql;
    const repository = new PostgresSubmissionRepository(sql);
    await expect(repository.saveAnswer("session", { sessionQuestionId: 1, status: "answered", score: 6 }, new Date("2026-01-01T12:01:00.000Z")))
      .rejects.toMatchObject({ code: "INVALID_ANSWER_SCORE", status: 400 });
  });
});
