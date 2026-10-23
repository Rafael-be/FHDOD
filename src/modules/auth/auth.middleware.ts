import type { NextFunction, Request, Response } from "express";
import type { AuthService, AuthIdentity } from "./auth.service.js";
import { DomainError } from "../../shared/core.js";
/* eslint-disable @typescript-eslint/no-namespace -- Express request augmentation requires this declaration shape. */
declare global { namespace Express { interface Request { identity?: AuthIdentity; } } }
function accessTokenCandidates(request: Request): string[] {
  const raw = request.headers.cookie;
  if (!raw) return request.cookies.access_token ? [request.cookies.access_token] : [];
  const values = raw.split(";").flatMap((part) => {
    const separator = part.indexOf("=");
    if (separator < 0 || part.slice(0, separator).trim() !== "access_token") return [];
    const value = part.slice(separator + 1).trim();
    return value ? [value] : [];
  });
  return [...new Set(values.reverse())];
}

export function authenticate(service: AuthService) {
  return async (
    request: Request,
    _response: Response,
    next: NextFunction
  ): Promise<void> => {
    const tokens = accessTokenCandidates(request);

    for (const token of tokens) {
      try {
        request.identity = await service.authenticate(token);
        return next();
      } catch (error) {
        if (error instanceof DomainError && error.code === "UNAUTHENTICATED") {
          continue;
        }

        return next(error);
      }
    }

    next();
  };
}

export function requireRole(...roles: AuthIdentity["role"][]) { return (request: Request, response: Response, next: NextFunction): void => { if (!request.identity) { response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Autenticação necessária." } }); return; } if (!roles.includes(request.identity.role)) { response.status(403).json({ error: { code: "FORBIDDEN", message: "Você não possui permissão para esta operação." } }); return; } if (request.identity.mustChangePassword) { response.status(403).json({ error: { code: "PASSWORD_CHANGE_REQUIRED", message: "Troque sua senha temporária para continuar." } }); return; } next(); }; }
/** Protects cookie-authenticated state changes with the session's synchronizer token. */
export function csrfProtection(service: AuthService) {
  return async (
    request: Request,
    response: Response,
    next: NextFunction
  ): Promise<void> => {
    try {
      if (!request.identity) {
        response.status(401).json({
          error: {
            code: "UNAUTHENTICATED",
            message: "Autenticação necessária.",
          },
        });
        return;
      }

      const expected = await service.recoverCsrfForIdentity(request.identity);

      if (request.get("x-csrf-token") !== expected) {
        response.status(403).json({
          error: {
            code: "CSRF_INVALID",
            message: "Token CSRF inválido.",
          },
        });
        return;
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}
