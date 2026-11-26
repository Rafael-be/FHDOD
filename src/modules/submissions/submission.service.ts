import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { Clock } from "../../shared/core.js";
import type { SubmissionRepository } from "./submission.repository.js";
import { DomainError } from "../../shared/core.js";
import { HOSPITAL_TIME_ZONE, hospitalShiftTime } from "./submission-time.js";
import { publishedFormCache } from "./form-cache.js";
import { measurePerformance, surveyEvent } from "../../shared/performance.js";
import { logPerformanceMeasurement } from "../../shared/logger.js";

export interface SubmissionStart { sessionId: string; sectorId: number; dayOfWeek: number; previousDayOfWeek: number; localTime: string; now: Date; confirmedAt?: () => Date; capabilityHash?: Buffer; }
export interface SubmissionQuestion { questionId: number; questionVersionId: number; text: string; questionKind: "sector" | "standard"; isNps: boolean; position: number; }
export interface SubmissionCapability { sessionId: string; token: string; }
export type SubmissionAnswerInput = { questionId: number; questionVersionId: number; status: "answered" | "skipped"; score: number | null };

export class SubmissionService {
  // Compatibility only for repository test doubles that predate persistent capabilities.
  // PostgresSubmissionRepository always supplies capabilityHash and never reads this map.
  private readonly testCapabilities = new Map<string, string>();
  constructor(private readonly repository: SubmissionRepository, private readonly clock: Clock, private readonly hospitalTimeZone = HOSPITAL_TIME_ZONE, private readonly trace = false) {}

  async currentForm(sectorId: number) {
    surveyEvent("CURRENT_FORM_REQUEST", "submission.current_form");
    if (!this.repository.currentForm) throw new Error("Consulta de formulário vigente indisponível.");
    const form = await measurePerformance(this.trace, "submission.current_form", "resolve", () => this.repository.currentForm!(sectorId));
    const questions = form.questions.map((question) => ({ ...question, required: question.questionKind === "standard", options: question.isNps ? Array.from({ length: 11 }, (_, score) => score) : [1, 2, 3, 4, 5], minScore: question.isNps ? 0 : 1, maxScore: question.isNps ? 10 : 5 }));
    const etag = `"${createHash("sha256").update(JSON.stringify({ sectorId, formVersionId: form.formVersionId, questions })).digest("hex")}"`;
    surveyEvent("CURRENT_FORM_RESOLVED", "submission.current_form");
    return { sectorId, formVersionId: form.formVersionId, questions, etag };
  }

  async startWithFirstAnswer(sectorId: number, formVersionId: number, attemptId: string, token: string, answer: SubmissionAnswerInput) {
    surveyEvent("FIRST_ANSWER_RECEIVED", "submission.first_answer");
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new DomainError("SUBMISSION_CAPABILITY_INVALID", "Capability inválida.", 403);
    if (answer.status === "answered" && answer.score === null || answer.status === "skipped" && answer.score !== null)
      throw new DomainError("INVALID_ANSWER", "Resposta inválida.", 400);
    const now = this.clock.now();
    const local = hospitalShiftTime(now, this.hospitalTimeZone);
    const capabilityHash = createHash("sha256").update(token).digest();
    const result = await measurePerformance(this.trace, "submission.first_answer", "write_transaction", () => this.repository.transaction(async (repository) => {
      await repository.lockAttempt?.(attemptId);
      const prior = await repository.firstAttempt?.(attemptId);
      if (prior) {
        if (prior.sectorId !== sectorId || prior.formVersionId !== formVersionId || prior.capabilityHash.length !== capabilityHash.length || !timingSafeEqual(prior.capabilityHash, capabilityHash))
          throw new DomainError("SUBMISSION_CONFLICT", "Tentativa já utilizada.", 409);
        if (prior.answer.questionId !== answer.questionId || prior.answer.questionVersionId !== answer.questionVersionId || prior.answer.status !== answer.status || prior.answer.score !== answer.score)
          throw new DomainError("ANSWER_ALREADY_CONFIRMED", "Resposta já confirmada não pode ser alterada.", 409);
        return { capability: { sessionId: attemptId, token }, session: { id: attemptId, sectorId, formVersionId, expiresAt: prior.expiresAt }, answer: { sessionId: attemptId, status: prior.status, answered: answer.status === "answered", expiresAt: prior.expiresAt }, replayed: true };
      }
      const created = await repository.createSessionSnapshot({ sessionId: attemptId, sectorId, dayOfWeek: local.dayOfWeek, previousDayOfWeek: local.previousDayOfWeek, localTime: local.localTime, now, confirmedAt: () => this.clock.now(), capabilityHash }, formVersionId);
      const saved = await repository.saveAnswer(attemptId, answer, now, true, () => this.clock.now());
      return { capability: { sessionId: attemptId, token }, session: created.session, answer: saved, replayed: false };
    }));
    if (!result.replayed) {
      surveyEvent("SESSION_CREATED", "submission.first_answer");
      surveyEvent("ANSWER_PERSISTED", "submission.first_answer");
      if (result.answer.status === "complete") surveyEvent("SUBMISSION_COMPLETED", "submission.first_answer");
    }
    return result;
  }

