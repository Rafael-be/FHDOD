import argon2 from "argon2";
import type { Clock } from "../../shared/core.js";
import {
  DomainError,
  notFound,
  normalizeEmail,
  normalizeSectorCode,
} from "../../shared/core.js";
import { measurePerformance } from "../../shared/performance.js";
import type { AuthIdentity } from "../auth/auth.service.js";
import { AdminRepository, type SectorReadiness } from "./admin.repository.js";

interface ManagerInput {
  fullName: string;
  email: string;
  temporaryPassword: string;
  sectorIds: number[];
}

interface ManagerUpdateInput {
  fullName: string;
  email: string;
}

interface SectorInput {
  code: string;
  name: string;
}

function requireSuperuser(actor: AuthIdentity): void {
  if (actor.role !== "superuser") {
    throw new DomainError("FORBIDDEN", "Somente superusuário pode executar esta operação.", 403);
  }
}

function sectorStatus(readiness: SectorReadiness) {
  const missingRequirements = [
    !readiness.hasShiftRanges ? "shift_ranges" : null,
    !readiness.hasNps ? "nps" : null,
  ].filter((value): value is string => value !== null);

  return {
    status: missingRequirements.length === 0 ? "active" as const : "preparing" as const,
    missingRequirements,
  };
}

export class AdminService {
  constructor(
    private readonly repository: AdminRepository,
    private readonly clock: Clock,
    private readonly performanceMeasurements = false,
  ) {}

