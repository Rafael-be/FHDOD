import type { AuthIdentity } from "../auth/auth.service.js";
import { DomainError } from "../../shared/core.js";
import type { AnalyticsFilter, AnalyticsRepository } from "./analytics.repository.js";

export class AnalyticsService {
  constructor(private readonly repository: AnalyticsRepository) {}
  private async authorizedSectors(actor: AuthIdentity, filter: AnalyticsFilter) {
    if (actor.role === "superuser") return null;
    if (actor.role !== "sector_manager") throw new DomainError("FORBIDDEN", "Acesso não permitido.", 403);
    const allowed = await this.repository.sectorIds(actor.userId);
    if ((filter.sectorIds ?? (filter.sectorId ? [filter.sectorId] : [])).some(id => !allowed.includes(id)))
      throw new DomainError("FORBIDDEN", "Setor fora do seu escopo.", 403);
    return allowed;
  }
  async dashboard(actor: AuthIdentity, filter: AnalyticsFilter) {
    return this.repository.dashboard(filter, await this.authorizedSectors(actor, filter));
  }
  async globalQuestions(actor: AuthIdentity, filter: AnalyticsFilter, questionId?: number) {
    return this.repository.globalQuestions(filter, await this.authorizedSectors(actor, filter), questionId);
  }
}
