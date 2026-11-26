import postgres from "postgres";
import { QuestionsRepository } from "../../src/modules/questions/questions.repository.js";
import { assertDisposableTestDatabase, testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";
const url=testDatabaseUrl(),runtime=process.env.DATABASE_URL;
const integration=usesIsolatedDatabase(url,runtime)?describe:describe.skip;
integration('catalogue and immutable publications',()=>{
  it('persists standard/NPS catalogue entries without publishing or changing snapshots',async()=>{
    await assertDisposableTestDatabase(url!,runtime!);
    const sql=postgres(url!,{max:1});const rollback=new Error('rollback');
    try { await expect(sql.begin(async tx=>{
      const db=tx as unknown as postgres.Sql;
      const [user]=await db<{id:number}[]>`insert into users(role_id,full_name,email,password_hash) select id,'Fixture catalogue',${crypto.randomUUID()+'@test.invalid'},'not-a-login-hash' from roles where code='superuser' returning id`;
      const [sector]=await db<{id:number}[]>`insert into sectors(code,name) values (${crypto.randomUUID()},'Fixture catalogue') returning id`;
      const before=await db`select * from sector_current_forms order by sector_id`;
      const snapshots=await db`select * from submission_form_questions order by form_version_id,position`;
      await db`set local role fhdod_api`;
      const repo=new QuestionsRepository(db);
      const standard=await repo.createStandard('Nouvelle question','selected_sectors',[sector!.id],user!.id);
      const nps=await repo.createNps('NPS fixture','selected_sectors',[sector!.id],user!.id);
      expect(standard).toMatchObject({text:'Nouvelle question',isNps:false});
      expect(nps).toMatchObject({text:'NPS fixture',isNps:true});
      const listed=await repo.listCatalog({sectorId:sector!.id,limit:25,offset:0});
      expect(listed.find(item=>item.id===standard.id)?.questionVersionId).toEqual(expect.any(Number));
      expect(listed.find(item=>item.id===nps.id)?.questionVersionId).toEqual(expect.any(Number));
      expect(await db`select * from sector_current_forms order by sector_id`).toEqual(before);
      expect(await db`select * from submission_form_questions order by form_version_id,position`).toEqual(snapshots);
      throw rollback;
    })).rejects.toBe(rollback); } finally { await sql.end({timeout:5}); }
  });
});
