import { describe, expect, it } from "vitest";
import { canUseOrdysAi, calculateAge, ORDYS_AI_MIN_AGE } from "@/lib/ai-eligibility";

describe("ORDYS AI age eligibility", () => {
  const today = new Date(2026, 8, 27);

  it("requires a birth date and blocks unknown age", () => {
    expect(calculateAge(null, today)).toBeNull();
    expect(canUseOrdysAi(null, today).allowed).toBe(false);
  });

  it("allows exactly the minimum age", () => {
    expect(calculateAge("2008-09-27", today)).toBe(18);
    expect(canUseOrdysAi("2008-09-27", today).allowed).toBe(true);
  });

  it("blocks users below the minimum age", () => {
    expect(calculateAge("2008-09-28", today)).toBe(17);
    expect(canUseOrdysAi("2008-09-28", today).allowed).toBe(false);
  });

  it("does not count an upcoming birthday as completed", () => {
    expect(calculateAge("2008-09-28", today)).toBe(17);
    expect(ORDYS_AI_MIN_AGE).toBe(18);
  });

  it("rejects non-ISO date strings", () => {
    expect(calculateAge("27/09/2008", today)).toBeNull();
  });

  it("rejects impossible calendar dates", () => {
    expect(calculateAge("2000-02-30", today)).toBeNull();
    expect(canUseOrdysAi("2000-02-30", today).allowed).toBe(false);
  });
});
