import type { Request } from "express";

const SENSITIVE_VALUE = /((?:password|pass|token|secret|hash|cookie|authorization|email)[\s=:]+)([^\s,;}]*)/gi;

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
