import { describe, expect, it } from "vitest";
import {
  canUseOrdysAi,
  calculateAge,
  calculateAgeInTimeZone,
  ORDYS_AI_MIN_AGE,
} from "@/lib/ai-eligibility";

describe("ORDYS AI age eligibility", () => {
  const localToday = new Date(2026, 8, 27);
  const saoPauloToday = new Date("2026-09-27T12:00:00.000Z");

  it("requires a birth date and a profile time zone", () => {
    expect(calculateAge(null, localToday)).toBeNull();
    expect(canUseOrdysAi(null, "America/Sao_Paulo", saoPauloToday).allowed).toBe(false);
    expect(canUseOrdysAi("2008-09-27", null, saoPauloToday).allowed).toBe(false);
  });

  it("allows exactly the minimum age using the profile time zone", () => {
    expect(calculateAge("2008-09-27", localToday)).toBe(18);
    expect(canUseOrdysAi("2008-09-27", "America/Sao_Paulo", saoPauloToday).allowed).toBe(true);
    expect(ORDYS_AI_MIN_AGE).toBe(18);
  });

  it("blocks users below the minimum age", () => {
    expect(canUseOrdysAi("2008-09-28", "America/Sao_Paulo", saoPauloToday).age).toBe(17);
    expect(canUseOrdysAi("2008-09-28", "America/Sao_Paulo", saoPauloToday).allowed).toBe(false);
  });

  it("uses the profile time zone at the exact birthday boundary", () => {
    const beforeSaoPauloBirthday = new Date("2026-10-31T02:30:00.000Z");
    const afterSaoPauloBirthday = new Date("2026-10-31T03:30:00.000Z");

    expect(calculateAgeInTimeZone(
      "2008-10-31",
      "America/Sao_Paulo",
      beforeSaoPauloBirthday,
    )).toBe(17);
    expect(calculateAgeInTimeZone(
      "2008-10-31",
      "UTC",
      beforeSaoPauloBirthday,
    )).toBe(18);
    expect(calculateAgeInTimeZone(
      "2008-10-31",
      "America/Sao_Paulo",
      afterSaoPauloBirthday,
    )).toBe(18);
  });

  it("fails closed for invalid dates and IANA time zones", () => {
    const now = new Date("2026-10-31T12:00:00.000Z");
    expect(calculateAgeInTimeZone("2000-02-30", "UTC", now)).toBeNull();
    expect(calculateAgeInTimeZone("2008-10-31", "Not/A_Real_Zone", now)).toBeNull();
    expect(canUseOrdysAi("2008-10-31", "Not/A_Real_Zone", now).allowed).toBe(false);
  });
});
