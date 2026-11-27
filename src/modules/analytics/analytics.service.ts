import type { AuthIdentity } from "../auth/auth.service.js";
import { DomainError } from "../../shared/core.js";
import type { AnalyticsFilter } from "./analytics.types.js";
import type { AnalyticsRepository } from "./analytics.repository.js";

export class AnalyticsService {
  private readonly minimumResponses: number;
  constructor(private readonly repository: AnalyticsRepository, minimumResponses = Number(process.env.ANALYTICS_MIN_RESPONSES ?? 5)) {
    this.minimumResponses = Number.isSafeInteger(minimumResponses) && minimumResponses >= 1 && minimumResponses <= 1000 ? minimumResponses : 5;
  }
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
  async heatmap(actor: AuthIdentity, filter: AnalyticsFilter) {
    return this.repository.heatmap(filter, await this.authorizedSectors(actor, filter));
  }
  async questionDistribution(actor: AuthIdentity, filter: AnalyticsFilter) {
    if (!filter.sectorId) throw new DomainError("VALIDATION_ERROR", "Informe sectorId.", 400);
    const result = await this.repository.questionDistribution(filter, await this.authorizedSectors(actor, filter));
    if (!result) throw new DomainError("FORM_NOT_PUBLISHED", "Setor sem formulário publicado vigente.", 404);
    return result;
  }
  async criticalQuestions(actor: AuthIdentity, filter: AnalyticsFilter, limit: 3 | 5) {
    return { minimumResponses: this.minimumResponses,
      items: await this.repository.criticalQuestions(filter, await this.authorizedSectors(actor, filter), limit, this.minimumResponses) };
  }
}
