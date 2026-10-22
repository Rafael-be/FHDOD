import { LOGIN_FAILURE_WINDOW_MS, LoginAttemptLimiter } from "../../src/modules/auth/login-attempt-limiter.js";

const noDelay = async (): Promise<void> => undefined;
const noLog = (): void => undefined;

describe("LoginAttemptLimiter", () => {
  it("blocks the sixth request after five effective credential failures and does not allow an e-mail change to evade the IP limit", async () => {
    const limiter = new LoginAttemptLimiter(() => 1_000, noDelay, noLog);
    for (let index = 0; index < 5; index += 1) {
      await expect(limiter.check("203.0.113.10", `before-${index}@hospital.test`)).resolves.toBeUndefined();
      limiter.failure("203.0.113.10", `before-${index}@hospital.test`);
    }

    await expect(limiter.check("203.0.113.10", "different-email@hospital.test")).rejects.toMatchObject({ code: "LOGIN_FAILED_RATE_LIMITED", status: 429 });
  });

  it("adds a capped progressive delay only for repeated identifiers", async () => {
    const delays: number[] = [];
    const limiter = new LoginAttemptLimiter(() => 1_000, async (milliseconds) => { delays.push(milliseconds); }, noLog);
    limiter.failure("203.0.113.10", "user@hospital.test");
    await limiter.check("203.0.113.10", "user@hospital.test");
    limiter.failure("203.0.113.10", "user@hospital.test");
    await limiter.check("203.0.113.10", "user@hospital.test");
    expect(delays).toEqual([250, 500]);
  });

  it("clears the identifier delay after success without clearing the IP failure count", async () => {
    const delays: number[] = [];
    const limiter = new LoginAttemptLimiter(() => 1_000, async (milliseconds) => { delays.push(milliseconds); }, noLog);
    limiter.failure("203.0.113.10", "successful@hospital.test");
    limiter.success("successful@hospital.test");
    await limiter.check("203.0.113.10", "successful@hospital.test");
    expect(delays).toEqual([]);

    for (let index = 0; index < 4; index += 1) limiter.failure("203.0.113.10", `other-${index}@hospital.test`);
    await expect(limiter.check("203.0.113.10", "successful@hospital.test")).rejects.toMatchObject({ code: "LOGIN_FAILED_RATE_LIMITED", status: 429 });
  });

  it("expires the sliding window and starts a new count", async () => {
    let now = 1_000;
    const events: string[] = [];
    const limiter = new LoginAttemptLimiter(() => now, noDelay, (event) => { events.push(event); });
    for (let index = 0; index < 5; index += 1) limiter.failure("203.0.113.10", `user-${index}@hospital.test`);
    await expect(limiter.check("203.0.113.10", "blocked@hospital.test")).rejects.toMatchObject({ code: "LOGIN_FAILED_RATE_LIMITED" });

    now += LOGIN_FAILURE_WINDOW_MS;
    await expect(limiter.check("203.0.113.10", "new-window@hospital.test")).resolves.toBeUndefined();
    limiter.failure("203.0.113.10", "new-window@hospital.test");
    await expect(limiter.check("203.0.113.10", "new-window@hospital.test")).resolves.toBeUndefined();
    expect(events).toEqual(expect.arrayContaining(["auth.login_failure_window_expired"]));
  });

  it("keeps failure counts independent between IPs", async () => {
    const limiter = new LoginAttemptLimiter(() => 1_000, noDelay, noLog);
    for (let index = 0; index < 5; index += 1) limiter.failure("203.0.113.10", `user-${index}@hospital.test`);
    await expect(limiter.check("203.0.113.11", "other-client@hospital.test")).resolves.toBeUndefined();
  });

  it("emits only aggregate, non-sensitive rate-limit metadata", () => {
    const entries: unknown[] = [];
    const limiter = new LoginAttemptLimiter(() => 1_000, noDelay, (event, details) => { entries.push({ event, details }); });
    limiter.failure("203.0.113.10", "person@hospital.test");
    const output = JSON.stringify(entries);
    expect(output).toContain("auth.login_failure_counted");
    expect(output).not.toContain("203.0.113.10");
    expect(output).not.toContain("person@hospital.test");
  });
});
