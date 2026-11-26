import postgres from "postgres";
import { HealthRepository } from "../../src/modules/health/health.repository.js";
import { HealthService } from "../../src/modules/health/health.service.js";
import { assertDisposableTestDatabase,testDatabaseUrl,usesIsolatedDatabase } from "../helpers/database.js";
const url=testDatabaseUrl(),runtime=process.env.DATABASE_URL;
const integration=usesIsolatedDatabase(url,runtime)?describe:describe.skip;
integration('schema readiness',()=>{
  it('detects the missing 0015 table and accepts migrated runtime',async()=>{
    await assertDisposableTestDatabase(url!,runtime!);
    const sql=postgres(url!,{max:1});const rollback=new Error('rollback');
    try{
      await expect(sql.begin(async tx=>{
        const db=tx as unknown as postgres.Sql;
        await db`set local role fhdod_api`;
        await expect(new HealthService(new HealthRepository(db)).ready()).resolves.toEqual({status:'ok'});
        await db`reset role`;
        await db`alter table sector_current_forms rename to fixture_hidden_current_forms`;
        await db`set local role fhdod_api`;
        await expect(new HealthService(new HealthRepository(db)).ready()).rejects.toMatchObject({code:'DATABASE_SCHEMA_NOT_READY',status:503,details:{missingObjects:expect.arrayContaining(['public.sector_current_forms'])}});
        throw rollback;
      })).rejects.toBe(rollback);
    }finally{await sql.end({timeout:5});}
  });
});
