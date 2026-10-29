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
});
