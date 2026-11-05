import { openapiDocument } from "../../src/docs/openapi.js";

describe("OpenAPI request contracts", () => {
  it("describes login fields with a non-production example", () => {
    const login = openapiDocument.paths["/api/auth/login"].post;
    expect(login.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/LoginRequest");
    expect(openapiDocument.components.schemas.LoginRequest.required).toEqual(["email", "password"]);
    expect(login.requestBody.content["application/json"].example).toEqual({ email: "admin@example.test", password: "senha-de-desenvolvimento" });
    expect(login.responses).toEqual(expect.objectContaining({ "200": expect.anything(), "400": expect.anything(), "401": expect.anything(), "403": expect.anything(), "429": expect.anything() }));
  });

  it("documents the session response for login/refresh and public user response for /me", () => {
    const paths = openapiDocument.paths as Record<string, Record<string, {
      responses: Record<string, {
        content?: { "application/json"?: { schema?: { $ref?: string } } };
      }>;
    }>>;
    expect(openapiDocument.components.schemas.AuthUserResponse.required).toEqual(["user"]);
    expect(openapiDocument.components.schemas.AuthSessionResponse.required).toEqual(["user", "csrfToken"]);
    for (const [path, method] of [["/api/auth/login", "post"], ["/api/auth/refresh", "post"]] as const) {
      expect(paths[path]![method]!.responses["200"]!.content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/AuthSessionResponse");
    }
    expect(paths["/api/auth/me"]!.get!.responses["200"]!.content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/AuthUserResponse");
  });

  it("documents every Fase 1 JSON body with a schema", () => {
    const paths = openapiDocument.paths as Record<string, Record<string, { requestBody?: unknown }>>;
    const bodyOperations = [["/api/auth/change-temporary-password", "post"], ["/api/auth/change-password", "post"], ["/api/auth/change-email", "post"], ["/api/managers", "post"], ["/api/managers/{id}", "patch"], ["/api/managers/{id}/reactivate", "post"], ["/api/sectors", "post"], ["/api/sectors/{id}", "patch"], ["/api/pages/{slug}", "put"]] as const;
    for (const [path, method] of bodyOperations) expect(paths[path]![method]!.requestBody).toBeDefined();
  });

  it("documents the protected shift sheet upload", () => {
    const upload = openapiDocument.paths["/api/shift-sheets"].post;
    expect(upload.security).toEqual([{ cookieAuth: [] }]);
    expect(upload.requestBody.content["application/octet-stream"].schema).toMatchObject({ format: "binary" });
  });

  it("documents the shift sheet download", () => {
    expect(openapiDocument.paths["/api/shift-sheets"].get).toMatchObject({ security: [{ cookieAuth: [] }] });
  });

  it("documents the anonymous submission start", () => {
    expect(openapiDocument.info.description).toContain("Fases 1, 2 e 3");
    expect(openapiDocument.paths["/api/public/sectors/{sectorId}/submissions"].post).toMatchObject({ responses: { "409": expect.anything(), "429": expect.anything() } });
  });

  it("documents anonymous restart", () => {
    const restart = openapiDocument.paths["/api/public/submissions/{sessionId}/restart"].post;
    expect(restart).not.toHaveProperty("security");
    expect(restart.responses).toEqual(expect.objectContaining({ "404": expect.anything(), "429": expect.anything() }));
  });

  it("documents anonymous answer lifecycle errors", () => {
    const answer = openapiDocument.paths["/api/public/submissions/{sessionId}/answers"].post;
    expect(answer.responses).toEqual(expect.objectContaining({ "404": expect.anything(), "409": expect.anything(), "410": expect.anything(), "429": expect.anything() }));
  });

  it("documents the sector status response codes and cookie wording", () => {
    expect(openapiDocument.paths["/api/sectors/{id}/deactivate"].post.responses).toEqual(expect.objectContaining({ "200": expect.anything() }));
    expect(openapiDocument.paths["/api/sectors/{id}/deactivate"].post.responses["204"]).toBeUndefined();
    expect(openapiDocument.paths["/api/sectors/{id}/reactivate"].post.responses).toEqual(expect.objectContaining({ "200": expect.anything() }));
    expect(openapiDocument.paths["/api/sectors/{id}/reactivate"].post.responses["204"]).toBeUndefined();
    expect(openapiDocument.paths["/api/questions/{id}/deactivate"].post.description).toContain("Exige cookie");
    expect(openapiDocument.paths["/api/questions/{id}/reactivate"].post.description).toContain("Exige cookie");
    expect(JSON.stringify(openapiDocument)).not.toContain("Exigecookie");
  });

  it("documents the Fase 2 question and NPS request contracts", () => {
    const paths = openapiDocument.paths as Record<string, Record<string, { requestBody?: { content?: { "application/json"?: { schema?: { $ref?: string } } } } }>>;
    expect(paths["/api/sectors/{sectorId}/questions"].post.requestBody?.content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/QuestionRequest");
    expect(paths["/api/standard-questions"].post.requestBody?.content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/StandardQuestionRequest");
    expect(paths["/api/nps-questions"].post.requestBody?.content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/NpsQuestionRequest");
    expect(paths["/api/sectors/{sectorId}/questions/reorder"].post.responses["204"]).toBeDefined();
    expect(paths["/api/sectors/{sectorId}/standard-questions/reorder"].post.requestBody?.content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/ReorderQuestionsRequest");
    expect(paths["/api/questions/{id}"].patch.requestBody?.content?.["application/json"]?.schema?.$ref).toBe("#/components/schemas/QuestionTextUpdateRequest");
    expect(paths["/api/questions/{id}/deactivate"].post.responses["200"]).toBeDefined();
    expect(paths["/api/questions/{id}/reactivate"].post.responses["409"]).toBeDefined();
    expect(paths["/api/questions"].get).toBeDefined();
    expect(paths["/api/questions/{id}"].get).toBeDefined();
    expect(paths["/api/sectors/{sectorId}/nps"].delete).toBeDefined();
  });
});
