import { DomainError, forbidden, notFound } from "../../shared/core.js";
import type { AuthIdentity } from "../auth/auth.service.js";
import { QUESTION_POLICY } from "./questions.constants.js";
import type { QuestionRow, QuestionsRepository } from "./questions.repository.js";

function dto(row: QuestionRow) {
  const policy = row.isNps ? QUESTION_POLICY.nps : QUESTION_POLICY.sector;
  return { ...row, ...policy };
}

export class QuestionsService {
  constructor(private readonly repository: QuestionsRepository) {}

  private async authorize(actor: AuthIdentity, sectorId: number): Promise<void> {
    if (actor.role === "superuser") return;
    if (actor.role !== "sector_manager" || !(await this.repository.sectorAccess(actor.userId, sectorId))) throw forbidden();
  }

  async listSector(actor: AuthIdentity, sectorId: number, includeDeleted: boolean) {
    await this.authorize(actor, sectorId);
    return (await this.repository.listSector(sectorId, includeDeleted)).map(dto);
  }

  async createSector(actor: AuthIdentity, sectorId: number, text: string, displayOrder: number) {
    await this.authorize(actor, sectorId);
    return this.repository.transaction(async (repository) => {
      const row = await repository.createSector(sectorId, text, displayOrder, actor.userId);
      await repository.audit(actor.userId, "question.created", row.id);
      return dto(row);
    });
  }

  async updateText(actor: AuthIdentity, id: number, text: string) {
    const question = await this.repository.findSectorQuestion(id);
    if (!question || question.sectorId === null) throw notFound();
    await this.authorize(actor, question.sectorId);
    if (question.text === text) return dto(question);
    return this.repository.transaction(async (repository) => {
      const row = await repository.updateText(id, text, actor.userId);
      if (!row) throw notFound();
      await repository.audit(actor.userId, "question.version_created", id);
      return dto(row);
    });
  }

  async setDeleted(actor: AuthIdentity, id: number, deleted: boolean) {
    const question = await this.repository.findSectorQuestion(id);
    if (!question || question.sectorId === null) throw notFound();
    await this.authorize(actor, question.sectorId);
    if (!deleted && await this.repository.hasActiveOrderConflict(question)) {
      throw new DomainError("QUESTION_ORDER_CONFLICT", "A posição da pergunta já está ocupada.", 409);
    }
    return this.repository.transaction(async (repository) => {
      if (!await repository.setDeleted(id, deleted)) throw new DomainError("CONFLICT", "A pergunta já está nesse estado.", 409);
      await repository.audit(actor.userId, deleted ? "question.deactivated" : "question.reactivated", id);
    });
  }
}
