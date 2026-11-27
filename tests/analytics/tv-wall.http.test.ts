import { jest } from "@jest/globals";
import request from "supertest";
import { createApp } from "../../src/app.js";
import type { AppConfig } from "../../src/config/env.js";
import type { AuthService } from "../../src/modules/auth/auth.service.js";
import type { TvWallService } from "../../src/modules/analytics/tv-wall.service.js";
import { SecurityRateLimiter } from "../../src/security/rate-limiter.js";

const settings = { indicators:["nps"],sectorIds:[2],periodDays:7,refreshSeconds:60 };
const display = { indicators:[{id:"nps",value:null}],periodDays:7,refreshSeconds:60 };
const wall = { configuration:async()=>settings,configure:jest.fn(async()=>settings),display:async()=>display };
function app(role: string) {
  const auth = {authenticate:async()=>({role,mustChangePassword:false}),recoverCsrfForIdentity:async()=>"csrf"};
  return createApp({NODE_ENV:"test"} as AppConfig,{authService:auth as unknown as AuthService,tvWallService:wall as unknown as TvWallService});
}
it("serves a read-only public view with fixed scope and no administrative credentials", async () => {
  const client = request(app("sector_manager"));
  await client.get("/api/public/tv-wall").expect(200, {data:display});
  await client.get("/api/public/tv-wall?sectorId=123").expect(400);
  await client.get("/api/tv-wall/config").expect(401);
  await client.get("/api/tv-wall/config").set("Cookie","access_token=x").expect(403);
  await client.put("/api/tv-wall/config").set("Cookie","access_token=x").set("x-csrf-token","csrf").send(settings).expect(403);
});
it("restricts configuration writes to a superuser with CSRF and an explicit valid selection", async () => {
  const client = request(app("superuser"));
  await client.get("/api/tv-wall/config").set("Cookie","access_token=x").expect(200,{data:settings});
  await client.put("/api/tv-wall/config").set("Cookie","access_token=x").send(settings).expect(403);
  for (const changes of [{sectorIds:[]},{indicators:["ombudsman"]},{indicators:["nps","nps"]},{periodDays:0},{refreshSeconds:1}])
    await client.put("/api/tv-wall/config").set("Cookie","access_token=x").set("x-csrf-token","csrf").send({...settings,...changes}).expect(400);
  expect(wall.configure).not.toHaveBeenCalled();
  await client.put("/api/tv-wall/config").set("Cookie","access_token=x").set("x-csrf-token","csrf").send(settings).expect(200,{data:settings});
});

it("rate limits the public wall per client and recovers after the window", async () => {
  let now = 1_000;
  const limiter = new SecurityRateLimiter(undefined, false, "12345678901234567890123456789012", () => now);
  const limited = createApp({ NODE_ENV: "test", RATE_LIMIT_TV_WALL_PER_IP: 2 } as AppConfig, {
    authService: ({ authenticate: async () => ({ role: "superuser", mustChangePassword: false }) } as unknown) as AuthService,
    tvWallService: wall as unknown as TvWallService,
    securityRateLimiter: limiter,
  });
  await request(limited).get("/api/public/tv-wall").expect(200);
  await request(limited).get("/api/public/tv-wall").expect(200);
  await request(limited).get("/api/public/tv-wall").expect(429).expect(({ body, headers }) => {
    expect(body.error.code).toBe("TV_WALL_RATE_LIMITED");
    expect(headers["retry-after"]).toBeDefined();
  });
  now += 61_000;
  await request(limited).get("/api/public/tv-wall").expect(200);
});
