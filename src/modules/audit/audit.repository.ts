import type postgres from "postgres";

export interface AuditLog {
  id: number;
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId: number | null;
  oldValues: unknown;
  newValues: unknown;
  createdAt: Date;
}

/** Exact UTC representation returned by PostgreSQL for keyset pagination. */
export type AuditTimestamp = string;

export interface AuditCursor {
  createdAt: AuditTimestamp;
  id: number;
}

export interface AuditPageRecord extends AuditLog {
  cursorTimestamp: AuditTimestamp;
}

interface RawAuditLog {
  id: number;
  actorUserId: number | null;
  action: string;
  entityType: string;
  entityId: number | null;
  oldValues: unknown;
  newValues: unknown;
  createdAt: unknown;
  cursorTimestamp: unknown;
}

function timestamp(value: unknown, column: string): Date {
  const result = value instanceof Date
    ? new Date(value.getTime())
    : typeof value === "string"
      ? new Date(value)
      : null;

  if (!result || Number.isNaN(result.getTime())) {
    throw new Error(`Timestamp PostgreSQL inválido em ${column}.`);
  }

  return result;
}

function cursorTimestamp(value: unknown): AuditTimestamp {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) {
    throw new Error("Timestamp PostgreSQL inválido em audit_logs.created_at.");
  }

  return value;
}

function auditLog(row: RawAuditLog): AuditPageRecord {
  return {
    id: row.id,
    actorUserId: row.actorUserId,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    oldValues: row.oldValues,
    newValues: row.newValues,
    createdAt: timestamp(row.createdAt, "audit_logs.created_at"),
    cursorTimestamp: cursorTimestamp(row.cursorTimestamp),
  };
}

/** Read-only repository for append-only administrative audit records. */
export class AuditRepository {
  constructor(private readonly sql: postgres.Sql) {}

  async list(cursor: AuditCursor | null, limit: number): Promise<AuditPageRecord[]> {
    const rows = cursor
      ? await this.sql<RawAuditLog[]>`
          select
            id,
            actor_user_id as "actorUserId",
            action,
            entity_type as "entityType",
            entity_id as "entityId",
            old_values as "oldValues",
            new_values as "newValues",
            created_at as "createdAt",
            to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorTimestamp"
          from audit_logs
          where (created_at, id) < (${cursor.createdAt}::timestamptz, ${cursor.id})
          order by created_at desc, id desc
          limit ${limit}
        `
      : await this.sql<RawAuditLog[]>`
          select
            id,
            actor_user_id as "actorUserId",
            action,
            entity_type as "entityType",
            entity_id as "entityId",
            old_values as "oldValues",
            new_values as "newValues",
            created_at as "createdAt",
            to_char(created_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as "cursorTimestamp"
          from audit_logs
          order by created_at desc, id desc
          limit ${limit}
        `;

    return rows.map(auditLog);
  }
}
