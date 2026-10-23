import type postgres from "postgres";

export type Role = "superuser" | "sector_manager";
export interface AuthUser { id: number; email: string; passwordHash: string; role: Role; deletedAt: Date | null; mustChangePassword: boolean; temporaryPasswordExpiresAt: Date | null; }
export interface Session { id: string; userId: number; csrfToken: string; createdAt: Date; lastUsedAt: Date | null; expiresAt: Date; revokedAt: Date | null; }
export interface AuthenticatedSession extends Session { role: Role; deletedAt: Date | null; mustChangePassword: boolean; }
export interface RefreshToken { id: string; sessionId: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null; }
interface RawAuthUser { id: number; email: string; passwordHash: string; role: Role; deletedAt: unknown; mustChangePassword: boolean; temporaryPasswordExpiresAt: unknown; }
interface RawSession { id: string; userId: number; csrfToken: string; createdAt: unknown; lastUsedAt: unknown; expiresAt: unknown; revokedAt: unknown; }
interface RawAuthenticatedSession extends RawSession { role: Role; deletedAt: unknown; mustChangePassword: boolean; }
interface RawRefreshToken { id: string; sessionId: string; tokenHash: string; expiresAt: unknown; consumedAt: unknown; }

/** Converts postgres.js timestamp values to the Date-only domain contract. */
function timestamp(value: unknown, column: string): Date {
  const result = value instanceof Date ? new Date(value.getTime()) : typeof value === "string" ? new Date(value) : null;
  if (!result || Number.isNaN(result.getTime())) throw new Error(`Timestamp PostgreSQL inválido em ${column}.`);
  return result;
}
function nullableTimestamp(value: unknown, column: string): Date | null { return value === null ? null : timestamp(value, column); }
function authUser(row: RawAuthUser): AuthUser { return { id: row.id, email: row.email, passwordHash: row.passwordHash, role: row.role, deletedAt: nullableTimestamp(row.deletedAt, "users.deleted_at"), mustChangePassword: row.mustChangePassword, temporaryPasswordExpiresAt: nullableTimestamp(row.temporaryPasswordExpiresAt, "users.temporary_password_expires_at") }; }
function session(row: RawSession): Session { return { id: row.id, userId: row.userId, csrfToken: row.csrfToken, createdAt: timestamp(row.createdAt, "auth_sessions.created_at"), lastUsedAt: nullableTimestamp(row.lastUsedAt, "auth_sessions.last_used_at"), expiresAt: timestamp(row.expiresAt, "auth_sessions.expires_at"), revokedAt: nullableTimestamp(row.revokedAt, "auth_sessions.revoked_at") }; }
function authenticatedSession(row: RawAuthenticatedSession): AuthenticatedSession { return { ...session(row), role: row.role, deletedAt: nullableTimestamp(row.deletedAt, "users.deleted_at"), mustChangePassword: row.mustChangePassword }; }
function refreshToken(row: RawRefreshToken): RefreshToken { return { id: row.id, sessionId: row.sessionId, tokenHash: row.tokenHash, expiresAt: timestamp(row.expiresAt, "auth_refresh_tokens.expires_at"), consumedAt: nullableTimestamp(row.consumedAt, "auth_refresh_tokens.consumed_at") }; }
export interface AuthRepository {
  transaction<T>(work: (repository: AuthRepository) => Promise<T>): Promise<T>;
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(id: number): Promise<AuthUser | null>;
  lockUser(id: number): Promise<AuthUser | null>;
  findSession(id: string): Promise<Session | null>;
  findAuthenticatedSession(id: string): Promise<AuthenticatedSession | null>;
  findRefresh(hash: string): Promise<RefreshToken | null>;
  revokeUserSessions(userId: number, at: Date): Promise<void>;
  createSession(session: Session): Promise<void>;
  createRefresh(token: RefreshToken): Promise<void>;
  consumeRefresh(id: string, at: Date): Promise<boolean>;
  linkRefreshReplacement(id: string, replacementId: string): Promise<void>;
  revokeSession(id: string, at: Date): Promise<void>;
  touchSession(id: string, at: Date): Promise<void>;
  changePassword(userId: number, hash: string, at: Date): Promise<void>;
  changeEmail(userId: number, email: string, at: Date): Promise<void>;
}

