import "dotenv/config";
import postgres from "postgres";
import { ShiftSheetService } from "../../src/modules/shifts/shift-sheet.service.js";
import { PostgresShiftSheetRepository } from "../../src/modules/shifts/shift-sheet.repository.js";
import { usesIsolatedDatabase } from "../helpers/database.js";

const testUrl = process.env.DATABASE_URL_TEST;
const runtimeUrl = process.env.DATABASE_URL;
const describeIntegration = usesIsolatedDatabase(testUrl, runtimeUrl) ? describe : describe.skip;

describeIntegration("shift sheet download integration", () => {
  it("returns the current sheet as UTF-8 CSV with BOM", async () => {
    const sql = postgres(testUrl!, { max: 1 });
    try {
      const csv = await new ShiftSheetService(new PostgresShiftSheetRepository(sql)).download();
      expect([...csv.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
      expect(new TextDecoder().decode(csv)).toContain("codigo_setor;nome_setor;nome_turno");
    } finally { await sql.end({ timeout: 5 }); }
  });
});
