import type postgres from "postgres";
import { PublishedFormCache } from "../../src/modules/submissions/form-cache.js";

describe("published form cache", () => {
  it("loads an immutable version once and reloads it after process restart", async () => {
    let reads = 0;
    const question = { questionId: 17, questionVersionId: 23, text: "Atendimento", questionKind: "sector" as const, isNps: false, position: 1 };
    const sql = (async () => { reads++; return [question]; }) as unknown as postgres.Sql;
    const first = new PublishedFormCache();
    expect(await first.get(sql, 41)).toEqual([question]);
    expect(await first.get(sql, 41)).toEqual([question]);
    expect(reads).toBe(1);
    const restarted = new PublishedFormCache();
    expect(await restarted.get(sql, 41)).toEqual([question]);
    expect(reads).toBe(2);
  });
});
