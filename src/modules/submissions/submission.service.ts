import { randomUUID } from "node:crypto";
import type { Clock } from "../../shared/core.js";
import type { SubmissionRepository } from "./submission.repository.js";

export interface SubmissionStart { sessionId: string; sectorId: number; dayOfWeek: number; localTime: string; now: Date; }
export interface SubmissionQuestion { questionId: number; questionVersionId: number; text: string; questionKind: "sector" | "standard"; isNps: boolean; position: number; }
export interface SubmissionCapability { sessionId: string; token: string; }

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

  authorize(sessionId: string, token: string): boolean { return this.capabilities.get(sessionId) === token; }
}
