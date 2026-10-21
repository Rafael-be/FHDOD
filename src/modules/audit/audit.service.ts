import { DomainError } from "../../shared/core.js";
import type { AuthIdentity } from "../auth/auth.service.js";
import { AuditRepository, type AuditCursor } from "./audit.repository.js";

const encode = (cursor: AuditCursor) => Buffer.from(JSON.stringify({ createdAt: cursor.createdAt.toISOString(), id: cursor.id })).toString("base64url");
export function decodeAuditCursor(value: string | undefined): AuditCursor | null { if (!value) return null; try { const parsed=JSON.parse(Buffer.from(value,"base64url").toString("utf8")) as {createdAt: string; id: number}; const createdAt=new Date(parsed.createdAt); if(!Number.isInteger(parsed.id)||Number.isNaN(createdAt.getTime())) throw new Error(); return {createdAt,id:parsed.id}; } catch { throw new DomainError("INVALID_CURSOR","Cursor de paginação inválido.",400); } }

/** Provides cursor-based audit history exclusively to superusers. */
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}
  async list(actor: AuthIdentity, cursor: AuditCursor | null, limit: number) { if(actor.role!=="superuser") throw new DomainError("FORBIDDEN","Somente superusuário pode consultar a auditoria.",403); const records=await this.repository.list(cursor,limit); const last=records.at(-1); return { records, nextCursor: last ? encode({createdAt:last.createdAt,id:last.id}) : null }; }
}
