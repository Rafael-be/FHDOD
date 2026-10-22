import type postgres from "postgres";

export interface AuditLog { id: number; actorUserId: number | null; action: string; entityType: string; entityId: number | null; oldValues: unknown; newValues: unknown; createdAt: Date; }
export interface AuditCursor { createdAt: Date; id: number; }

/** Read-only repository for append-only administrative audit records. */
export class AuditRepository {
  constructor(private readonly sql: postgres.Sql) {}
  async list(cursor: AuditCursor | null, limit: number): Promise<AuditLog[]> {
    if (!cursor) return this.sql<AuditLog[]>`select id,actor_user_id as "actorUserId",action,entity_type as "entityType",entity_id as "entityId",old_values as "oldValues",new_values as "newValues",created_at as "createdAt" from audit_logs order by created_at desc,id desc limit ${limit}`;
    return this.sql<AuditLog[]>`select id,actor_user_id as "actorUserId",action,entity_type as "entityType",entity_id as "entityId",old_values as "oldValues",new_values as "newValues",created_at as "createdAt" from audit_logs where (created_at,id)<(${cursor.createdAt.toISOString()},${cursor.id}) order by created_at desc,id desc limit ${limit}`;
  }
}
