import argon2 from "argon2";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { AppConfig } from "../../config/env.js";
import type { Clock } from "../../shared/core.js";
import { DomainError, normalizeEmail } from "../../shared/core.js";
import { logAuthenticationFailure, type AuthenticationFailureReason } from "../../shared/logger.js";
import { measurePerformance } from "../../shared/performance.js";
import type { AuthRepository, AuthUser, Role, Session } from "./auth.repository.js";
import type { PublicAuthUser } from "./auth.schemas.js";

const HOUR = 3_600_000;
const REFERENCE_PASSWORD_HASH = "$argon2id$v=19$m=19456,p=1,t=2$XjLQ8tr1tw5H70kpf+O3WQ$Ukqa+/1eXvgWWRQyt1319/oLYw0jYVZleU4L5VtSzO0";
/** Server-only authorization context; csrfToken is never serialized into a response. */
export interface AuthIdentity { userId: number; sessionId: string; role: Role; mustChangePassword: boolean; csrfToken?: string; }
export interface AuthResult { accessToken: string; refreshToken: string; csrfToken: string; expiresAt: Date; user: PublicAuthUser; }
const hashToken = (value: string) => createHash("sha256").update(value).digest("hex");
const opaqueToken = () => randomBytes(48).toString("base64url");
/** Maps database users to the only account representation allowed in HTTP responses. */
export function toPublicAuthUser(user: AuthUser): PublicAuthUser {
  return { id: user.id, name: user.fullName, email: user.email, role: user.role, mustChangePassword: user.mustChangePassword };
}
function jwtFailureReason(error: unknown): AuthenticationFailureReason { const code = (error as { code?: unknown }).code; if (code === "ERR_JWT_EXPIRED") return "jwt_expired"; if (code === "ERR_JWT_CLAIM_VALIDATION_FAILED") return "jwt_claim_invalid"; return "jwt_invalid"; }