/** PostgreSQL repository: all values are parameterized by postgres.js. */
export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly sql: postgres.Sql) {}
  async transaction<T>(work: (repository: AuthRepository) => Promise<T>): Promise<T> { return this.sql.begin(async (tx) => work(new PostgresAuthRepository(tx as unknown as postgres.Sql))) as Promise<T>; }
  async findUserByEmail(email: string): Promise<AuthUser | null> { const rows = await this.sql<RawAuthUser[]>`select u.id, u.email, u.password_hash as "passwordHash", r.code as role, u.deleted_at as "deletedAt", u.must_change_password as "mustChangePassword", u.temporary_password_expires_at as "temporaryPasswordExpiresAt" from users u join roles r on r.id=u.role_id where lower(btrim(u.email))=lower(btrim(${email})) limit 1`; return rows[0] ? authUser(rows[0]) : null; }
  async findUserById(id: number): Promise<AuthUser | null> { const rows = await this.sql<RawAuthUser[]>`select u.id, u.email, u.password_hash as "passwordHash", r.code as role, u.deleted_at as "deletedAt", u.must_change_password as "mustChangePassword", u.temporary_password_expires_at as "temporaryPasswordExpiresAt" from users u join roles r on r.id=u.role_id where u.id=${id} limit 1`; return rows[0] ? authUser(rows[0]) : null; }
  /** Serializes session replacement for one account inside the caller's transaction. */
  async lockUser(id: number): Promise<AuthUser | null> { const rows = await this.sql<RawAuthUser[]>`select u.id, u.email, u.password_hash as "passwordHash", r.code as role, u.deleted_at as "deletedAt", u.must_change_password as "mustChangePassword", u.temporary_password_expires_at as "temporaryPasswordExpiresAt" from users u join roles r on r.id=u.role_id where u.id=${id} for update of u`; return rows[0] ? authUser(rows[0]) : null; }
  async findSession(id: string): Promise<Session | null> { const rows = await this.sql<RawSession[]>`select id, user_id as "userId", csrf_token as "csrfToken", created_at as "createdAt", last_used_at as "lastUsedAt", expires_at as "expiresAt", revoked_at as "revokedAt" from auth_sessions where id=${id}`; return rows[0] ? session(rows[0]) : null; }
  /** Reads the current account authorization context on every protected request. */
  async findAuthenticatedSession(id: string): Promise<AuthenticatedSession | null> { const rows = await this.sql<RawAuthenticatedSession[]>`select s.id,s.user_id as "userId",s.csrf_token as "csrfToken",s.created_at as "createdAt",s.last_used_at as "lastUsedAt",s.expires_at as "expiresAt",s.revoked_at as "revokedAt",r.code as role,u.deleted_at as "deletedAt",u.must_change_password as "mustChangePassword" from auth_sessions s join users u on u.id=s.user_id join roles r on r.id=u.role_id where s.id=${id}`; return rows[0] ? authenticatedSession(rows[0]) : null; }
  async findRefresh(hash: string): Promise<RefreshToken | null> { const rows = await this.sql<RawRefreshToken[]>`select id, session_id as "sessionId", token_hash as "tokenHash", expires_at as "expiresAt", consumed_at as "consumedAt" from auth_refresh_tokens where token_hash=${hash}`; return rows[0] ? refreshToken(rows[0]) : null; }
  async revokeUserSessions(userId: number, at: Date): Promise<void> { await this.sql`update auth_sessions set revoked_at=${at.toISOString()} where user_id=${userId} and revoked_at is null`; }
  async createSession(s: Session): Promise<void> { await this.sql`insert into auth_sessions (id,user_id,csrf_token,created_at,last_used_at,expires_at) values (${s.id},${s.userId},${s.csrfToken},${s.createdAt.toISOString()},${s.lastUsedAt?.toISOString() ?? null},${s.expiresAt.toISOString()})`; }
  async createRefresh(t: RefreshToken): Promise<void> { await this.sql`insert into auth_refresh_tokens (id,session_id,token_hash,issued_at,expires_at) values (${t.id},${t.sessionId},${t.tokenHash},now(),${t.expiresAt.toISOString()})`; }
  async consumeRefresh(id: string, at: Date): Promise<boolean> { const rows = await this.sql<{ id: string }[]>`update auth_refresh_tokens set consumed_at=${at.toISOString()} where id=${id} and consumed_at is null returning id`; return rows.length === 1; }
  async linkRefreshReplacement(id: string, replacementId: string): Promise<void> { await this.sql`update auth_refresh_tokens set replaced_by_token_id=${replacementId} where id=${id}`; }
  async revokeSession(id: string, at: Date): Promise<void> { await this.sql`update auth_sessions set revoked_at=coalesce(revoked_at, ${at.toISOString()}) where id=${id}`; }
  async touchSession(id: string, at: Date): Promise<void> { await this.sql`update auth_sessions set last_used_at=${at.toISOString()} where id=${id} and (last_used_at is null or last_used_at < ${new Date(at.getTime() - 300_000).toISOString()})`; }
  async changePassword(userId: number, hash: string, at: Date): Promise<void> { await this.sql`update users set password_hash=${hash},must_change_password=false,temporary_password_expires_at=null,updated_at=${at.toISOString()} where id=${userId}`; await this.revokeUserSessions(userId, at); }
  async changeEmail(userId: number, email: string, at: Date): Promise<void> { await this.sql`update users set email=${email},updated_at=${at.toISOString()} where id=${userId}`; await this.revokeUserSessions(userId, at); }
}
