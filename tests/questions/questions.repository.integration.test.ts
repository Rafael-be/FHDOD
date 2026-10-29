import "dotenv/config";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { jest } from "@jest/globals";
import { QuestionsRepository } from "../../src/modules/questions/questions.repository.js";
import { testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";

const testUrl = testDatabaseUrl();
const describeIntegration = usesIsolatedDatabase(testUrl, process.env.DATABASE_URL) ? describe : describe.skip;

jest.setTimeout(15_000);

describeIntegration("QuestionsRepository PostgreSQL integration", () => {
  it("creates a version, reorders it and rolls back the complete transaction", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await expect(sql.begin(async (tx) => {
        const repository = new QuestionsRepository(tx as unknown as postgres.Sql);
        const [actor] = await tx<{ id: number }[]>`
          insert into users(role_id,full_name,email,password_hash,created_at,updated_at)
          select r.id,${`Question test ${suffix}`},${`question-${suffix}@test.invalid`},'hash',now(),now()
          from roles r where r.code='superuser' returning id`;
        const [sector] = await tx<{ id: number }[]>`
          insert into sectors(code,name,created_at,updated_at) values(${`question-${suffix}`},'Question test',now(),now()) returning id`;
        const question = await repository.createSector(sector!.id, "Texto inicial", 1, actor!.id);
        const updated = await repository.updateText(question.id, "Texto revisado", actor!.id);
        expect(updated).toMatchObject({ id: question.id, versionNumber: 2, text: "Texto revisado" });
        expect((await repository.listEffective(sector!.id, false))[0]).toMatchObject({ id: question.id, text: "Texto revisado" });
        const standard = await repository.createStandard("Pergunta padrão", "all_sectors", [], 1, actor!.id);
        const updatedStandard = await repository.updateText(standard.id, "Texto padrão revisado", actor!.id);
        expect(updatedStandard).toMatchObject({ id: standard.id, questionKind: "standard", versionNumber: 2, text: "Texto padrão revisado" });
        const [secondSector] = await tx<{ id: number }[]>`
          insert into sectors(code,name,created_at,updated_at) values(${`question-second-${suffix}`},'Question test 2',now(),now()) returning id`;
        await repository.inheritForSectorOn(tx as unknown as postgres.Sql, secondSector!.id, actor!.id);
        expect((await repository.listEffective(secondSector!.id, false)).map((item) => item.id)).toContain(standard.id);
        await repository.reorderSectorQuestions(sector!.id, [question.id]);
        await repository.audit(actor!.id, "question.integration", question.id);
        throw new Error("ROLLBACK_TEST");
      })).rejects.toThrow("ROLLBACK_TEST");
      const remains = await sql<{ count: number }[]>`select count(*)::int as count from sectors where code=${`question-${suffix}`}`;
      expect(remains[0]!.count).toBe(0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("keeps the active NPS assignment unique per sector", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await expect(sql.begin(async (tx) => {
        const repository = new QuestionsRepository(tx as unknown as postgres.Sql);
        const [actor] = await tx<{ id: number }[]>`
          insert into users(role_id,full_name,email,password_hash,created_at,updated_at)
          select r.id,${`NPS test ${suffix}`},${`nps-${suffix}@test.invalid`},'hash',now(),now()
          from roles r where r.code='superuser' returning id`;
        const [sector] = await tx<{ id: number }[]>`
          insert into sectors(code,name,created_at,updated_at) values(${`nps-${suffix}`},'NPS test',now(),now()) returning id`;
        const nps = await repository.createNps("NPS específico", "selected_sectors", [sector!.id], actor!.id);
        await expect(repository.assignNps(sector!.id, nps.id, actor!.id, false)).rejects.toThrow();
        throw new Error("ROLLBACK_TEST");
      })).rejects.toThrow("ROLLBACK_TEST");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("keeps the active global NPS and current question version unique", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await expect(sql.begin(async (tx) => {
        const repository = new QuestionsRepository(tx as unknown as postgres.Sql);
        const [actor] = await tx<{ id: number }[]>`
          insert into users(role_id,full_name,email,password_hash,created_at,updated_at)
          select r.id,${`Global NPS ${suffix}`},${`global-nps-${suffix}@test.invalid`},'hash',now(),now()
          from roles r where r.code='superuser' returning id`;
        const nps = await repository.createNps("NPS global", "all_sectors", [], actor!.id);
        await expect(repository.createNps("Segundo NPS global", "all_sectors", [], actor!.id)).rejects.toMatchObject({ code: "23505" });
        return nps;
      })).rejects.toMatchObject({ code: "23505" });
      await expect(sql.begin(async (tx) => {
        const repository = new QuestionsRepository(tx as unknown as postgres.Sql);
        const [actor] = await tx<{ id: number }[]>`
          insert into users(role_id,full_name,email,password_hash,created_at,updated_at)
          select r.id,${`Version NPS ${suffix}`},${`version-nps-${suffix}@test.invalid`},'hash',now(),now()
          from roles r where r.code='superuser' returning id`;
        const nps = await repository.createNps("NPS global", "all_sectors", [], actor!.id);
        await expect(tx`
          insert into question_versions(question_id,version_number,text,is_current,created_by_user_id)
          values(${nps.id},2,'Versão concorrente',true,${actor!.id})
        `).rejects.toMatchObject({ code: "23505" });
        throw new Error("ROLLBACK_TEST");
      })).rejects.toThrow("ROLLBACK_TEST");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("resolves a dynamic global NPS and restores it after an override ends", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await expect(sql.begin(async (tx) => {
        const repository = new QuestionsRepository(tx as unknown as postgres.Sql);
        const [actor] = await tx<{ id: number }[]>`
          insert into users(role_id,full_name,email,password_hash,created_at,updated_at)
          select r.id,${`Dynamic NPS ${suffix}`},${`dynamic-nps-${suffix}@test.invalid`},'hash',now(),now()
          from roles r where r.code='superuser' returning id`;
        const [sector] = await tx<{ id: number }[]>`
          insert into sectors(code,name,created_at,updated_at)
          values(${`dynamic-nps-${suffix}`},'Dynamic NPS test',now(),now()) returning id`;
        const global = await repository.createNps("NPS global", "all_sectors", [], actor!.id);
        expect((await tx<{ count: number }[]>`select count(*)::int as count from sector_nps_assignments where question_id=${global.id}`)[0]?.count)
          .toBe(0);
        expect(await repository.listEffective(sector!.id, false)).toEqual(expect.arrayContaining([expect.objectContaining({ id: global.id, npsSource: "global" })]));
        const override = await repository.createNps("NPS override", "selected_sectors", [sector!.id], actor!.id);
        expect(await repository.listEffective(sector!.id, false)).toEqual(expect.arrayContaining([expect.objectContaining({ id: override.id, npsSource: "specific" })]));
        await repository.endAssignments(override.id, true);
        expect(await repository.listEffective(sector!.id, false)).toEqual(expect.arrayContaining([expect.objectContaining({ id: global.id, npsSource: "global" })]));
        throw new Error("ROLLBACK_TEST");
      })).rejects.toThrow("ROLLBACK_TEST");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("lists the administrative catalogue with filters and current associations", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await expect(sql.begin(async (tx) => {
        const repository = new QuestionsRepository(tx as unknown as postgres.Sql);
        const [actor] = await tx<{ id: number }[]>`insert into users(role_id,full_name,email,password_hash,created_at,updated_at) select id,${`Catalogue ${suffix}`},${`catalogue-${suffix}@test.invalid`},'hash',now(),now() from roles where code='superuser' returning id`;
        const [sector] = await tx<{ id: number }[]>`insert into sectors(code,name,created_at,updated_at) values(${`catalogue-${suffix}`},'Catalogue',now(),now()) returning id`;
        const standard = await repository.createStandard("Catalogue standard", "selected_sectors", [sector!.id], 1, actor!.id);
        const nps = await repository.createNps("Catalogue NPS", "selected_sectors", [sector!.id], actor!.id);
        const standards = await repository.listCatalog({ type: "standard", state: "active", sectorId: sector!.id, limit: 25, offset: 0 });
        expect(standards).toEqual(expect.arrayContaining([expect.objectContaining({ id: standard.id, associations: [expect.objectContaining({ sectorId: sector!.id, active: true })] })]));
        const npsRows = await repository.listCatalog({ type: "nps", state: "active", sectorId: sector!.id, limit: 25, offset: 0 });
        expect(npsRows).toEqual(expect.arrayContaining([expect.objectContaining({ id: nps.id })]));
        expect(await repository.catalogQuestion(nps.id)).toMatchObject({ id: nps.id, total: 1 });
        throw new Error("ROLLBACK_TEST");
      })).rejects.toThrow("ROLLBACK_TEST");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
