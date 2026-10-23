import { DomainError } from "../../shared/core.js";
import { logLoginRateLimit } from "../../shared/logger.js";

interface AttemptState { count: number; expiresAt: number; }
export const LOGIN_FAILURE_WINDOW_MS = 15 * 60_000;
export const MAX_LOGIN_FAILURES_PER_IP = 5;
export const MAX_LOGIN_ATTEMPT_ENTRIES = 10_000;
type AttemptScope = "ip" | "identifier";
type RateLimitLogger = typeof logLoginRateLimit;

/** Keeps short-lived login-failure state without permanently locking an account. */
export class LoginAttemptLimiter {
  private readonly failuresByIp = new Map<string, AttemptState>();
  private readonly failuresByIdentifier = new Map<string, AttemptState>();
  private nextCleanupAt = 0;
  constructor(
    private readonly now: () => number = Date.now,
    private readonly delay: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    private readonly log: RateLimitLogger = logLoginRateLimit,
    private readonly maxEntries = MAX_LOGIN_ATTEMPT_ENTRIES,
  ) {}

  async check(ip: string, identifier: string): Promise<void> {
    const timestamp = this.now();
    this.cleanupExpired(timestamp);
    this.requireCapacity(this.failuresByIp, ip, timestamp);
    this.requireCapacity(this.failuresByIdentifier, identifier, timestamp);
    const ipState = this.active(this.failuresByIp, ip, timestamp, "ip");
    if (ipState?.count && ipState.count >= MAX_LOGIN_FAILURES_PER_IP) {
      this.log("auth.login_failure_blocked", { count: ipState.count, limit: MAX_LOGIN_FAILURES_PER_IP, windowMs: LOGIN_FAILURE_WINDOW_MS, status: 429, scope: "ip" });
      throw new DomainError("LOGIN_FAILED_RATE_LIMITED", "Muitas tentativas. Aguarde alguns minutos.", 429);
    }
    const identifierState = this.active(this.failuresByIdentifier, identifier, timestamp, "identifier");
    if (identifierState?.count) await this.delay(Math.min(identifierState.count * 250, 2_000));
  }

  failure(ip: string, identifier: string): void {
    const timestamp = this.now();
    this.cleanupExpired(timestamp);
    this.requireCapacity(this.failuresByIp, ip, timestamp);
    this.requireCapacity(this.failuresByIdentifier, identifier, timestamp);
    const count = this.increment(this.failuresByIp, ip, timestamp, "ip");
    this.increment(this.failuresByIdentifier, identifier, timestamp, "identifier");
    this.log("auth.login_failure_counted", { count, limit: MAX_LOGIN_FAILURES_PER_IP, windowMs: LOGIN_FAILURE_WINDOW_MS, status: 401, scope: "ip" });
    if (count === MAX_LOGIN_FAILURES_PER_IP) this.log("auth.login_failure_limit_reached", { count, limit: MAX_LOGIN_FAILURES_PER_IP, windowMs: LOGIN_FAILURE_WINDOW_MS, status: 401, scope: "ip" });
  }
  success(identifier: string): void { this.failuresByIdentifier.delete(identifier); }
  private requireCapacity(states: Map<string, AttemptState>, key: string, timestamp: number): void {
    if (states.has(key)) return;

    this.removeExpired(states, timestamp);
    if (states.size < this.maxEntries) return;

    throw new DomainError("LOGIN_FAILED_RATE_LIMITED", "Muitas tentativas. Aguarde alguns minutos.", 429);
  }

  private removeExpired(states: Map<string, AttemptState>, timestamp: number): void {
    for (const [key, state] of states) {
      if (state.expiresAt <= timestamp) states.delete(key);
    }
  }
  /** Bounds local state even when expired keys are never seen again. */
  private cleanupExpired(timestamp: number): void {
    if (timestamp < this.nextCleanupAt) return;

    for (const [states, scope] of [
      [this.failuresByIp, "ip"],
      [this.failuresByIdentifier, "identifier"],
    ] as const) {
      for (const [key, state] of states) {
        if (state.expiresAt <= timestamp) {
          states.delete(key);
          this.log("auth.login_failure_window_expired", {
            count: state.count,
            limit: MAX_LOGIN_FAILURES_PER_IP,
            scope,
            windowMs: LOGIN_FAILURE_WINDOW_MS,
          });
        }
      }
    }

    this.nextCleanupAt = timestamp + LOGIN_FAILURE_WINDOW_MS;
  }
  private active(states: Map<string, AttemptState>, key: string, timestamp: number, scope: AttemptScope): AttemptState | undefined {
    const state = states.get(key);
    if (state && state.expiresAt <= timestamp) {
      states.delete(key);
      this.log("auth.login_failure_window_expired", { count: state.count, limit: MAX_LOGIN_FAILURES_PER_IP, windowMs: LOGIN_FAILURE_WINDOW_MS, scope });
      return undefined;
    }
    return state;
  }
  private increment(states: Map<string, AttemptState>, key: string, timestamp: number, scope: AttemptScope): number {
    const previous = this.active(states, key, timestamp, scope);
    const count = (previous?.count ?? 0) + 1;
    states.set(key, { count, expiresAt: timestamp + LOGIN_FAILURE_WINDOW_MS });
    return count;
  }
}
