import { DomainError, forbidden, notFound } from "../../shared/core.js";
import type { AuthIdentity } from "../auth/auth.service.js";
import { QUESTION_POLICY } from "./questions.constants.js";
import type { QuestionRow, QuestionsRepository } from "./questions.repository.js";

function dto(row: QuestionRow) {
  const policy = row.isNps ? QUESTION_POLICY.nps : QUESTION_POLICY.sector;
  return { ...row, ...policy };
}

function mapQuestionConflict(error: unknown): DomainError | null {
  const databaseError = error as { code?: string; constraint_name?: string };
  if (databaseError.code !== "23505") return null;
  if (databaseError.constraint_name === "questions_active_sector_order_uq" || databaseError.constraint_name === "question_sector_assignment_active_order_uq") return new DomainError("QUESTION_ORDER_CONFLICT", "A posição da pergunta já está ocupada.", 409);
  if (databaseError.constraint_name === "questions_one_active_global_nps_uq") return new DomainError("NPS_GLOBAL_ALREADY_EXISTS", "Já existe um NPS global ativo.", 409);
  if (databaseError.constraint_name === "sector_nps_one_current_per_sector_uq") return new DomainError("NPS_ALREADY_ASSIGNED", "O setor já possui um NPS vigente.", 409);
  return new DomainError("QUESTION_CONFLICT", "A operação de pergunta entrou em conflito com o estado atual.", 409);
}

