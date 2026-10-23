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
    return (await this.repository.listEffective(sectorId, includeDeleted)).map(dto);
  }

  private requireSuperuser(actor: AuthIdentity): void {
    if (actor.role !== "superuser") throw forbidden();
  }

  async createStandard(actor: AuthIdentity, input: { text: string; scope: "all_sectors" | "selected_sectors"; sectorIds: number[]; displayOrder: number }) {
    this.requireSuperuser(actor);
    return this.repository.transaction(async (repository) => {
      const row = await repository.createStandard(input.text, input.scope, input.sectorIds, input.displayOrder, actor.userId);
      await repository.audit(actor.userId, "standard_question.created", row.id);
      return dto(row);
    });
  }

  async createNps(actor: AuthIdentity, input: { text: string; scope: "all_sectors" | "selected_sectors"; sectorIds: number[] }) {
    this.requireSuperuser(actor);
    return this.repository.transaction(async (repository) => {
      const row = await repository.createNps(input.text, input.scope, input.sectorIds, actor.userId);
      await repository.audit(actor.userId, "nps.created", row.id);
      return dto(row);
    });
  }

  async assignNps(actor: AuthIdentity, sectorId: number, questionId: number, replace: boolean) {
    this.requireSuperuser(actor);
    if (!await this.repository.activeNps(questionId)) throw notFound("NPS não encontrado.");
    if (!replace && await this.repository.sectorHasNps(sectorId)) {
      throw new DomainError("NPS_ALREADY_ASSIGNED", "O setor já possui um NPS vigente.", 409);
    }
    return this.repository.transaction(async (repository) => {
      await repository.assignNps(sectorId, questionId, actor.userId, replace);
      await repository.audit(actor.userId, replace ? "nps.replaced" : "nps.assigned", questionId);
    });
  }

  async reorderSector(actor: AuthIdentity, sectorId: number, ids: number[]) {
    await this.authorize(actor, sectorId);
    return this.repository.transaction(async (repository) => {
      try { await repository.reorderSectorQuestions(sectorId, ids); } catch (error) { if (error instanceof Error && error.message.includes("must contain")) throw new DomainError("INVALID_ORDER", "A ordem deve conter todas as perguntas ativas do setor.", 409); throw error; }
      await repository.audit(actor.userId, "question.reordered", sectorId);
    });
  }

  async reorderStandard(actor: AuthIdentity, sectorId: number, ids: number[]) {
    this.requireSuperuser(actor);
    return this.repository.transaction(async (repository) => {
      try { await repository.reorderStandardQuestions(sectorId, ids); } catch (error) { if (error instanceof Error && error.message.includes("must contain")) throw new DomainError("INVALID_ORDER", "A ordem deve conter todas as perguntas padrão ativas do setor.", 409); throw error; }
      await repository.audit(actor.userId, "standard_question.reordered", sectorId);
    });
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
