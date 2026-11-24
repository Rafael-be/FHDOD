import { canTransitionTicket, ticketStatuses } from "../../src/modules/ombudsman/ombudsman.repository.js";
import { optionalBrazilianPhone } from "../../src/modules/ombudsman/ombudsman.validation.js";

describe("ombudsman input and workflow", () => {
  it("accepts absent and blank phones as NULL-compatible values and normalizes Brazilian phones", () => {
    for (const value of [undefined, null, "", "   "]) expect(optionalBrazilianPhone.parse(value)).toBeUndefined();
    expect(optionalBrazilianPhone.parse("(51) 99999-9999")).toBe("51999999999");
    expect(optionalBrazilianPhone.parse("(51) 3333-4444")).toBe("5133334444");
    expect(optionalBrazilianPhone.parse("5133334444")).toBe("5133334444");
  });
  it("rejects invalid numbers and unexpected characters", () => {
    for (const value of ["11-1234-5678", "(00) 99999-9999", "+55 (51) 99999-9999", "(51) 99999-9999 ext 1", "5119999999"]) {
      expect(optionalBrazilianPhone.safeParse(value).success).toBe(false);
    }
  });
  it("allows the specified manual transitions and keeps resolved closed", () => {
    expect(ticketStatuses).toEqual(["open", "read", "contact_attempt", "contact_failed", "resolved"]);
    expect(canTransitionTicket("open", "read", false)).toBe(true);
    expect(canTransitionTicket("read", "resolved", false)).toBe(true);
    expect(canTransitionTicket("open", "contact_attempt", false)).toBe(false);
    expect(canTransitionTicket("read", "contact_attempt", true)).toBe(true);
    expect(canTransitionTicket("contact_attempt", "contact_failed", true)).toBe(true);
    expect(canTransitionTicket("contact_failed", "contact_attempt", true)).toBe(true);
    expect(canTransitionTicket("contact_attempt", "contact_failed", false)).toBe(false);
    expect(canTransitionTicket("contact_failed", "resolved", false)).toBe(true);
    expect(canTransitionTicket("open", "contact_failed", true)).toBe(false);
    expect(canTransitionTicket("resolved", "read", true)).toBe(false);
  });
});