function mapQuestionScopeError(error: unknown): DomainError | null {
  if (!(error instanceof Error) || !error.message.startsWith("Invalid ")) return null;
  return notFound("Um ou mais setores não foram encontrados ou estão desativados.");
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

  async listCatalog(actor: AuthIdentity, input: { type?: "standard" | "nps"; state?: "active" | "inactive"; scope?: "all_sectors" | "selected_sectors"; sectorId?: number; page: number; pageSize: number }) {
    this.requireSuperuser(actor);
    if (input.sectorId !== undefined && !await this.repository.activeSector(input.sectorId)) throw notFound("Setor não encontrado.");
    const rows = await this.repository.listCatalog({ ...input, limit: input.pageSize, offset: (input.page - 1) * input.pageSize });
    return { items: rows.map(dto), page: input.page, pageSize: input.pageSize, total: rows[0]?.total ?? 0 };
  }

  async catalogQuestion(actor: AuthIdentity, id: number) {
    this.requireSuperuser(actor);
    const question = await this.repository.catalogQuestion(id);
    if (!question) throw notFound("Pergunta padrão ou NPS não encontrada.");
    return dto(question);
  }

  private requireSuperuser(actor: AuthIdentity): void {
    if (actor.role !== "superuser") throw forbidden();
  }

  private async validateScope(scope: "all_sectors" | "selected_sectors", sectorIds: number[]): Promise<void> {
    if (scope === "selected_sectors" && await this.repository.activeSectorCount(sectorIds) !== sectorIds.length) {
      throw notFound("Um ou mais setores não foram encontrados ou estão desativados.");
    }
  }

  async createStandard(actor: AuthIdentity, input: { text: string; scope: "all_sectors" | "selected_sectors"; sectorIds: number[]; displayOrder: number }) {
    this.requireSuperuser(actor);
    await this.validateScope(input.scope, input.sectorIds);
    try { return await this.repository.transaction(async (repository) => { const row = await repository.createStandard(input.text, input.scope, input.sectorIds, input.displayOrder, actor.userId); await repository.audit(actor.userId, "standard_question.created", row.id); return dto(row); }); } catch (error) { throw mapQuestionConflict(error) ?? mapQuestionScopeError(error) ?? error; }
  }

  async createNps(actor: AuthIdentity, input: { text: string; scope: "all_sectors" | "selected_sectors"; sectorIds: number[]; replaceGlobal?: boolean }) {
    this.requireSuperuser(actor);
    await this.validateScope(input.scope, input.sectorIds);
    try { return await this.repository.transaction(async (repository) => {
      const replacedId = input.scope === "all_sectors" && input.replaceGlobal
        ? await repository.replaceActiveGlobalNps() : null;
      const row = await repository.createNps(input.text, input.scope, input.sectorIds, actor.userId);
      await repository.audit(actor.userId, replacedId === null ? "nps.created" : "nps.global_replaced", row.id);
      return dto(row);
    }); } catch (error) { throw mapQuestionConflict(error) ?? mapQuestionScopeError(error) ?? error; }
  }

  async assignNps(actor: AuthIdentity, sectorId: number, questionId: number, replace: boolean) {
    this.requireSuperuser(actor);
    if (!await this.repository.activeSector(sectorId)) throw notFound("Setor não encontrado.");
    if (!await this.repository.activeNps(questionId)) throw notFound("NPS não encontrado.");
    if (!replace && await this.repository.sectorHasNps(sectorId)) {
      throw new DomainError("NPS_ALREADY_ASSIGNED", "O setor já possui um NPS vigente.", 409);
    }
    try { return await this.repository.transaction(async (repository) => {
      await repository.assignNps(sectorId, questionId, actor.userId, replace);
      await repository.audit(actor.userId, replace ? "nps.replaced" : "nps.assigned", questionId);
    }); } catch (error) { throw mapQuestionConflict(error) ?? error; }
  }

  async removeNpsOverride(actor: AuthIdentity, sectorId: number) {
    this.requireSuperuser(actor);
    if (!await this.repository.activeSector(sectorId)) throw notFound("Setor não encontrado.");
    return this.repository.transaction(async (repository) => {
      if (!await repository.removeNpsOverride(sectorId)) throw notFound("Override de NPS não encontrado.");
      await repository.audit(actor.userId, "nps.override_removed", sectorId);
    });
  }

  async reorderSector(actor: AuthIdentity, sectorId: number, ids: number[]) {
    await this.authorize(actor, sectorId);
    return this.repository.transaction(async (repository) => {
      try { await repository.reorderSectorQuestions(sectorId, ids); } catch (error) { if (error instanceof Error && error.message.includes("must contain")) throw new DomainError("INVALID_ORDER", "A ordem deve conter todas as perguntas ativas do setor.", 409); throw mapQuestionConflict(error) ?? error; }
      await repository.audit(actor.userId, "question.reordered", sectorId);
    });
  }

  async reorderStandard(actor: AuthIdentity, sectorId: number, ids: number[]) {
    this.requireSuperuser(actor);
    return this.repository.transaction(async (repository) => {
      try { await repository.reorderStandardQuestions(sectorId, ids); } catch (error) { if (error instanceof Error && error.message.includes("must contain")) throw new DomainError("INVALID_ORDER", "A ordem deve conter todas as perguntas padrão ativas do setor.", 409); throw mapQuestionConflict(error) ?? error; }
      await repository.audit(actor.userId, "standard_question.reordered", sectorId);
    });
  }

  async createSector(actor: AuthIdentity, sectorId: number, text: string, displayOrder: number) {
    await this.authorize(actor, sectorId);
    if (!await this.repository.activeSector(sectorId)) throw notFound("Setor não encontrado.");
    try { return await this.repository.transaction(async (repository) => { const row = await repository.createSector(sectorId, text, displayOrder, actor.userId); await repository.audit(actor.userId, "question.created", row.id); return dto(row); }); } catch (error) { throw mapQuestionConflict(error) ?? error; }
  }

  async updateText(actor: AuthIdentity, id: number, text: string) {
    const question = await this.repository.findQuestion(id);
    if (!question) throw notFound();
    if (question.questionKind === "sector" && question.sectorId !== null) await this.authorize(actor, question.sectorId);
    else this.requireSuperuser(actor);
    if (question.text === text) return dto(question);
    return this.repository.transaction(async (repository) => {
      const row = await repository.updateText(id, text, actor.userId);
      if (!row) throw notFound();
      await repository.audit(actor.userId, "question.version_created", id);
      return dto(row);
    });
  }

  async setDeleted(actor: AuthIdentity, id: number, deleted: boolean) {
    const question = await this.repository.findQuestion(id);
    if (!question) throw notFound();
    if (question.questionKind === "sector" && question.sectorId !== null) await this.authorize(actor, question.sectorId);
    else this.requireSuperuser(actor);
    if (!deleted && question.deletedAt === null) {
      throw new DomainError("QUESTION_ALREADY_ACTIVE", "A pergunta já está ativa.", 409);
    }
    if (!deleted && question.questionKind !== "sector") {
      return this.repository.transaction(async (repository) => {
        try { await repository.reactivateScoped(question); } catch (error) { if (error instanceof Error && error.message.includes("conflict")) throw new DomainError("REACTIVATION_CONFLICT", "Não foi possível reativar a pergunta porque o escopo ou a posição está ocupado.", 409); throw mapQuestionConflict(error) ?? error; }
        await repository.audit(actor.userId, question.isNps ? "nps.reactivated" : "standard_question.reactivated", id);
        const row = await repository.findQuestion(id);
        if (!row) throw notFound();
        return dto(row);
      });
    }
    if (!deleted && await this.repository.hasActiveOrderConflict(question)) {
      throw new DomainError("QUESTION_ORDER_CONFLICT", "A posição da pergunta já está ocupada.", 409);
    }
    return this.repository.transaction(async (repository) => {
      if (!await repository.setDeleted(id, deleted)) throw new DomainError("CONFLICT", "A pergunta já está nesse estado.", 409);
      if (deleted) await repository.endAssignments(id, question.isNps);
      await repository.audit(actor.userId, deleted ? "question.deactivated" : "question.reactivated", id);
      const row = await repository.findQuestion(id);
      if (!row) throw notFound();
      return dto(row);
    });
  }
}
