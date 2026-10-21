import { openapiDocument } from "../src/docs/openapi.js";

describe("OpenAPI request contracts", () => {
  it("describes login fields with a non-production example", () => {
    const login = openapiDocument.paths["/api/auth/login"].post;
    expect(login.requestBody.content["application/json"].schema.$ref).toBe("#/components/schemas/LoginRequest");
    expect(openapiDocument.components.schemas.LoginRequest.required).toEqual(["email", "password"]);
    expect(login.requestBody.content["application/json"].example).toEqual({ email: "admin@example.test", password: "senha-de-desenvolvimento" });
    expect(login.responses).toEqual(expect.objectContaining({ "200": expect.anything(), "400": expect.anything(), "401": expect.anything(), "403": expect.anything(), "429": expect.anything() }));
  });

  it("documents every Fase 1 JSON body with a schema", () => {
    const paths = openapiDocument.paths as Record<string, Record<string, { requestBody?: unknown }>>;
    const bodyOperations = [["/api/auth/change-temporary-password", "post"], ["/api/auth/change-password", "post"], ["/api/auth/change-email", "post"], ["/api/managers", "post"], ["/api/managers/{id}", "patch"], ["/api/managers/{id}/reactivate", "post"], ["/api/sectors", "post"], ["/api/sectors/{id}", "patch"], ["/api/pages/{slug}", "put"]] as const;
    for (const [path, method] of bodyOperations) expect(paths[path]![method]!.requestBody).toBeDefined();
  });
});
