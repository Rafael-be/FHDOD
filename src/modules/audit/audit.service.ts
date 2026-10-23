import { DomainError } from "../../shared/core.js";
import type { AuthIdentity } from "../auth/auth.service.js";
import {
  type AuditCursor,
  type AuditLog,
  AuditRepository,
  type AuditTimestamp,
} from "./audit.repository.js";

interface EncodedAuditCursor {
  createdAt: AuditTimestamp;
  id: number;
}

const CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;
const LEGACY_CURSOR_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

function cursorTimestamp(value: unknown): AuditTimestamp {
  if (typeof value !== "string" || (!CURSOR_TIMESTAMP.test(value) && !LEGACY_CURSOR_TIMESTAMP.test(value))) {
    throw new Error("invalid cursor timestamp");
  }

  if (Number.isNaN(new Date(value).getTime())) {
    throw new Error("invalid cursor timestamp");
  }

  return value;
}

function encode(cursor: AuditCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString("base64url");
}

export function decodeAuditCursor(value: string | undefined): AuditCursor | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as EncodedAuditCursor;
    if (!Number.isInteger(parsed.id)) throw new Error("invalid cursor id");

    return { createdAt: cursorTimestamp(parsed.createdAt), id: parsed.id };
  } catch {
    throw new DomainError("INVALID_CURSOR", "Cursor de paginação inválido.", 400);
  }
}

function publicRecord({ cursorTimestamp: _cursorTimestamp, ...record }: AuditLog & { cursorTimestamp: string }): AuditLog {
  return record;
}

/** Provides cursor-based audit history exclusively to superusers. */
export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async list(actor: AuthIdentity, cursor: AuditCursor | null, limit: number) {
    if (actor.role !== "superuser") {
      throw new DomainError("FORBIDDEN", "Somente superusuário pode consultar a auditoria.", 403);
    }

    const records = await this.repository.list(cursor, limit);
    const last = records.at(-1);

    return {
      records: records.map(publicRecord),
      nextCursor: last ? encode({ createdAt: last.cursorTimestamp, id: last.id }) : null,
    };
  }
}
