import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const migrationsDirectory = resolve(process.cwd(), "src/db/migrations");

const preservedHashes: Record<string, string> = {
  "0000_enforce_runtime_rls_policies": "b642fb03d4c9b7a6058adc35f89d55faae427dfea122ad19d9e1d058997dde73",
  "0001_add_questions_runtime_rls": "2fd073c471546c8dc202f4ad12b6f49082e49844b6e256030416351791221dc1",
  "0002_add_question_versions_update_rls": "9ea865b9f2e509496bec3f19c0de48c17ae3e133bd0b77aa5bcbd8e1ff8d9726",
  "0003_make_global_nps_dynamic": "90954af8cff4f995c7194fd31f5a10ad42e17e74229517777afbd7bbbeaf9539",
  "0004_reconcile_runtime_rls_phase3": "dd79954fcea2b059ad855fa3fe18cc56100c9f62c1ad40f4922f9feac62a3aeb",
  "0006_enforce_question_link_integrity": "d4f6245133125beddd6f92dc8ac863d1c0a4b4cbbd0a4648335b3aeab6c7c88a",
  "0007_enforce_nps_scope_integrity": "87026f0698c32a8b23b5316cc6b1917c29fd42aaa48fec108c895a0c3d7265ab",
};

describe("Drizzle migration inventory", () => {
  it("keeps the journal monotonic and every listed migration addressable", async () => {
    const journal = JSON.parse(await readFile(resolve(migrationsDirectory, "meta/_journal.json"), "utf8")) as {
      entries: Array<{ idx: number; when: number; tag: string }>;
    };

    expect(new Set(journal.entries.map((entry) => entry.idx)).size).toBe(journal.entries.length);
    expect(new Set(journal.entries.map((entry) => entry.tag)).size).toBe(journal.entries.length);
    expect(journal.entries.map((entry) => entry.when)).toEqual([...journal.entries]
      .sort((left, right) => left.when - right.when)
      .map((entry) => entry.when));

    for (const entry of journal.entries) {
      await expect(readFile(resolve(migrationsDirectory, `${entry.tag}.sql`), "utf8")).resolves.toBeTruthy();
    }

    expect(journal.entries.at(-1)).toMatchObject({ idx: 7, tag: "0007_enforce_nps_scope_integrity" });
  });

  it("preserves hashes already recorded or pending in the approved sequence", async () => {
    for (const [tag, expectedHash] of Object.entries(preservedHashes)) {
      const sql = await readFile(resolve(migrationsDirectory, `${tag}.sql`), "utf8");
      expect(createHash("sha256").update(sql).digest("hex")).toBe(expectedHash);
    }
  });

  it("allows only the documented Phase 3 orphan outside the journal", async () => {
    const journal = JSON.parse(await readFile(resolve(migrationsDirectory, "meta/_journal.json"), "utf8")) as {
      entries: Array<{ tag: string }>;
    };
    const files = (await readdir(migrationsDirectory))
      .filter((file) => file.endsWith(".sql"))
      .map((file) => file.slice(0, -4));
    const unlisted = files.filter((tag) => !journal.entries.some((entry) => entry.tag === tag));

    expect(unlisted).toEqual(["0001_shift_sheet_versions"]);
  });
});
