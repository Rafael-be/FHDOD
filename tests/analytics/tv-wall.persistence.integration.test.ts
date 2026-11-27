import request from "supertest";
import type postgres from "postgres";
import { createApp } from "../../src/app.js";
import { createDatabase } from "../../src/db/client.js";
import type { AppConfig } from "../../src/config/env.js";
import type { AuthService } from "../../src/modules/auth/auth.service.js";
import { AnalyticsRepository } from "../../src/modules/analytics/analytics.repository.js";
import { TvWallService } from "../../src/modules/analytics/tv-wall.service.js";
import { usesIsolatedDatabase, testDatabaseUrl, assertDisposableTestDatabase } from "../helpers/database.js";
import { createFormFixture } from "../helpers/form-fixture.js";

const admin = testDatabaseUrl(), runtime = process.env.DATABASE_URL;
const integration = usesIsolatedDatabase(admin, runtime) ? describe : describe.skip;
integration("TV configuration with the production Drizzle/Postgres.js client", () => {
  it("persists consecutive HTTP writes as JSON objects and exposes only public metrics", async () => {
    await assertDisposableTestDatabase(admin!,runtime!);
    const fixture = await createFormFixture(admin!,runtime!);
    const config = {NODE_ENV:"test",DATABASE_URL:runtime} as AppConfig;
    const database = createDatabase(config);
    const rollback = new Error("rollback fixture");
    try {
      await expect(database.client.begin(async tx => {
        const sql = tx as unknown as postgres.Sql;
        const service = new TvWallService(sql,new AnalyticsRepository(sql));
        const auth = {authenticate:async()=>({userId:fixture.adminId,role:"superuser"}),recoverCsrfForIdentity:async()=>"csrf"} as unknown as AuthService;
        const client = request(createApp(config,{authService:auth,tvWallService:service}));
        for (const indicators of [["nps"],["completionRate","nps"]]) {
          const settings = {indicators,sectorIds:[fixture.sectorId],periodDays:7,refreshSeconds:30};
          await client.put("/api/tv-wall/config").set("Cookie","access_token=test").set("x-csrf-token","csrf").send(settings).expect(200,{data:settings});
          expect(await sql`select jsonb_typeof(settings) as kind,settings from tv_wall_configuration where id=1`).toEqual([{kind:"object",settings}]);
          await client.get("/api/tv-wall/config").set("Cookie","access_token=test").expect(200,{data:settings});
          const shown = await client.get("/api/public/tv-wall").expect(200,{data:{indicators:indicators.map(id=>({id,value:null})),periodDays:7,refreshSeconds:30}});
          expect(shown.headers["set-cookie"]).toBeUndefined();
        }
        throw rollback;
      })).rejects.toBe(rollback);
    } finally { await database.close(); await fixture.cleanup(); }
  });
});
