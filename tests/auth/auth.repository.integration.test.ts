import "dotenv/config";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { PostgresAuthRepository } from "../../src/modules/auth/auth.repository.js";
import { usesIsolatedDatabase } from "../helpers/database.js";

const testUrl=process.env.DATABASE_URL_TEST;const runtimeUrl=process.env.DATABASE_URL;
const integration=usesIsolatedDatabase(testUrl,runtimeUrl)?describe:describe.skip;
integration("PostgresAuthRepository transaction",()=>{
  it("consumes a refresh token even when the application timestamp predates database issuance",async()=>{const sql=postgres(testUrl!,{max:1});const sessionId=randomUUID();const refreshId=randomUUID();try{await expect(sql.begin(async tx=>{const repository=new PostgresAuthRepository(tx as unknown as postgres.Sql);const now=new Date();await tx`insert into auth_sessions(id,user_id,csrf_token,created_at,expires_at) select ${sessionId},id,'x',now(),now()+interval '1 day' from users limit 1`;await repository.createRefresh({id:refreshId,sessionId,tokenHash:`hash-${refreshId}`,expiresAt:new Date(now.getTime()+86_400_000),consumedAt:null});expect(await repository.consumeRefresh(refreshId,new Date(now.getTime()-60_000))).toBe(true);expect(await repository.consumeRefresh(refreshId,now)).toBe(false);const rows=await tx<{valid:boolean}[]>`select consumed_at >= issued_at as valid from auth_refresh_tokens where id=${refreshId}`;expect(rows[0]!.valid).toBe(true);throw new Error("ROLLBACK_REFRESH_CONSUMPTION");})).rejects.toThrow("ROLLBACK_REFRESH_CONSUMPTION");}finally{await sql.end({timeout:5});}});
});
