import { DomainError } from "../../shared/core.js";

interface AttemptState { count: number; expiresAt: number; }
const WINDOW_MS = 15 * 60_000;
const MAX_FAILURES_PER_IP = 5;

/** Keeps short-lived login-failure state without permanently locking an account. */
export class LoginAttemptLimiter {
  private readonly failuresByIp = new Map<string, AttemptState>();
  private readonly failuresByIdentifier = new Map<string, AttemptState>();
  constructor(private readonly now: () => number = Date.now, private readonly delay: (milliseconds: number) => Promise<void> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))) {}

  async check(ip: string, identifier: string): Promise<void> {
    const timestamp = this.now();
    const ipState = this.active(this.failuresByIp, ip, timestamp);
    if (ipState?.count && ipState.count >= MAX_FAILURES_PER_IP) throw new DomainError("LOGIN_FAILED_RATE_LIMITED", "Muitas tentativas. Aguarde alguns minutos.", 429);
    const identifierState = this.active(this.failuresByIdentifier, identifier, timestamp);
    if (identifierState?.count) await this.delay(Math.min(identifierState.count * 250, 2_000));
  }

  failure(ip: string, identifier: string): void { const timestamp = this.now(); this.increment(this.failuresByIp, ip, timestamp); this.increment(this.failuresByIdentifier, identifier, timestamp); }
  success(identifier: string): void { this.failuresByIdentifier.delete(identifier); }
  private active(states: Map<string, AttemptState>, key: string, timestamp: number): AttemptState | undefined { const state = states.get(key); if (state && state.expiresAt <= timestamp) { states.delete(key); return undefined; } return state; }
  private increment(states: Map<string, AttemptState>, key: string, timestamp: number): void { const previous = this.active(states, key, timestamp); states.set(key, { count: (previous?.count ?? 0) + 1, expiresAt: timestamp + WINDOW_MS }); }
}