  async createManager(actor: AuthIdentity, input: ManagerInput) {
    requireSuperuser(actor);

    const expiresAt = new Date(this.clock.now().getTime() + 48 * 3_600_000);
    const passwordHash = await measurePerformance(
      this.performanceMeasurements,
      "admin.create_manager",
      "password_hash",
      () => argon2.hash(input.temporaryPassword, {
        type: argon2.argon2id,
        memoryCost: 19456,
        timeCost: 2,
        parallelism: 1,
        hashLength: 32,
      }),
    );

    try {
      return await measurePerformance(
        this.performanceMeasurements,
        "admin.create_manager",
        "database_transaction",
        () => this.repository.transaction(async (repository) => {
          const manager = await repository.createManager(
            input.fullName.trim(),
            normalizeEmail(input.email),
            passwordHash,
            expiresAt,
          );

          for (const sectorId of [...new Set(input.sectorIds)]) {
            if (!await repository.sector(sectorId)) {
              throw notFound("Setor não encontrado.");
            }
            await repository.assign(manager.id, sectorId, actor.userId);
          }

          await repository.audit(
            actor.userId,
            "manager.created",
            "user",
            manager.id,
            null,
            { email: manager.email },
          );
          return manager;
        }),
      );
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new DomainError("EMAIL_ALREADY_EXISTS", "Este e-mail já está em uso.", 409);
      }
      throw error;
    }
  }

  async listManagers(actor: AuthIdentity, deleted = false) {
    requireSuperuser(actor);
    return this.repository.managers(deleted);
  }

  /** Returns a manager and its active sector assignments without exposing credentials. */
  async getManager(actor: AuthIdentity, id: number, includeDeleted = false) {
    requireSuperuser(actor);

    const manager = await this.repository.manager(id, includeDeleted);
    if (!manager) {
      throw notFound("Gestor não encontrado.");
    }

    return {
      ...manager,
      sectors: await this.repository.managerSectors(id),
    };
  }

  async updateManager(actor: AuthIdentity, id: number, input: ManagerUpdateInput) {
    requireSuperuser(actor);

    try {
      return await this.repository.transaction(async (repository) => {
        const before = await repository.manager(id);
        if (!before) {
          throw notFound("Gestor não encontrado.");
        }

        const manager = await repository.updateManager(
          id,
          input.fullName.trim(),
          normalizeEmail(input.email),
        );
        if (!manager) {
          throw notFound("Gestor não encontrado.");
        }

        await repository.audit(
          actor.userId,
          "manager.updated",
          "user",
          id,
          { email: before.email },
          { email: manager.email },
        );
        return manager;
      });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        throw new DomainError("EMAIL_ALREADY_EXISTS", "Este e-mail já está em uso.", 409);
      }
      throw error;
    }
  }

  async deactivateManager(actor: AuthIdentity, id: number): Promise<void> {
    requireSuperuser(actor);

    await this.repository.transaction(async (repository) => {
      if (!await repository.deactivateManager(id)) {
        throw notFound("Gestor não encontrado.");
      }

      await repository.revokeSessions(id);
      await repository.audit(actor.userId, "manager.deactivated", "user", id, null, null);
    });
  }

  async reactivateManager(actor: AuthIdentity, id: number, password: string): Promise<void> {
    requireSuperuser(actor);

    const passwordHash = await argon2.hash(password, {
      type: argon2.argon2id,
      memoryCost: 19456,
      timeCost: 2,
      parallelism: 1,
      hashLength: 32,
    });
    const expiresAt = new Date(this.clock.now().getTime() + 48 * 3_600_000);

    await this.repository.transaction(async (repository) => {
      if (!await repository.reactivateManager(id, passwordHash, expiresAt)) {
        throw notFound("Gestor desativado não encontrado.");
      }

      await repository.revokeSessions(id);
      await repository.audit(actor.userId, "manager.reactivated", "user", id, null, null);
    });
  }

  async createSector(actor: AuthIdentity, input: SectorInput) {
    requireSuperuser(actor);

    return measurePerformance(
      this.performanceMeasurements,
      "admin.create_sector",
      "database_transaction",
      () => this.repository.transaction(async (repository) => {
        const sector = await repository.createSector(
          normalizeSectorCode(input.code),
          input.name.trim(),
          actor.userId,
        );
        await repository.audit(
          actor.userId,
          "sector.created",
          "sector",
          sector.id,
          null,
          { code: sector.code },
        );
        return sector;
      }),
    );
  }

  async listSectors(actor: AuthIdentity, deleted = false) {
    if (actor.role === "superuser") {
      return this.repository.sectors(deleted);
    }
    if (actor.role === "sector_manager") {
      return this.repository.managerSectors(actor.userId);
    }

    throw new DomainError("FORBIDDEN", "Sem permissão.", 403);
  }

  /** Lists a manager's active sector assignments, enforcing manager self-scope. */
  async listManagerSectors(actor: AuthIdentity, managerId: number) {
    if (actor.role === "sector_manager") {
      if (actor.userId !== managerId) {
        throw new DomainError("FORBIDDEN", "Você não possui acesso aos setores deste gestor.", 403);
      }
      return this.repository.managerSectors(managerId);
    }

    requireSuperuser(actor);
    if (!await this.repository.manager(managerId)) {
      throw notFound("Gestor não encontrado.");
    }

    return this.repository.managerSectors(managerId);
  }

  /** Calculates a sector's public readiness while enforcing the manager's sector scope. */
  async sectorStatus(actor: AuthIdentity, sectorId: number) {
    const sector = await this.repository.sector(sectorId);
    if (!sector) {
      throw notFound("Setor não encontrado.");
    }

    if (actor.role === "sector_manager") {
      const assignedSectors = await this.repository.managerSectors(actor.userId);
      if (!assignedSectors.some((item) => item.id === sectorId)) {
        throw new DomainError("FORBIDDEN", "Você não possui acesso a este setor.", 403);
      }
    } else {
      requireSuperuser(actor);
    }

    return {
      sectorId,
      ...sectorStatus(await this.repository.readiness(sectorId)),
    };
  }

  async updateSector(actor: AuthIdentity, id: number, name: string) {
    requireSuperuser(actor);

    return this.repository.transaction(async (repository) => {
      const before = await repository.sector(id);
      if (!before) {
        throw notFound("Setor não encontrado.");
      }

      const sector = await repository.renameSector(id, name.trim());
      if (!sector) {
        throw notFound("Setor não encontrado.");
      }

      await repository.audit(
        actor.userId,
        "sector.updated",
        "sector",
        id,
        { name: before.name },
        { name: sector.name },
      );
      return sector;
    });
  }

  async deactivateSector(actor: AuthIdentity, id: number, deleted: boolean): Promise<void> {
    requireSuperuser(actor);

    await this.repository.transaction(async (repository) => {
      if (!await repository.setSectorDeleted(id, deleted)) {
        throw notFound(deleted ? "Setor não encontrado." : "Setor desativado não encontrado.");
      }

      await repository.audit(
        actor.userId,
        deleted ? "sector.deactivated" : "sector.reactivated",
        "sector",
        id,
        null,
        null,
      );
    });
  }

  async assignment(
    actor: AuthIdentity,
    managerId: number,
    sectorId: number,
    assign: boolean,
  ): Promise<void> {
    requireSuperuser(actor);

    await this.repository.transaction(async (repository) => {
      if (!await repository.manager(managerId)) {
        throw notFound("Gestor não encontrado.");
      }
      if (!await repository.sector(sectorId)) {
        throw notFound("Setor não encontrado.");
      }

      if (assign) {
        await repository.assign(managerId, sectorId, actor.userId);
      } else if (!await repository.unassign(managerId, sectorId, actor.userId)) {
        throw notFound("Vínculo não encontrado.");
      }

      await repository.audit(
        actor.userId,
        assign ? "manager.sector_assigned" : "manager.sector_unassigned",
        "user_sector",
        managerId,
        null,
        { sectorId },
      );
    });
  }
}
