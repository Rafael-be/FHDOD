import type { RequestHandler } from "express";
import type { RateLimitPolicy, SecurityRateLimiter } from "./rate-limiter.js";

export function rateLimitByIp(limiter: SecurityRateLimiter, scope: string, policy: RateLimitPolicy, code: string, message: string): RequestHandler {
  return async (request, response, next) => {
    try {
      const result = await limiter.consume(scope, request.ip || "unknown", policy);
      response.set("RateLimit-Remaining", String(result.remaining));
      if (result.allowed) return next();
      response.set("Retry-After", String(result.retryAfterSeconds));
      response.status(429).json({ error: { code, message } });
    } catch (error) { next(error); }
  };
}
