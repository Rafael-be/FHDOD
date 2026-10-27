import rateLimit from "express-rate-limit";

/** In-memory abuse control for the shared totem process; no patient identity is persisted. */
export const submissionPublicLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: { code: "SUBMISSION_RATE_LIMITED", message: "Muitas solicitações. Aguarde um momento." } },
});
