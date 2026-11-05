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
        const question = await repository.createSector(sector!.id, "Texto inicial", actor!.id);
        const updated = await repository.updateText(question.id, "Texto revisado", actor!.id);
        expect(updated).toMatchObject({ id: question.id, versionNumber: 2, text: "Texto revisado" });
        expect((await repository.listEffective(sector!.id, false))[0]).toMatchObject({ id: question.id, text: "Texto revisado" });
        const standard = await repository.createStandard("Pergunta padrão", "all_sectors", [], actor!.id);
        const updatedStandard = await repository.updateText(standard.id, "Texto padrão revisado", actor!.id);
        expect(updatedStandard).toMatchObject({ id: standard.id, questionKind: "standard", versionNumber: 2, text: "Texto padrão revisado" });
        const [secondSector] = await tx<{ id: number }[]>`
          insert into sectors(code,name,created_at,updated_at) values(${`question-second-${suffix}`},'Question test 2',now(),now()) returning id`;
        await repository.inheritForSectorOn(tx as unknown as postgres.Sql, secondSector!.id, actor!.id);
        const firstEffective = await repository.listEffective(sector!.id, false);
        const secondEffective = await repository.listEffective(secondSector!.id, false);
        expect(firstEffective.find((item) => item.id === standard.id)?.id).toBe(standard.id);
        expect(secondEffective.find((item) => item.id === standard.id)?.id).toBe(standard.id);
        expect(secondEffective.map((item) => item.id)).not.toContain(question.id);
        expect(secondEffective.map((item) => item.id)).toContain(standard.id);
        const secondStandard = await repository.createStandard("Outra pergunta padrão", "all_sectors", [], actor!.id);
        const firstOrder = await tx<{ displayOrder: number }[]>`select display_order as "displayOrder" from question_sector_assignments where question_id=${standard.id} and sector_id=${sector!.id} and ended_at is null`;
        const secondOrder = await tx<{ displayOrder: number }[]>`select display_order as "displayOrder" from question_sector_assignments where question_id=${secondStandard.id} and sector_id=${sector!.id} and ended_at is null`;
        expect(firstOrder[0]?.displayOrder).toBe(2);
        expect(secondOrder[0]?.displayOrder).toBe(3);
        await repository.setStandardAssignmentActive(standard.id, sector!.id, false);
        expect((await repository.listEffective(sector!.id, false)).map((item) => item.id)).not.toContain(standard.id);
        expect((await repository.listEffective(secondSector!.id, false)).map((item) => item.id)).toContain(standard.id);
        await repository.reorderSectorQuestions(sector!.id, [question.id, secondStandard.id]);
        await repository.setStandardAssignmentActive(standard.id, sector!.id, true);
        const reactivated = await repository.listEffective(sector!.id, false);
        expect(reactivated.map((item) => item.id)).toEqual([question.id, secondStandard.id, standard.id]);
        expect(reactivated.map((item) => item.displayOrder)).toEqual([1, 2, 3]);
        await repository.audit(actor!.id, "question.integration", question.id);
        throw new Error("ROLLBACK_TEST");
      })).rejects.toThrow("ROLLBACK_TEST");
      const remains = await sql<{ count: number }[]>`select count(*)::int as count from sectors where code=${`question-${suffix}`}`;
      expect(remains[0]!.count).toBe(0);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("always returns NPS last after common questions are reordered", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await expect(sql.begin(async (tx) => {
        const repository = new QuestionsRepository(tx as unknown as postgres.Sql);
        const [actor] = await tx<{ id: number }[]>`
          insert into users(role_id,full_name,email,password_hash,created_at,updated_at)
          select r.id,${`NPS order test ${suffix}`},${`nps-order-${suffix}@test.invalid`},'hash',now(),now()
          from roles r where r.code='superuser' returning id`;
        const [sector] = await tx<{ id: number }[]>`
          insert into sectors(code,name,created_at,updated_at)
          values(${`nps-order-${suffix}`},'NPS order test',now(),now()) returning id`;
        const local = await repository.createSector(sector!.id, "Pergunta local", actor!.id);
        const standard = await repository.createStandard("Pergunta padrão", "selected_sectors", [sector!.id], actor!.id);
        const nps = await repository.createNps("NPS específico", "selected_sectors", [sector!.id], actor!.id);

        await repository.reorderSectorQuestions(sector!.id, [standard.id, local.id]);

        const effective = await repository.listEffective(sector!.id, false);
        expect(effective.at(-1)).toMatchObject({ id: nps.id, isNps: true, displayOrder: 2147483647 });
        expect(effective.slice(0, -1).every((item) => !item.isNps)).toBe(true);
        throw new Error("ROLLBACK_TEST");
      })).rejects.toThrow("ROLLBACK_TEST");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("restores a standard link position when free and appends it after a sector-question conflict", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await expect(sql.begin(async (tx) => {
        const repository = new QuestionsRepository(tx as unknown as postgres.Sql);
        const [actor] = await tx<{ id: number }[]>`
          insert into users(role_id,full_name,email,password_hash,created_at,updated_at)
          select id,${`Reactivation ${suffix}`},${`reactivation-${suffix}@test.invalid`},'hash',now(),now()
          from roles where code='superuser' returning id`;
        const [sector] = await tx<{ id: number }[]>`
          insert into sectors(code,name,created_at,updated_at)
          values(${`reactivation-${suffix}`},'Reactivation',now(),now()) returning id`;
        const [otherSector] = await tx<{ id: number }[]>`
          insert into sectors(code,name,created_at,updated_at)
          values(${`reactivation-other-${suffix}`},'Other sector',now(),now()) returning id`;

        const local = await repository.createSector(sector!.id, "Local", actor!.id);
        const standard = await repository.createStandard("Padrão", "selected_sectors", [sector!.id, otherSector!.id], actor!.id);
        const tail = await repository.createSector(sector!.id, "Local final", actor!.id);
        const nps = await repository.createNps("NPS", "selected_sectors", [sector!.id], actor!.id);

        await repository.setStandardAssignmentActive(standard.id, sector!.id, false);
        await repository.reorderSectorQuestions(sector!.id, [tail.id, local.id]);
        await repository.setStandardAssignmentActive(standard.id, sector!.id, true);

        const effective = await repository.listEffective(sector!.id, false);
        expect(effective.map((item) => item.id)).toEqual([tail.id, local.id, standard.id, nps.id]);
        expect(effective.map((item) => item.displayOrder)).toEqual([1, 2, 3, 2147483647]);
        expect(new Set(effective.slice(0, -1).map((item) => item.displayOrder)).size).toBe(3);
        expect((await repository.listEffective(otherSector!.id, false)).map((item) => item.id)).toContain(standard.id);

        await repository.setStandardAssignmentActive(standard.id, sector!.id, false);
        await repository.setStandardAssignmentActive(standard.id, sector!.id, true);
        expect((await repository.listEffective(sector!.id, false)).find((item) => item.id === standard.id)?.displayOrder).toBe(3);
        throw new Error("ROLLBACK_TEST");
      })).rejects.toThrow("ROLLBACK_TEST");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  it("rejects incompatible direct links while accepting valid standard and NPS links", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await expect(sql.begin(async (tx) => {
        const repository = new QuestionsRepository(tx as unknown as postgres.Sql);
        const [actor] = await tx<{ id: number }[]>`
          insert into users(role_id,full_name,email,password_hash,created_at,updated_at)
          select id,${`Integrity ${suffix}`},${`integrity-${suffix}@test.invalid`},'hash',now(),now()
          from roles where code='superuser' returning id`;
        const [sector] = await tx<{ id: number }[]>`
          insert into sectors(code,name,created_at,updated_at)
          values(${`integrity-${suffix}`},'Integrity',now(),now()) returning id`;
        const local = await repository.createSector(sector!.id, "Local", actor!.id);
        const standard = await repository.createStandard("Padrão", "selected_sectors", [sector!.id], actor!.id);
        const nps = await repository.createNps("NPS", "selected_sectors", [sector!.id], actor!.id);

        await expect(tx.savepoint((savepoint) => savepoint`insert into question_sector_assignments(question_id,sector_id,assignment_source,display_order) values(${local.id},${sector!.id},'selected',99)`)).rejects.toMatchObject({ code: "23514" });
        await expect(tx.savepoint((savepoint) => savepoint`insert into question_sector_assignments(question_id,sector_id,assignment_source,display_order) values(${nps.id},${sector!.id},'selected',99)`)).rejects.toMatchObject({ code: "23514" });
        await expect(tx.savepoint((savepoint) => savepoint`insert into sector_nps_assignments(sector_id,question_id,assignment_source) values(${sector!.id},${standard.id},'specific')`)).rejects.toMatchObject({ code: "23514" });
        expect(await repository.listEffective(sector!.id, false)).toEqual(expect.arrayContaining([
          expect.objectContaining({ id: standard.id }),
          expect.objectContaining({ id: nps.id }),
        ]));
        throw new Error("ROLLBACK_TEST");
      })).rejects.toThrow("ROLLBACK_TEST");
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
        const standard = await repository.createStandard("Catalogue standard", "selected_sectors", [sector!.id], actor!.id);
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
