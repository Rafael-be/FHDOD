import { AuditService, decodeAuditCursor } from "../src/modules/audit/audit.service.js";
import type { AuditRepository } from "../src/modules/audit/audit.repository.js";
import type { AuthIdentity } from "../src/modules/auth/auth.service.js";

const admin: AuthIdentity={userId:1,sessionId:"session",role:"superuser",mustChangePassword:false};
const manager: AuthIdentity={userId:2,sessionId:"session",role:"sector_manager",mustChangePassword:false};
describe("AuditService",()=>{
  it("returns a stable cursor for a superuser",async()=>{const repository={list:async()=>[{id:3,actorUserId:1,action:"sector.created",entityType:"sector",entityId:1,oldValues:null,newValues:{code:"uti"},createdAt:new Date("2026-01-01T00:00:00Z")}]} as unknown as AuditRepository;const result=await new AuditService(repository).list(admin,null,50);expect(result.records).toHaveLength(1);expect(decodeAuditCursor(result.nextCursor!)).toEqual({id:3,createdAt:new Date("2026-01-01T00:00:00Z")});});
  it("rejects a non-superuser and malformed cursor",async()=>{const repository={list:async()=>[]} as unknown as AuditRepository;await expect(new AuditService(repository).list(manager,null,50)).rejects.toMatchObject({code:"FORBIDDEN"});expect(()=>decodeAuditCursor("not-a-cursor")).toThrow("Cursor");});
});
