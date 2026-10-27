import { randomUUID } from "node:crypto";
import type { Clock } from "../../shared/core.js";
import type { SubmissionRepository } from "./submission.repository.js";
import { DomainError } from "../../shared/core.js";

export interface SubmissionStart { sessionId: string; sectorId: number; dayOfWeek: number; localTime: string; now: Date; }
export interface SubmissionQuestion { sessionQuestionId?: number; questionId: number; questionVersionId: number; text: string; questionKind: "sector" | "standard"; isNps: boolean; position: number; }
export interface SubmissionCapability { sessionId: string; token: string; }
export type SubmissionAnswerInput = { sessionQuestionId: number; status: "answered" | "skipped"; score: number | null };

export class SubmissionService {
  private readonly capabilities = new Map<string, string>();
  constructor(private readonly repository: SubmissionRepository, private readonly clock: Clock) {}

  async start(sectorId: number, dayOfWeek: number, localTime: string): Promise<{ capability: SubmissionCapability; session: unknown; questions: SubmissionQuestion[] }> {
    const sessionId = randomUUID();
    const result = await this.repository.transaction((repository) => repository.createSessionSnapshot({ sessionId, sectorId, dayOfWeek, localTime, now: this.clock.now() }));
    const token = randomUUID();
    this.capabilities.set(sessionId, token);
    return { capability: { sessionId, token }, ...result };
  }

  async startNow(sectorId: number): Promise<{ capability: SubmissionCapability; session: unknown; questions: SubmissionQuestion[] }> {
    const now = this.clock.now();
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[parts.find((part) => part.type === "weekday")?.value as "Mon"];
    const hour = parts.find((part) => part.type === "hour")?.value ?? "00";
    const minute = parts.find((part) => part.type === "minute")?.value ?? "00";
    return this.start(sectorId, weekday ?? 1, `${hour}:${minute}`);
  }

  authorize(sessionId: string, token: string): boolean { return this.capabilities.get(sessionId) === token; }

  async answer(sessionId: string, token: string, input: SubmissionAnswerInput) {
    if (!this.authorize(sessionId, token)) throw new DomainError("SUBMISSION_CAPABILITY_INVALID", "Capability de sessão inválida.", 403);
    if (input.status === "answered" && input.score === null) throw new DomainError("INVALID_ANSWER", "Resposta exige uma nota.", 400);
    if (input.status === "skipped" && input.score !== null) throw new DomainError("INVALID_ANSWER", "Pergunta pulada não pode ter nota.", 400);
    return this.repository.transaction((repository) => repository.saveAnswer(sessionId, input, this.clock.now()));
  }

  async restart(sessionId: string, token: string) {
    if (!this.authorize(sessionId, token)) throw new DomainError("SUBMISSION_CAPABILITY_INVALID", "Capability de sessão inválida.", 403);
    const { sectorId } = await this.repository.transaction((repository) => repository.endSession(sessionId, this.clock.now()));
    this.capabilities.delete(sessionId);
    return this.startNow(sectorId);
  }
}
