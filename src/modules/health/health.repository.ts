import type postgres from "postgres";

/** Minimal database probe that never returns connection metadata. */
export class HealthRepository {
  constructor(private readonly sql: postgres.Sql) {}
  async isAvailable(): Promise<boolean> { await this.sql`select 1`; return true; }
}
