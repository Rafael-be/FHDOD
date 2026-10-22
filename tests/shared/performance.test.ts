import { jest } from "@jest/globals";
import { measurePerformance } from "../../src/shared/performance.js";

describe("performance instrumentation", () => {
  it("emits only the operation, stage and monotonic duration when enabled", async () => {
    const write = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await expect(measurePerformance(true, "admin.create_sector", "database_transaction", async () => "done")).resolves.toBe("done");
      expect(JSON.parse(String(write.mock.calls[0]?.[0]))).toMatchObject({ event: "performance.measurement", operation: "admin.create_sector", stage: "database_transaction", durationMs: expect.any(Number) });
    } finally { write.mockRestore(); }
  });

  it("does not add timing work or logs when disabled", async () => {
    const write = jest.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      await expect(measurePerformance(false, "auth.login", "password_verify", async () => "done")).resolves.toBe("done");
      expect(write).not.toHaveBeenCalled();
    } finally { write.mockRestore(); }
  });
});
