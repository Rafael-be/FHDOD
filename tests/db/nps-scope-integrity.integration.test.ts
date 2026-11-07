import "dotenv/config";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";

const testUrl = testDatabaseUrl();
const describeIntegration = usesIsolatedDatabase(testUrl, process.env.DATABASE_URL) ? describe : describe.skip;

describeIntegration("NPS scope integrity PostgreSQL integration", () => {
  it("allows selected-sector overrides while rejecting global materialization and scope changes", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    const suffix = randomUUID().slice(0, 8);
    try {
      await expect(sql.begin(async (tx) => {
        const [actor] = await tx<{ id: number }[]>`
          insert into users(role_id,full_name,email,password_hash,created_at,updated_at)
          select id,${`NPS scope ${suffix}`},${`nps-scope-${suffix}@test.invalid`},'hash',now(),now()
          from roles where code='superuser' returning id`;
        const [sector] = await tx<{ id: number }[]>`
          insert into sectors(code,name,created_at,updated_at)
          values(${`nps-scope-${suffix}`},'NPS scope',now(),now()) returning id`;
        const [otherSector] = await tx<{ id: number }[]>`
          insert into sectors(code,name,created_at,updated_at)
          values(${`nps-scope-other-${suffix}`},'NPS scope other',now(),now()) returning id`;
        const [override] = await tx<{ id: number }[]>`
          insert into questions(question_kind,scope,sector_id,is_nps,display_order,created_by_user_id)
          values('standard','selected_sectors',null,true,2147483647,${actor!.id}) returning id`;
        await tx`
          insert into sector_nps_assignments(sector_id,question_id,assignment_source,assigned_by_user_id)
          values(${sector!.id},${override!.id},'specific',${actor!.id})`;
        await expect(tx.savepoint((savepoint) => savepoint`
          update questions set scope='all_sectors' where id=${override!.id}`)).rejects.toMatchObject({ code: "23514" });
        await expect(tx.savepoint((savepoint) => savepoint`
          insert into sector_nps_assignments(sector_id,question_id,assignment_source,assigned_by_user_id)
          values(${otherSector!.id},${override!.id},'global',${actor!.id})`)).rejects.toMatchObject({ code: "23514" });
        await tx`
          update sector_nps_assignments
          set ended_at=now()
          where sector_id=${sector!.id} and question_id=${override!.id}`;
        const [{ count: closedOverrideCount }] = await tx<{ count: string }[]>`
          select count(*)::text as count
          from sector_nps_assignments
          where sector_id=${sector!.id} and question_id=${override!.id} and ended_at is not null`;
        expect(closedOverrideCount).toBe("1");
        const [otherOverride] = await tx<{ id: number }[]>`
          insert into questions(question_kind,scope,sector_id,is_nps,display_order,created_by_user_id)
          values('standard','selected_sectors',null,true,2147483647,${actor!.id}) returning id`;
        await expect(tx.savepoint((savepoint) => savepoint`
          update sector_nps_assignments set question_id=${otherOverride!.id}
          where sector_id=${sector!.id} and question_id=${override!.id}`)).rejects.toMatchObject({ code: "23514" });
        await expect(tx.savepoint((savepoint) => savepoint`
          update sector_nps_assignments set sector_id=${otherSector!.id}
          where sector_id=${sector!.id} and question_id=${override!.id}`)).rejects.toMatchObject({ code: "23514" });
        await expect(tx.savepoint((savepoint) => savepoint`
          update sector_nps_assignments set assigned_at=assigned_at - interval '1 minute'
          where sector_id=${sector!.id} and question_id=${override!.id}`)).rejects.toMatchObject({ code: "23514" });
        await expect(tx.savepoint((savepoint) => savepoint`
          update sector_nps_assignments set assigned_by_user_id=null
          where sector_id=${sector!.id} and question_id=${override!.id}`)).rejects.toMatchObject({ code: "23514" });
        await expect(tx.savepoint((savepoint) => savepoint`
          update sector_nps_assignments set assignment_source='global'
          where sector_id=${sector!.id} and question_id=${override!.id}`)).rejects.toMatchObject({ code: "23514" });
        await expect(tx.savepoint((savepoint) => savepoint`
          update sector_nps_assignments set ended_at=ended_at + interval '1 minute'
          where sector_id=${sector!.id} and question_id=${override!.id}`)).rejects.toMatchObject({ code: "23514" });

        await tx`update questions set deleted_at=now() where is_nps=true and scope='all_sectors' and deleted_at is null`;
        const [global] = await tx<{ id: number }[]>`
          insert into questions(question_kind,scope,sector_id,is_nps,display_order,created_by_user_id)
          values('standard','all_sectors',null,true,2147483647,${actor!.id}) returning id`;
        await tx`set local session_replication_role = replica`;
        const [legacy] = await tx<{ id: number }[]>`
          insert into sector_nps_assignments(
            sector_id,question_id,assignment_source,assigned_by_user_id,ended_at
          )
          values(${otherSector!.id},${global!.id},'specific',${actor!.id},now()) returning id`;
        await tx`set local session_replication_role = origin`;
        const [{ count: closedHistoryCount }] = await tx<{ count: string }[]>`
          select count(*)::text as count
          from sector_nps_assignments
          where question_id=${global!.id} and ended_at is not null`;
        expect(closedHistoryCount).toBe("1");
        await expect(tx.savepoint((savepoint) => savepoint`
          update sector_nps_assignments set ended_at=null where id=${legacy!.id}`)).rejects.toMatchObject({ code: "23514" });
        await expect(tx.savepoint((savepoint) => savepoint`
          update sector_nps_assignments set assignment_source='global' where id=${legacy!.id}`)).rejects.toMatchObject({ code: "23514" });
        await expect(tx.savepoint((savepoint) => savepoint`
          insert into sector_nps_assignments(
            sector_id,question_id,assignment_source,assigned_by_user_id,ended_at
          )
          values(${sector!.id},${global!.id},'specific',${actor!.id},now())`)).rejects.toMatchObject({ code: "23514" });
        await expect(tx.savepoint((savepoint) => savepoint`
          insert into sector_nps_assignments(sector_id,question_id,assignment_source,assigned_by_user_id)
          values(${otherSector!.id},${global!.id},'global',${actor!.id})`)).rejects.toMatchObject({ code: "23514" });
        throw new Error("ROLLBACK_TEST");
      })).rejects.toThrow("ROLLBACK_TEST");
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
