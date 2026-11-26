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
    let reads = 0;
    const session = {
      sectorId: 7,
      shiftRangeId: null,
      startedAt: "2026-01-01T12:00:00.000Z",
      lastActivityAt: "2026-01-01T12:00:00.000Z",
      expiresAt: "2026-01-01T12:03:00.000Z",
      endedAt: null,
      formVersionId: 801,
      refreshCount: 0,
    };
    const sql = (async () => ++reads === 1 ? [session] : [{ questionId: 10, questionVersionId: 3, questionKind: "standard", isNps: false, text: "Atendimento", position: 1 }]) as unknown as import("postgres").Sql;
    const repository = new PostgresSubmissionRepository(sql);
    await expect(repository.saveAnswer("session", { questionId: 10, questionVersionId: 3, status: "answered", score: 6 }, new Date("2026-01-01T12:01:00.000Z")))
      .rejects.toMatchObject({ code: "INVALID_ANSWER_SCORE", status: 400 });
  });

  it("expires after the three-minute initial deadline", async () => {
    const sql = (async () => [{ sectorId: 7, shiftRangeId: null, startedAt: "2026-01-01T12:00:00Z", expiresAt: "2026-01-01T12:03:00Z", endedAt: null, formVersionId: 1, refreshCount: 0 }]) as unknown as import("postgres").Sql;
    const repository = new PostgresSubmissionRepository(sql);
    const answer = { questionId: 10, questionVersionId: 3, status: "answered" as const, score: 6 };
    await expect(repository.saveAnswer("session", answer, new Date("2026-01-01T12:03:01Z"))).rejects.toMatchObject({ code: "SUBMISSION_EXPIRED", status: 410 });
  });
});
