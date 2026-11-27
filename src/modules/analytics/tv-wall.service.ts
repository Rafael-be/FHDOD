import { z } from "zod";
import type postgres from "postgres";
import { DomainError } from "../../shared/core.js";
import type { AnalyticsRepository } from "./analytics.repository.js";

const unique = (items: readonly unknown[]) => new Set(items).size === items.length;
export const tvSettings = z.strictObject({
  indicators: z.array(z.enum(["completionRate", "nps", "npsGroups"])).max(3).refine(unique),
  sectorIds: z.array(z.number().int().positive().max(2147483647)).max(200).refine(unique),
  periodDays: z.number().int().min(1).max(90),
  refreshSeconds: z.number().int().min(30).max(3600),
}).refine(settings => !settings.indicators.length || settings.sectorIds.length > 0, {
  message: "Selecione ao menos um setor para publicar indicadores.", path: ["sectorIds"],
});
type Settings = z.infer<typeof tvSettings>;

const hospitalDay = new Intl.DateTimeFormat("sv-SE", { timeZone: "America/Sao_Paulo", dateStyle: "short" });

export class TvWallService {
  private cache?: { key: string; until: number; values: ReturnType<AnalyticsRepository["wallMetrics"]> };
  constructor(private readonly sql: postgres.Sql, private readonly analytics: AnalyticsRepository) {}

  async configuration(): Promise<Settings> {
    const [row] = await this.sql`select settings from tv_wall_configuration where id=1`;
    return tvSettings.parse(row?.settings);
  }

  async configure(settings: Settings): Promise<Settings> {
    const [saved] = await this.sql`
      update tv_wall_configuration set settings=${JSON.stringify(settings)}::text::jsonb
      where id=1 and (select count(*) from sectors where deleted_at is null and id=any(${settings.sectorIds}::int[]))=${settings.sectorIds.length}
      returning settings`;
    if (!saved) throw new DomainError("TV_WALL_SECTOR_INVALID", "Seleção contém um setor inválido ou inativo.", 400);
    this.cache = undefined;
    return tvSettings.parse(saved.settings);
  }

  async display(now = new Date()) {
    const config = await this.configuration();
    const { indicators, refreshSeconds, periodDays } = config;
    if (!indicators.length) return { refreshSeconds, periodDays, indicators: [] };
    const endDay = hospitalDay.format(now);
    const start = new Date(endDay + "T00:00:00Z");
    start.setUTCDate(start.getUTCDate() - periodDays);
    const from = start.toISOString().slice(0,10) + " 00:00 America/Sao_Paulo";
    const to = endDay + " 00:00 America/Sao_Paulo";
    const key = JSON.stringify([config, endDay]);
    if (this.cache?.key !== key || this.cache.until <= now.getTime()) {
      const values = this.analytics.wallMetrics({ from, to }, config.sectorIds);
      this.cache = { key, until: now.getTime() + 30_000, values };
      void values.catch(() => { if (this.cache?.values === values) this.cache = undefined; });
    }
    const metrics = await this.cache.values;
    return { refreshSeconds, periodDays, indicators: indicators.map(id => ({ id, value: metrics[id] })) };
  }
}