  async start(sectorId: number, dayOfWeek: number, localTime: string, now = this.clock.now()) {
    const started = performance.now();
    const generated = performance.now();
    const sessionId = randomUUID();
    const token = randomBytes(32).toString("base64url");
    if (this.trace) logPerformanceMeasurement("submission.create", "capability_generate", performance.now() - generated);
    const hashed = performance.now();
    const capabilityHash = createHash("sha256").update(token).digest();
    if (this.trace) logPerformanceMeasurement("submission.create", "capability_hash", performance.now() - hashed);
    const result = await measurePerformance(this.trace, "submission.create", "transaction_total", () => this.repository.transaction(async (repository) => {
      if (repository.reconcileExpired) await measurePerformance(this.trace, "submission.create", "expired_reconcile", () => repository.reconcileExpired!(now));
      return repository.createSessionSnapshot({ sessionId, sectorId, dayOfWeek, previousDayOfWeek: dayOfWeek === 1 ? 7 : dayOfWeek - 1, localTime, now, capabilityHash });
    }));
    // The transaction has committed. Cache failures must not turn a persisted session into an HTTP error.
    try { publishedFormCache.put(result.session.formVersionId, result.questions); } catch { /* database remains the source of truth */ }
    if (!this.repository.capabilityHash) this.testCapabilities.set(sessionId, token);
    const built = performance.now();
    const response = { capability: { sessionId, token }, ...result };
    if (this.trace) {
      logPerformanceMeasurement("submission.create", "response_build", performance.now() - built);
      logPerformanceMeasurement("submission.create", "total", performance.now() - started);
    }
    return response;
  }

  async startNow(sectorId: number) {
    const now = this.clock.now();
    const local = hospitalShiftTime(now, this.hospitalTimeZone);
    return this.start(sectorId, local.dayOfWeek, local.localTime, now);
  }

  async authorize(sessionId: string, token: string): Promise<boolean> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) return false;
    if (!this.repository.capabilityHash) return this.testCapabilities.get(sessionId) === token;
    const expected = await this.repository.capabilityHash(sessionId);
    const received = createHash("sha256").update(token).digest();
    return expected !== null && expected.length === received.length && timingSafeEqual(expected, received);
  }

  async answer(sessionId: string, token: string, input: SubmissionAnswerInput) {
    if (!await measurePerformance(this.trace, "submission.answer", "authorize", () => this.authorize(sessionId, token))) throw new DomainError("SUBMISSION_CAPABILITY_INVALID", "Capability de sessão inválida.", 403);
    if (input.status === "answered" && input.score === null) throw new DomainError("INVALID_ANSWER", "Resposta exige uma nota.", 400);
    if (input.status === "skipped" && input.score !== null) throw new DomainError("INVALID_ANSWER", "Pergunta pulada não pode ter nota.", 400);
    const now = this.clock.now();
    try {
      const result = await measurePerformance(this.trace, "submission.answer", "write_transaction", () => this.repository.transaction((repository) => repository.saveAnswer(sessionId, input, now, false, () => this.clock.now())));
      if (!result.replayed) {
        surveyEvent("ANSWER_PERSISTED", "submission.answer");
        if (result.status === "complete") surveyEvent("SUBMISSION_COMPLETED", "submission.answer");
        else surveyEvent("SESSION_RENEWED", "submission.answer");
      }
      return result;
    } catch (error) {
      if (error instanceof DomainError && error.code === "SUBMISSION_EXPIRED") {
        await this.repository.expireSession?.(sessionId, this.clock.now());
      }
      throw error;
    }
  }

  async restart(sessionId: string, token: string) {
    if (!await this.authorize(sessionId, token)) throw new DomainError("SUBMISSION_CAPABILITY_INVALID", "Capability de sessão inválida.", 403);
    const { sectorId } = await this.repository.transaction((repository) => repository.endSession(sessionId, this.clock.now()));
    this.testCapabilities.delete(sessionId);
    return this.currentForm(sectorId);
  }

  async refresh(sessionId: string, token: string) {
    if (!await this.authorize(sessionId, token)) throw new DomainError("SUBMISSION_CAPABILITY_INVALID", "Capability de sessão inválida.", 403);
    const now = this.clock.now();
    try { return await this.repository.transaction((repository) => repository.refreshSession!(sessionId, now)); }
    catch (error) {
      if (error instanceof DomainError && error.code === "SUBMISSION_EXPIRED") await this.repository.expireSession?.(sessionId, now);
      throw error;
    }
  }

  async close(sessionId: string, token: string) {
    if (!await this.authorize(sessionId, token)) throw new DomainError("SUBMISSION_CAPABILITY_INVALID", "Capability de sessão inválida.", 403);
    return this.repository.transaction((repository) => repository.closeSession!(sessionId, this.clock.now(), () => this.clock.now()));
  }
}
