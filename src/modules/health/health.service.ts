import { DomainError } from "../../shared/core.js";

export interface HealthProbe { isAvailable(): Promise<boolean>; }
/** Exposes liveness and readiness without leaking infrastructure details. */
export class HealthService {
  constructor(private readonly repository: HealthProbe) {}
  live(){return {status:"ok" as const};}
  async ready(){try{if(!await this.repository.isAvailable())throw new Error();return {status:"ok" as const};}catch(error){if(error instanceof DomainError && error.code === "DATABASE_SCHEMA_NOT_READY") throw error;throw new DomainError("SERVICE_UNAVAILABLE","Serviço temporariamente indisponível.",503);}}
}
