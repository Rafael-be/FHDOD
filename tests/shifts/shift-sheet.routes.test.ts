import request from "supertest";
import { jest } from "@jest/globals";
import { createApp } from "../../src/app.js";
import { ShiftSheetService } from "../../src/modules/shifts/shift-sheet.service.js";
import type { AppConfig } from "../../src/config/env.js";
import type { AuthService } from "../../src/modules/auth/auth.service.js";

const config: AppConfig = { NODE_ENV: "test", PORT: 3000, DATABASE_URL: "postgres://api:pass@localhost/fhdod", ALLOWED_ORIGIN: "http://localhost:5173", JWT_SECRET: "12345678901234567890123456789012", JWT_ISSUER: "fhdod-api", JWT_AUDIENCE: "fhdod-web", PERFORMANCE_MEASUREMENTS: false };
const header = "codigo_setor;nome_setor;nome_turno;hora_inicio;hora_fim;dia_semana_iso";
const input = new TextEncoder().encode(`\ufeff${[header, "enfermagem;Enfermagem;SEM_TURNO;08:00;17:00;1", ...Array.from({ length: 6 }, (_, i) => `enfermagem;Enfermagem;FECHADO;00:00;00:00;${i + 2}`)].join("\n")}`);
function app(role: "superuser" | "sector_manager") {
  const replaceCurrentSheet = jest.fn(async () => ({ versionId: 9 }));
  const repo = { sectors: async () => [{ code: "enfermagem", name: "Enfermagem", active: true }], transaction: async (work: (repo: typeof repo) => Promise<unknown>) => work(repo), replaceCurrentSheet, currentSheetRows: async () => [] };
  const auth = { authenticate: async () => ({ userId: 1, sessionId: "test-session", role, mustChangePassword: false }), recoverCsrfForIdentity: async () => "valid-csrf" } as unknown as AuthService;
  return { server: createApp(config, { authService: auth, shiftSheetService: new ShiftSheetService(repo) }), replaceCurrentSheet };
}
describe("shift sheet HTTP protection", () => {
  it("requires authentication, superuser and CSRF for binary import", async () => {
    const admin = app("superuser");
    await request(admin.server).post("/api/shift-sheets").set("Content-Type", "application/octet-stream").send(Buffer.from(input)).expect(401);
    const manager = app("sector_manager");
    await request(manager.server).post("/api/shift-sheets").set("Cookie", "access_token=valid").set("X-CSRF-Token", "valid-csrf").set("Content-Type", "application/octet-stream").send(Buffer.from(input)).expect(403);
    await request(admin.server).post("/api/shift-sheets").set("Cookie", "access_token=valid").set("Content-Type", "application/octet-stream").send(Buffer.from(input)).expect(403);
    expect(admin.replaceCurrentSheet).not.toHaveBeenCalled();
    expect(manager.replaceCurrentSheet).not.toHaveBeenCalled();
  });
  it("accepts authorized import and returns validation details", async () => {
    const admin = app("superuser");
    await request(admin.server).post("/api/shift-sheets").set("Cookie", "access_token=valid").set("X-CSRF-Token", "valid-csrf").set("Content-Type", "application/octet-stream").send(Buffer.from(input)).expect(201).expect({ data: { versionId: 9, warnings: [] } });
    expect(admin.replaceCurrentSheet).toHaveBeenCalledTimes(1);
    const invalid = new TextEncoder().encode(`\ufeff${header}\nenfermagem;Enfermagem;;08:00;17:00;1`);
    const response = await request(admin.server).post("/api/shift-sheets").set("Cookie", "access_token=valid").set("X-CSRF-Token", "valid-csrf").set("Content-Type", "application/octet-stream").send(Buffer.from(invalid)).expect(400);
    expect(response.body.error).toMatchObject({ code: "INVALID_SHIFT_SHEET", details: expect.arrayContaining([expect.objectContaining({ line: 2, field: "nome_turno" })]) });
    expect(admin.replaceCurrentSheet).toHaveBeenCalledTimes(1);
  });
});
