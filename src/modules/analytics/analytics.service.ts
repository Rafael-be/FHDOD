import type { AuthIdentity } from "../auth/auth.service.js";
import { DomainError } from "../../shared/core.js";
import type { AnalyticsFilter, AnalyticsRepository } from "./analytics.repository.js";

export class AnalyticsService {
  constructor(private readonly repository: AnalyticsRepository) {}
  async dashboard(actor: AuthIdentity, filter: AnalyticsFilter) {
    if (actor.role === "superuser") return this.repository.dashboard(filter, null);
    if (actor.role !== "sector_manager") throw new DomainError("FORBIDDEN", "Acesso não permitido.", 403);
    const allowed = await this.repository.sectorIds(actor.userId);
    if (filter.sectorId !== undefined && !allowed.includes(filter.sectorId))
      throw new DomainError("FORBIDDEN", "Setor fora do seu escopo.", 403);
    return this.repository.dashboard(filter, allowed);
  }
}
