import type { NextFunction, Request, Response } from "express";

const SENSITIVE_VALUE = /((?:password|pass|token|secret|hash|cookie|authorization|email)[\s=:]+)([^\s,;}]*)/gi;
export type AuthenticationFailureReason = "jwt_invalid" | "jwt_expired" | "jwt_claim_invalid" | "jwt_subject_invalid" | "session_id_invalid" | "session_not_found" | "session_subject_mismatch" | "session_revoked" | "session_expired" | "session_idle_expired" | "user_inactive" | "csrf_invalid" | "database_query_failed";

function safeMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(SENSITIVE_VALUE, "$1[REDACTED]").slice(0, 500);
}

function safeStack(error: unknown): string | undefined {
  if (!(error instanceof Error) || !error.stack) return undefined;
  return error.stack.replace(SENSITIVE_VALUE, "$1[REDACTED]").slice(0, 2_000);
}

export function logInternalError(error: unknown, request: Pick<Request, "method" | "path">): void {
  const candidate = error as { code?: unknown; name?: unknown };
  const details = {
    name: typeof candidate.name === "string" ? candidate.name : "Error",
    code: typeof candidate.code === "string" && /^[A-Z0-9_]+$/.test(candidate.code) ? candidate.code : undefined,
    message: safeMessage(error),
    stack: safeStack(error),
  };
  process.stderr.write(`${JSON.stringify({
    level: "error",
    event: "http.request_failed",
    operation: `${request.method} ${request.path}`,
    error: details,
  })}\n`);
}

/** Records an HTTP request without serializing headers, cookies, query strings or body data. */
export function httpRequestLogger(request: Request, response: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();
  response.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
    process.stdout.write(`${JSON.stringify({ level: "info", event: "http.request_completed", operation: `${request.method} ${request.path}`, status: response.statusCode, durationMs: Number(durationMs.toFixed(2)) })}\n`);
  });
  next();
}

/** Records controlled client rejections once, using the public error code but never its input values. */
export function logRequestRejection(code: string, status: number, request: Pick<Request, "method" | "path">): void {
  process.stderr.write(`${JSON.stringify({ level: "warn", event: "http.request_rejected", operation: `${request.method} ${request.path}`, code, status })}\n`);
}

/** Records schema failures by field and rule only; never serializes parsed input or invalid values. */
export function logValidationFailure(request: Pick<Request, "method" | "path">, fields: string[], issues: string[]): void {
  process.stderr.write(`${JSON.stringify({ level: "warn", event: "http.validation_failed", operation: `${request.method} ${request.path}`, fields, issues })}\n`);
}

export function logServerStarted(port: number): void { process.stdout.write(`${JSON.stringify({ level: "info", event: "server.started", port })}\n`); }

/** Logs authentication diagnostics without recording credentials or session identifiers. */
export function logAuthenticationFailure(reason: AuthenticationFailureReason, error?: unknown): void {
  const candidate = error as { code?: unknown; name?: unknown } | undefined;
  const details = error ? {
    name: typeof candidate?.name === "string" ? candidate.name : "Error",
    code: typeof candidate?.code === "string" && /^[A-Z0-9_]+$/.test(candidate.code) ? candidate.code : undefined,
  } : undefined;
  process.stderr.write(`${JSON.stringify({
    level: "warn",
    event: "auth.authentication_rejected",
    operation: "auth.authenticate",
    reason,
    error: details,
  })}\n`);
}
