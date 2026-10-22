import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { logInternalError } from "./logger.js";

export class DomainError extends Error { constructor(public readonly code: string, message: string, public readonly status = 400) { super(message); } }
export const forbidden = (message = "Você não possui permissão para esta operação.") => new DomainError("FORBIDDEN", message, 403);
export const notFound = (message = "Recurso não encontrado.") => new DomainError("NOT_FOUND", message, 404);
/** Converts unmatched HTTP routes to the API's standard error envelope. */
export function notFoundHandler(_request: Request, _response: Response, next: NextFunction): void { next(notFound()); }
export function errorHandler(error: unknown, request: Request, response: Response, _next: NextFunction): void {
  if (error instanceof DomainError) { response.status(error.status).json({ error: { code: error.code, message: error.message } }); return; }
  if (error instanceof ZodError) { response.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Dados de entrada inválidos." } }); return; }
  logInternalError(error, request);
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Ocorreu um erro interno." } });
}
export interface Clock { now(): Date; }
export class SystemClock implements Clock { now(): Date { return new Date(); } }
export interface TransactionManager { transaction<T>(work: () => Promise<T>): Promise<T>; }
export class NoopTransactionManager implements TransactionManager { async transaction<T>(work: () => Promise<T>): Promise<T> { return work(); } }
export function normalizeEmail(value: string): string { return value.trim().toLocaleLowerCase("pt-BR"); }
export function normalizeSectorCode(value: string): string { return value.trim().normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase(); }
