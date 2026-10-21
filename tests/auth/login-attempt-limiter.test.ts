import { LoginAttemptLimiter } from "../../src/modules/auth/login-attempt-limiter.js";

describe("LoginAttemptLimiter", () => {
  it("limits five failed attempts per IP across different identifiers", async () => {
    const limiter = new LoginAttemptLimiter(() => 1_000, async () => undefined);
    for (let index = 0; index < 5; index += 1) limiter.failure("203.0.113.10", `user-${index}@hospital.test`);
    await expect(limiter.check("203.0.113.10", "other@hospital.test")).rejects.toMatchObject({ code: "LOGIN_FAILED_RATE_LIMITED", status: 429 });
  });

  it("adds a capped progressive delay only for repeated identifiers", async () => {
    const delays: number[] = []; const limiter = new LoginAttemptLimiter(() => 1_000, async (milliseconds) => { delays.push(milliseconds); });
    limiter.failure("203.0.113.10", "user@hospital.test"); await limiter.check("203.0.113.10", "user@hospital.test");
    limiter.failure("203.0.113.10", "user@hospital.test"); await limiter.check("203.0.113.10", "user@hospital.test");
    expect(delays).toEqual([250, 500]);
  });
});
