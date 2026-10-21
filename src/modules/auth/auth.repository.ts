import type postgres from "postgres";

export type Role = "superuser" | "sector_manager";
export interface AuthUser { id: number; email: string; passwordHash: string; role: Role; deletedAt: Date | null; mustChangePassword: boolean; temporaryPasswordExpiresAt: Date | null; }
export interface Session { id: string; userId: number; csrfToken: string; createdAt: Date; lastUsedAt: Date | null; expiresAt: Date; revokedAt: Date | null; }
export interface AuthenticatedSession extends Session { role: Role; deletedAt: Date | null; mustChangePassword: boolean; }
export interface RefreshToken { id: string; sessionId: string; tokenHash: string; expiresAt: Date; consumedAt: Date | null; }
export interface AuthRepository {
  transaction<T>(work: (repository: AuthRepository) => Promise<T>): Promise<T>;
  findUserByEmail(email: string): Promise<AuthUser | null>;
  findUserById(id: number): Promise<AuthUser | null>;
  findSession(id: string): Promise<Session | null>;
  findAuthenticatedSession(id: string): Promise<AuthenticatedSession | null>;
  findRefresh(hash: string): Promise<RefreshToken | null>;
  revokeUserSessions(userId: number, at: Date): Promise<void>;
  createSession(session: Session): Promise<void>;
  createRefresh(token: RefreshToken): Promise<void>;
  consumeRefresh(id: string, replacementId: string, at: Date): Promise<boolean>;
  revokeSession(id: string, at: Date): Promise<void>;
  touchSession(id: string, at: Date): Promise<void>;
  changePassword(userId: number, hash: string, at: Date): Promise<void>;
  changeEmail(userId: number, email: string, at: Date): Promise<void>;
}

/** PostgreSQL repository: all values are parameterized by postgres.js. */
export class PostgresAuthRepository implements AuthRepository {
  constructor(private readonly sql: postgres.Sql) {}
  async transaction<T>(work: (repository: AuthRepository) => Promise<T>): Promise<T> { return this.sql.begin(async (tx) => work(new PostgresAuthRepository(tx as unknown as postgres.Sql))) as Promise<T>; }
  async findUserByEmail(email: string): Promise<AuthUser | null> { const rows = await this.sql<AuthUser[]>`select u.id, u.email, u.password_hash as "passwordHash", r.code as role, u.deleted_at as "deletedAt", u.must_change_password as "mustChangePassword", u.temporary_password_expires_at as "temporaryPasswordExpiresAt" from users u join roles r on r.id=u.role_id where lower(btrim(u.email))=lower(btrim(${email})) limit 1`; return rows[0] ?? null; }
  async findUserById(id: number): Promise<AuthUser | null> { const rows = await this.sql<AuthUser[]>`select u.id, u.email, u.password_hash as "passwordHash", r.code as role, u.deleted_at as "deletedAt", u.must_change_password as "mustChangePassword", u.temporary_password_expires_at as "temporaryPasswordExpiresAt" from users u join roles r on r.id=u.role_id where u.id=${id} limit 1`; return rows[0] ?? null; }
  async findSession(id: string): Promise<Session | null> { const rows = await this.sql<Session[]>`select id, user_id as "userId", csrf_token as "csrfToken", created_at as "createdAt", last_used_at as "lastUsedAt", expires_at as "expiresAt", revoked_at as "revokedAt" from auth_sessions where id=${id}`; return rows[0] ?? null; }
  /** Reads the current account authorization context on every protected request. */
  async findAuthenticatedSession(id: string): Promise<AuthenticatedSession | null> { const rows = await this.sql<AuthenticatedSession[]>`select s.id,s.user_id as "userId",s.csrf_token as "csrfToken",s.created_at as "createdAt",s.last_used_at as "lastUsedAt",s.expires_at as "expiresAt",s.revoked_at as "revokedAt",r.code as role,u.deleted_at as "deletedAt",u.must_change_password as "mustChangePassword" from auth_sessions s join users u on u.id=s.user_id join roles r on r.id=u.role_id where s.id=${id}`; return rows[0] ?? null; }
  async findRefresh(hash: string): Promise<RefreshToken | null> { const rows = await this.sql<RefreshToken[]>`select id, session_id as "sessionId", token_hash as "tokenHash", expires_at as "expiresAt", consumed_at as "consumedAt" from auth_refresh_tokens where token_hash=${hash}`; return rows[0] ?? null; }
  async revokeUserSessions(userId: number, at: Date): Promise<void> { await this.sql`update auth_sessions set revoked_at=${at} where user_id=${userId} and revoked_at is null`; }
  async createSession(s: Session): Promise<void> { await this.sql`insert into auth_sessions (id,user_id,csrf_token,created_at,last_used_at,expires_at) values (${s.id},${s.userId},${s.csrfToken},${s.createdAt},${s.lastUsedAt},${s.expiresAt})`; }
  async createRefresh(t: RefreshToken): Promise<void> { await this.sql`insert into auth_refresh_tokens (id,session_id,token_hash,issued_at,expires_at) values (${t.id},${t.sessionId},${t.tokenHash},now(),${t.expiresAt})`; }
  async consumeRefresh(id: string, replacementId: string, at: Date): Promise<boolean> { const rows = await this.sql<{ id: string }[]>`update auth_refresh_tokens set consumed_at=${at}, replaced_by_token_id=${replacementId} where id=${id} and consumed_at is null returning id`; return rows.length === 1; }
  async revokeSession(id: string, at: Date): Promise<void> { await this.sql`update auth_sessions set revoked_at=coalesce(revoked_at, ${at}) where id=${id}`; }
  async touchSession(id: string, at: Date): Promise<void> { await this.sql`update auth_sessions set last_used_at=${at} where id=${id} and (last_used_at is null or last_used_at < ${new Date(at.getTime() - 300_000)})`; }
  async changePassword(userId: number, hash: string, at: Date): Promise<void> { await this.sql`update users set password_hash=${hash},must_change_password=false,temporary_password_expires_at=null,updated_at=${at} where id=${userId}`; await this.revokeUserSessions(userId, at); }
  async changeEmail(userId: number, email: string, at: Date): Promise<void> { await this.sql`update users set email=${email},updated_at=${at} where id=${userId}`; await this.revokeUserSessions(userId, at); }
}
