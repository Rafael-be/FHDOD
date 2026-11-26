import { createFormFixture } from "../helpers/form-fixture.js";
import express from "express";
import request from "supertest";
import postgres from "postgres";
import type { AuthService, AuthIdentity } from "../../src/modules/auth/auth.service.js";
import { formDraftRoutes } from "../../src/modules/submissions/form-draft.routes.js";
import { FormDraftService } from "../../src/modules/submissions/form-draft.service.js";
import { assertDisposableTestDatabase, testDatabaseUrl, usesIsolatedDatabase } from "../helpers/database.js";
import { errorHandler } from "../../src/shared/core.js";
import { questionsRoutes } from "../../src/modules/questions/questions.routes.js";
import { QuestionsService } from "../../src/modules/questions/questions.service.js";
import { QuestionsRepository } from "../../src/modules/questions/questions.repository.js";

const adminUrl = testDatabaseUrl();
const runtimeUrl = process.env.DATABASE_URL;
const integration = usesIsolatedDatabase(adminUrl, runtimeUrl) ? describe : describe.skip;

integration("form draft HTTP guards", () => {
  let fixture: Awaited<ReturnType<typeof createFormFixture>>;
  beforeAll(async()=>{fixture=await createFormFixture(adminUrl!,runtimeUrl!);});
  afterAll(async()=>{await fixture?.cleanup();});

  it("requires identity and CSRF and rejects direct edits outside the manager's sector", async () => {
    await assertDisposableTestDatabase(adminUrl!, runtimeUrl!);
    const sql = postgres(runtimeUrl!, { max: 2, prepare: false });
    const auth = { recoverCsrfForIdentity: async () => "valid-csrf" } as unknown as AuthService;
    const service = new FormDraftService(sql);
    const anonymous = express(); anonymous.use(express.json()); anonymous.use("/api", formDraftRoutes(service, auth)); anonymous.use(errorHandler);
    const manager = express(); manager.use(express.json());
    manager.use((req, _res, next) => { req.identity = { userId: fixture.managerId, sessionId: "test", role: "sector_manager", mustChangePassword: false } satisfies AuthIdentity; next(); });
    manager.use("/api", questionsRoutes(new QuestionsService(new QuestionsRepository(sql)), auth));
    manager.use("/api", formDraftRoutes(service, auth));
    manager.use(errorHandler);
    try {
      await request(anonymous).get(`/api/sectors/${fixture.sectorId}/form-draft`).expect(401);
      const [before] = await sql<{ count: number }[]>`select count(*)::int count from submission_form_drafts`;
      await request(manager).put(`/api/sectors/${fixture.sectorId}/form-draft`).send({ expectedRevision: 0, items: [] }).expect(403)
        .expect(({ body }) => expect(body.error.code).toBe("CSRF_INVALID"));
      await request(manager).put(`/api/sectors/${fixture.otherSectorId}/form-draft`).set("x-csrf-token", "valid-csrf")
        .send({ expectedRevision: 0, items: [] }).expect(403)
        .expect(({ body }) => expect(body.error.code).toBe("FORBIDDEN"));
      await request(manager).post(`/api/sectors/${fixture.sectorId}/questions`).set("x-csrf-token", "valid-csrf")
        .send({ text: "Não publicar" }).expect(409)
        .expect(({ body }) => expect(body.error.code).toBe("FORM_DRAFT_REQUIRED"));
      await request(manager).get(`/api/sectors/${fixture.sectorId}/form-draft`).expect(200)
        .expect(({ body }) => expect(body.data.sectorId).toBe(fixture.sectorId));
      await request(manager).get(`/api/questions?sectorId=${fixture.sectorId}`).expect(200)
        .expect(({ body }) => expect(body.data.items.every((item: { associations: { sectorId: number }[] }) =>
          item.associations.every((association) => association.sectorId === fixture.sectorId))).toBe(true));
      await request(manager).get(`/api/questions?sectorId=${fixture.otherSectorId}`).expect(403)
        .expect(({ body }) => expect(body.error.code).toBe("FORBIDDEN"));
      await request(manager).post(`/api/sectors/${fixture.sectorId}/form-draft/publish`).send({ expectedRevision: 0 }).expect(403)
        .expect(({ body }) => expect(body.error.code).toBe("CSRF_INVALID"));
      await request(manager).post(`/api/sectors/${fixture.sectorId}/form-draft/publish`).set("x-csrf-token", "valid-csrf")
        .send({ expectedRevision: 0 }).expect(409)
        .expect(({ body }) => expect(body.error.code).toBe("DRAFT_CONFLICT"));
      const [after] = await sql<{ count: number }[]>`select count(*)::int count from submission_form_drafts`;
      expect(after.count).toBe(before.count);
    } finally { await sql.end({ timeout: 5 }); }
  });
});
