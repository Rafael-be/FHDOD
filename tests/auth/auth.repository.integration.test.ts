import "dotenv/config";
import { randomUUID } from "node:crypto";
import postgres from "postgres";
import { PostgresAuthRepository } from "../../src/modules/auth/auth.repository.js";

const testUrl=process.env.DATABASE_URL_TEST;const runtimeUrl=process.env.DATABASE_URL;
const integration=testUrl&&runtimeUrl&&new URL(testUrl).href!==new URL(runtimeUrl).href?describe:describe.skip;
integration("PostgresAuthRepository transaction",()=>{
  it("reads current authorization context and rolls back a session write when later work fails",async()=>{const sql=postgres(testUrl!,{max:1});const suffix=randomUUID().slice(0,8);const email=`auth-tx-${suffix}@test.invalid`;let userId:number|undefined;const sessionId=randomUUID();try{const role=await sql<{id:number}[]>`select id from roles where code='superuser'`;const user=await sql<{id:number}[]>`insert into users(role_id,full_name,email,password_hash,created_at,updated_at) values(${role[0]!.id},'Teste',${email},'hash',now(),now()) returning id`;userId=user[0]!.id;const repository=new PostgresAuthRepository(sql);await expect(repository.transaction(async tx=>{await tx.createSession({id:sessionId,userId:userId!,csrfToken:"x".repeat(32),createdAt:new Date(),lastUsedAt:new Date(),expiresAt:new Date(Date.now()+86_400_000),revokedAt:null});await expect(tx.findAuthenticatedSession(sessionId)).resolves.toMatchObject({userId,role:"superuser",deletedAt:null,mustChangePassword:false});throw new Error("ROLLBACK_AUTH_TRANSACTION");})).rejects.toThrow("ROLLBACK_AUTH_TRANSACTION");const rows=await sql<{count:number}[]>`select count(*)::int as count from auth_sessions where id=${sessionId}`;expect(rows[0]!.count).toBe(0);}finally{if(userId)await sql`delete from users where id=${userId}`;await sql.end({timeout:5});}});
});
