import { hospitalShiftTime } from "../../src/modules/submissions/submission-time.js";

describe("hospitalShiftTime", () => {
  it("uses the hospital IANA timezone instead of the process timezone", () => {
    expect(hospitalShiftTime(new Date("2026-01-06T02:30:00.000Z"), "America/Sao_Paulo"))
      .toEqual({ dayOfWeek: 1, previousDayOfWeek: 7, localTime: "23:30" });
    expect(hospitalShiftTime(new Date("2026-01-05T02:30:00.000Z"), "America/Sao_Paulo"))
      .toEqual({ dayOfWeek: 7, previousDayOfWeek: 6, localTime: "23:30" });
  });

  it("uses timezone rules for the instant instead of a fixed offset", () => {
    expect(hospitalShiftTime(new Date("2018-11-05T02:30:00.000Z"), "America/Sao_Paulo").localTime).toBe("00:30");
    expect(hospitalShiftTime(new Date("2026-11-05T02:30:00.000Z"), "America/Sao_Paulo").localTime).toBe("23:30");
  });
});