/** Applies the session, JWT, refresh and temporary-password invariants. */
export class AuthService {
  private readonly key: Uint8Array;
  constructor(private readonly repository: AuthRepository, private readonly clock: Clock, private readonly config: AppConfig) { this.key = new TextEncoder().encode(config.JWT_SECRET); }
  private async accessToken(user: AuthUser, sessionId: string): Promise<string> { return new SignJWT({ role: user.role, sid: sessionId, mcp: user.mustChangePassword }).setProtectedHeader({ alg: "HS256" }).setIssuer(this.config.JWT_ISSUER).setAudience(this.config.JWT_AUDIENCE).setSubject(String(user.id)).setIssuedAt().setExpirationTime("10m").sign(this.key); }
  private valid(session: Session, now: Date): boolean { return !session.revokedAt && session.expiresAt > now && (session.lastUsedAt ?? session.createdAt).getTime() + 12 * HOUR > now.getTime(); }
  async login(email: string, password: string): Promise<AuthResult> {
    const measured = (stage: string, work: () => Promise<unknown>) => measurePerformance(this.config.PERFORMANCE_MEASUREMENTS, "auth.login", stage, work);
    const user = await measured("user_lookup", () => this.repository.findUserByEmail(normalizeEmail(email))) as AuthUser | null;
    const passwordHash = user && !user.deletedAt
      ? user.passwordHash
      : REFERENCE_PASSWORD_HASH;
    const passwordMatches = await measured(
      "password_verify",
      () => argon2.verify(passwordHash, password),
    ) as boolean;
    const accepted = Boolean(user && !user.deletedAt && passwordMatches);
    const now = this.clock.now();
    const temporaryPasswordExpired = user?.mustChangePassword && (
      !user.temporaryPasswordExpiresAt || user.temporaryPasswordExpiresAt <= now
    );

    if (!accepted || !user || temporaryPasswordExpired) {
      throw new DomainError("INVALID_CREDENTIALS", "E-mail ou senha inválidos.", 401);
    }

    const sessionId = randomUUID();
    const refreshToken = opaqueToken();
    const csrfToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(now.getTime() + 24 * HOUR);
    let authenticatedUser = user;
    await measured("session_transaction", () => this.repository.transaction(async repository => {
      const lockedUser = await repository.lockUser(user.id);
      const lockedTemporaryPasswordExpired = lockedUser?.mustChangePassword && (
        !lockedUser.temporaryPasswordExpiresAt || lockedUser.temporaryPasswordExpiresAt <= now
      );

      if (!lockedUser || lockedUser.deletedAt || lockedUser.passwordHash !== user.passwordHash || lockedTemporaryPasswordExpired) {
        throw new DomainError("INVALID_CREDENTIALS", "E-mail ou senha inválidos.", 401);
      }

      authenticatedUser = lockedUser;
      await repository.revokeUserSessions(lockedUser.id, now);
      await repository.createSession({ id: sessionId, userId: lockedUser.id, csrfToken, createdAt: now, lastUsedAt: now, expiresAt, revokedAt: null });
      await repository.createRefresh({ id: randomUUID(), sessionId, tokenHash: hashToken(refreshToken), expiresAt, consumedAt: null });
    }));
    return { accessToken: await measured("jwt_generation", () => this.accessToken(authenticatedUser, sessionId)) as string, refreshToken, csrfToken, expiresAt, user: toPublicAuthUser(authenticatedUser) };
  }
  private rejectAuthentication(reason: AuthenticationFailureReason): never { logAuthenticationFailure(reason); throw new DomainError("UNAUTHENTICATED", "Sessão inválida ou expirada.", 401); }
  async authenticate(token: string, options: { touchSession?: boolean } = {}): Promise<AuthIdentity> {
    let payload: { sub?: unknown; sid?: unknown }; let algorithm: string | undefined;
    try {
      const verified = await measurePerformance(this.config.PERFORMANCE_MEASUREMENTS, "auth.authenticate", "jwt_verify", () => jwtVerify(token, this.key, { algorithms: ["HS256"], issuer: this.config.JWT_ISSUER, audience: this.config.JWT_AUDIENCE, requiredClaims: ["sub", "sid", "iat", "exp"] }));
      payload = verified.payload; algorithm = verified.protectedHeader.alg;
    } catch (error) { logAuthenticationFailure(jwtFailureReason(error), error); throw new DomainError("UNAUTHENTICATED", "Sessão inválida ou expirada.", 401); }
    if (algorithm !== "HS256") return this.rejectAuthentication("jwt_invalid");
    if (typeof payload.sub !== "string") return this.rejectAuthentication("jwt_subject_invalid");
    if (typeof payload.sid !== "string") return this.rejectAuthentication("session_id_invalid");
    const sessionId = payload.sid;
    let session;
    try { session = await measurePerformance(this.config.PERFORMANCE_MEASUREMENTS, "auth.authenticate", "session_lookup", () => this.repository.findAuthenticatedSession(sessionId)); } catch (error) { logAuthenticationFailure("database_query_failed", error); throw error; }
    if (!session) return this.rejectAuthentication("session_not_found");
    const userId = Number(payload.sub);
    if (!Number.isSafeInteger(userId) || session.userId !== userId) return this.rejectAuthentication("session_subject_mismatch");
    if (session.deletedAt) return this.rejectAuthentication("user_inactive");
    const now = this.clock.now();
    if (session.revokedAt) return this.rejectAuthentication("session_revoked");
    if (session.expiresAt <= now) return this.rejectAuthentication("session_expired");
    if ((session.lastUsedAt ?? session.createdAt).getTime() + 12 * HOUR <= now.getTime()) return this.rejectAuthentication("session_idle_expired");
    if (options.touchSession !== false) {
      try { await measurePerformance(this.config.PERFORMANCE_MEASUREMENTS, "auth.authenticate", "session_touch", () => this.repository.touchSession(session.id, now)); } catch (error) { logAuthenticationFailure("database_query_failed", error); throw error; }
    }
    return { userId: session.userId, sessionId: session.id, role: session.role, mustChangePassword: session.mustChangePassword, csrfToken: session.csrfToken };
  }
  async refresh(value: string): Promise<AuthResult> { const now = this.clock.now(); const current = await this.repository.findRefresh(hashToken(value)); if (!current || current.expiresAt <= now) throw new DomainError("INVALID_REFRESH_TOKEN", "Sessão inválida ou expirada.", 401); if (current.consumedAt) { const session=await this.repository.findSession(current.sessionId); if (now.getTime()-current.consumedAt.getTime()<=5_000) throw new DomainError("REFRESH_CONFLICT","A renovação já foi processada; tente novamente.",409); if(session) await this.repository.revokeSession(session.id,now); throw new DomainError("REFRESH_TOKEN_REUSED","Sessão inválida ou expirada.",401); } const session = await this.repository.findSession(current.sessionId); if (!session || !this.valid(session, now)) throw new DomainError("INVALID_REFRESH_TOKEN", "Sessão inválida ou expirada.", 401); const user = await this.repository.findUserById(session.userId); if (!user || user.deletedAt) throw new DomainError("INVALID_REFRESH_TOKEN", "Sessão inválida ou expirada.", 401); const replacementId = randomUUID(), refreshToken = opaqueToken(); await this.repository.transaction(async repository => { if (!(await repository.consumeRefresh(current.id, now))) throw new DomainError("REFRESH_CONFLICT", "A renovação já foi processada; tente novamente.", 409); await repository.createRefresh({ id: replacementId, sessionId: session.id, tokenHash: hashToken(refreshToken), expiresAt: session.expiresAt, consumedAt: null }); await repository.linkRefreshReplacement(current.id, replacementId); }); return { accessToken: await this.accessToken(user, session.id), refreshToken, csrfToken: session.csrfToken, expiresAt: session.expiresAt, user: toPublicAuthUser(user) }; }
  /** Returns current public data after the caller has validated the persisted session. */
  async currentUser(identity: AuthIdentity): Promise<PublicAuthUser> {
    const user = await this.repository.findUserById(identity.userId);
    if (!user || user.deletedAt) this.rejectAuthentication("user_inactive");
    return toPublicAuthUser(user);
  }
  async logout(sessionId: string): Promise<void> { await measurePerformance(this.config.PERFORMANCE_MEASUREMENTS, "auth.logout", "session_revocation", () => this.repository.revokeSession(sessionId, this.clock.now())); }
  /** Reuses the synchronizer token loaded from the already validated server-side session. */
  async recoverCsrfForIdentity(identity: AuthIdentity): Promise<string> {
    return measurePerformance(this.config.PERFORMANCE_MEASUREMENTS, "auth.csrf", "session_context", async () => {
      if (!identity.csrfToken) throw new DomainError("UNAUTHENTICATED", "Sessão inválida ou expirada.", 401);
      return identity.csrfToken;
    });
  }
  /** Replaces a valid temporary password and revokes every existing session. */
  async changeTemporaryPassword(identity: AuthIdentity, currentPassword: string, nextPassword: string): Promise<void> { const user=await this.repository.findUserById(identity.userId); const now=this.clock.now(); if(!user || !user.mustChangePassword || !user.temporaryPasswordExpiresAt || user.temporaryPasswordExpiresAt<=now || !await argon2.verify(user.passwordHash,currentPassword)) throw new DomainError("TEMPORARY_PASSWORD_INVALID","Senha temporária inválida ou expirada.",403); const hash=await argon2.hash(nextPassword,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1,hashLength:32}); await this.repository.transaction(repository=>repository.changePassword(user.id,hash,now)); }
  /** Changes an established password after reauthentication and revokes all sessions. */
  async changeOwnPassword(identity: AuthIdentity, currentPassword: string, nextPassword: string): Promise<void> { const user=await this.repository.findUserById(identity.userId); if(!user || user.deletedAt || user.mustChangePassword || !await argon2.verify(user.passwordHash,currentPassword)) throw new DomainError("INVALID_CURRENT_PASSWORD","Senha atual inválida.",403); const now=this.clock.now(); const hash=await argon2.hash(nextPassword,{type:argon2.argon2id,memoryCost:19456,timeCost:2,parallelism:1,hashLength:32}); await this.repository.transaction(repository=>repository.changePassword(user.id,hash,now)); }
  /** Changes the authenticated user's e-mail after password reauthentication. */
  async changeOwnEmail(identity: AuthIdentity, currentPassword: string, email: string): Promise<void> { const user=await this.repository.findUserById(identity.userId); if(!user || user.deletedAt || user.mustChangePassword || !await argon2.verify(user.passwordHash,currentPassword)) throw new DomainError("INVALID_CURRENT_PASSWORD","Senha atual inválida.",403); const normalized=normalizeEmail(email); if(normalized===normalizeEmail(user.email)) return; const now=this.clock.now(); try { await this.repository.transaction(repository=>repository.changeEmail(user.id,normalized,now)); } catch(error) { if((error as {code?:string}).code==="23505") throw new DomainError("EMAIL_ALREADY_EXISTS","Este e-mail já está em uso.",409); throw error; } }
  async recoverCsrf(refresh: string): Promise<string> { const token = await this.repository.findRefresh(hashToken(refresh)); if (!token || token.consumedAt) throw new DomainError("UNAUTHENTICATED", "Sessão inválida ou expirada.", 401); const session = await this.repository.findSession(token.sessionId); if (!session || !this.valid(session, this.clock.now())) throw new DomainError("UNAUTHENTICATED", "Sessão inválida ou expirada.", 401); return session.csrfToken; }
}
