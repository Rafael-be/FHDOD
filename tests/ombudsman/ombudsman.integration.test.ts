import postgres from "postgres";
import { OmbudsmanRepository } from "../../src/modules/ombudsman/ombudsman.repository.js";
import { assertDisposableTestDatabase, testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";

const url = testDatabaseUrl();
const runtime = process.env.DATABASE_URL;
const integration = usesIsolatedDatabase(url, runtime) ? describe : describe.skip;

integration("ombudsman shift association on disposable PostgreSQL", () => {
  it("uses the requested sector range and leaves shift metadata empty outside a range", async () => {
    await assertDisposableTestDatabase(url!, runtime!);
    const sql = postgres(url!, { max: 1 });
    const rollback = new Error("rollback");
    try {
      await expect(sql.begin(async tx => {
        const db = tx as unknown as postgres.Sql;
        const [sectorA] = await db<{ id: number }[]>`insert into sectors(code,name) values (${crypto.randomUUID()},'Ombudsman A') returning id`;
        const [sectorB] = await db<{ id: number }[]>`insert into sectors(code,name) values (${crypto.randomUUID()},'Ombudsman B') returning id`;
        const [{ nextVersion }] = await db<{ nextVersion: number }[]>`select coalesce(max(version_number),0)+1 as "nextVersion" from shift_sheet_versions`;
        await db`update shift_sheet_versions set is_current=false where is_current=true`;
        const [sheet] = await db<{ id: number }[]>`insert into shift_sheet_versions(version_number,is_current,valid_from) values (${nextVersion},true,'2052-01-01T00:00:00Z') returning id`;
        const ranges = await db<{ id: number; sectorId: number }[]>`
          insert into sector_shift_ranges(shift_sheet_version_id,sector_id,shift_name,starts_at,ends_at)
          values (${sheet!.id},${sectorA!.id},'A','08:00','10:00'),(${sheet!.id},${sectorB!.id},'B','08:00','10:00')
          returning id,"sector_id" as "sectorId"`;
        let [policy] = await db<{ id: number }[]>`select v.id from content_page_versions v join content_pages p on p.id=v.page_id
          where p.slug='lgpd' and v.is_current=true and length(btrim(v.content))>0 limit 1`;
        if (!policy) {
          const [page] = await db<{ id: number }[]>`insert into content_pages(slug,title) values ('lgpd', 'LGPD fixture') returning id`;
          [policy] = await db<{ id: number }[]>`insert into content_page_versions(page_id,version_number,content,is_current)
            values (${page!.id},1,'Consent',true) returning id`;
        }
        await db`set local role fhdod_api`;
        const repository = new OmbudsmanRepository(db);
        const inside = await repository.create({ sectorId: sectorA!.id, ticketType: "complaint", body: "Inside", acceptedPolicyVersionId: policy!.id }, new Date("2052-01-01T12:00:00Z"));
        const [insideRow] = await db<{ sectorId: number; versionId: number; rangeId: number }[]>`select sector_id as "sectorId", shift_sheet_version_id as "versionId", shift_range_id as "rangeId" from ombudsman_tickets where id=${inside.id}`;
        expect(insideRow).toEqual({ sectorId: sectorA!.id, versionId: sheet!.id, rangeId: ranges.find(range => range.sectorId === sectorA!.id)!.id });
        const outside = await repository.create({ sectorId: sectorA!.id, ticketType: "complaint", body: "Outside", acceptedPolicyVersionId: policy!.id }, new Date("2052-01-01T14:00:00Z"));
        const [outsideRow] = await db<{ versionId: number | null; rangeId: number | null }[]>`select shift_sheet_version_id as "versionId", shift_range_id as "rangeId" from ombudsman_tickets where id=${outside.id}`;
        expect(outsideRow).toEqual({ versionId: null, rangeId: null });
        throw rollback;
      })).rejects.toBe(rollback);
    } finally { await sql.end({ timeout: 5 }); }
  });
});
