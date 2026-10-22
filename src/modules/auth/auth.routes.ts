import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { rateLimit } from "express-rate-limit";
import type { AppConfig } from "../../config/env.js";
import type { AuthService } from "./auth.service.js";
import { LoginAttemptLimiter } from "./login-attempt-limiter.js";
import { loginCredentialsSchema } from "./auth.schemas.js";
import { logAuthenticationFailure } from "../../shared/logger.js";
import { measurePerformance } from "../../shared/performance.js";
import { authenticate } from "./auth.middleware.js";

export { loginCredentialsSchema } from "./auth.schemas.js";
const csrfHeader = "x-csrf-token";
const baseCookieOptions = (config: AppConfig) => ({ httpOnly: true, secure: config.NODE_ENV === "production", sameSite: "lax" as const });
const accessCookieOptions = (config: AppConfig) => ({ ...baseCookieOptions(config), path: "/api" });
const refreshCookieOptions = (config: AppConfig) => ({ ...baseCookieOptions(config), path: "/api/auth" });
const legacyAccessCookieOptions = (config: AppConfig) => ({ ...baseCookieOptions(config), path: "/api/auth" });
function originAllowed(request: Request, config: AppConfig): boolean { return !request.headers.origin || request.headers.origin === config.ALLOWED_ORIGIN; }
export function authRoutes(service: AuthService, config: AppConfig): Router {
  const router = Router();
  const loginRequests = rateLimit({ windowMs: 15 * 60_000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false, message: { error: { code: "LOGIN_RATE_LIMITED", message: "Muitas tentativas. Aguarde alguns minutos." } } });
  const failedAttempts = new LoginAttemptLimiter();
  const clearSessionCookies = (response: Response) => response.clearCookie("access_token", accessCookieOptions(config)).clearCookie("access_token", legacyAccessCookieOptions(config)).clearCookie("refresh_token", refreshCookieOptions(config));
  const setTokens = (response: Response, result: Awaited<ReturnType<AuthService["login"]>>) => { response.cookie("access_token", result.accessToken, { ...accessCookieOptions(config), maxAge: 600_000 }); response.cookie("refresh_token", result.refreshToken, { ...refreshCookieOptions(config), maxAge: result.expiresAt.getTime() - Date.now() }); response.set("Cache-Control", "no-store"); };
  router.post("/login", loginRequests, async (request, response, next) => { let key = "invalid"; try { if (!originAllowed(request, config)) return response.status(403).json({ error: { code: "ORIGIN_FORBIDDEN", message: "Origem não permitida." } }); const input = await measurePerformance(config.PERFORMANCE_MEASUREMENTS, "auth.login", "input_validation", async () => loginCredentialsSchema.parse(request.body)); key = input.email.trim().toLowerCase(); await measurePerformance(config.PERFORMANCE_MEASUREMENTS, "auth.login", "failed_attempt_limit", () => failedAttempts.check(request.ip ?? "unknown", key)); const result = await service.login(input.email, input.password); failedAttempts.success(key); setTokens(response, result); response.status(200).json({ data: { csrfToken: result.csrfToken, expiresAt: result.expiresAt } }); } catch (error) { if ((error as { code?: string }).code === "INVALID_CREDENTIALS") failedAttempts.failure(request.ip ?? "unknown", key); next(error); } });
  router.post("/refresh", async (request, response, next) => { try { if (!originAllowed(request, config)) return response.status(403).json({ error: { code: "ORIGIN_FORBIDDEN", message: "Origem não permitida." } }); const result = await service.refresh(String(request.cookies.refresh_token ?? "")); setTokens(response, result); response.json({ data: { csrfToken: result.csrfToken, expiresAt: result.expiresAt } }); } catch (error) { next(error); } });
  router.get("/csrf", async (request, response, next) => { try { if (!originAllowed(request, config)) return response.status(403).json({ error: { code: "ORIGIN_FORBIDDEN", message: "Origem não permitida." } }); response.set("Cache-Control", "no-store").json({ data: { csrfToken: await service.recoverCsrf(String(request.cookies.refresh_token ?? "")) } }); } catch (error) { next(error); } });
  const passwordInput=z.object({currentPassword:z.string().min(1).max(256),newPassword:z.string().min(12).max(256)});
  const changePassword = (temporary: boolean) => async (request: Request, response: Response, next: (error?: unknown) => void) => { try { if(!request.identity) return response.status(401).json({ error:{code:"UNAUTHENTICATED",message:"Autenticação necessária."} }); const expected=await service.recoverCsrfForIdentity(request.identity); if(request.get(csrfHeader)!==expected) { logAuthenticationFailure("csrf_invalid"); return response.status(403).json({error:{code:"CSRF_INVALID",message:"Token CSRF inválido."}}); } const input=passwordInput.parse(request.body); if(temporary) await service.changeTemporaryPassword(request.identity,input.currentPassword,input.newPassword); else await service.changeOwnPassword(request.identity,input.currentPassword,input.newPassword); clearSessionCookies(response).status(204).end(); } catch(error){next(error);} };
  router.post("/change-temporary-password", authenticate(service), changePassword(true));
  router.post("/change-password", authenticate(service), changePassword(false));
  router.post("/change-email", authenticate(service), async (request, response, next) => { try { if(!request.identity) return response.status(401).json({error:{code:"UNAUTHENTICATED",message:"Autenticação necessária."}}); const expected=await service.recoverCsrfForIdentity(request.identity); if(request.get(csrfHeader)!==expected) { logAuthenticationFailure("csrf_invalid"); return response.status(403).json({error:{code:"CSRF_INVALID",message:"Token CSRF inválido."}}); } const input=z.object({currentPassword:z.string().min(1).max(256),email:z.string().email().max(254)}).parse(request.body); await service.changeOwnEmail(request.identity,input.currentPassword,input.email); clearSessionCookies(response).status(204).end(); } catch(error){next(error);} });
  router.post("/logout", authenticate(service), async (request: Request & { identity?: import("./auth.service.js").AuthIdentity }, response, next) => { try { if (!request.identity) return response.status(401).json({ error: { code: "UNAUTHENTICATED", message: "Autenticação necessária." } }); const csrf = await service.recoverCsrfForIdentity(request.identity); if (request.headers[csrfHeader] !== csrf) { logAuthenticationFailure("csrf_invalid"); return response.status(403).json({ error: { code: "CSRF_INVALID", message: "Token CSRF inválido." } }); } await service.logout(request.identity.sessionId); clearSessionCookies(response).status(204).end(); } catch (error) { next(error); } });
  return router;
}
