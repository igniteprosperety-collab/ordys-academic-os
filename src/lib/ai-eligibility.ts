export const ORDYS_AI_MIN_AGE = 18;

function calculateAgeOnCalendarDate(
  birthDate: string | null | undefined,
  currentYear: number,
  currentMonth: number,
  currentDay: number,
): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  if (
    !Number.isInteger(currentYear) ||
    !Number.isInteger(currentMonth) ||
    !Number.isInteger(currentDay) ||
    currentMonth < 1 ||
    currentMonth > 12 ||
    currentDay < 1 ||
    currentDay > 31
  ) return null;

  const year = Number(birthDate.slice(0, 4));
  const month = Number(birthDate.slice(5, 7));
  const day = Number(birthDate.slice(8, 10));
  const birth = new Date(Date.UTC(year, month - 1, day));
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    birth.getUTCFullYear() !== year ||
    birth.getUTCMonth() !== month - 1 ||
    birth.getUTCDate() !== day
  ) return null;

  let age = currentYear - year;
  if (currentMonth < month || (currentMonth === month && currentDay < day)) age -= 1;
  return age >= 0 && age <= 130 ? age : null;
}

// Kept for callers that explicitly need the browser's local calendar date.
export function calculateAge(birthDate: string | null | undefined, today = new Date()): number | null {
  if (!(today instanceof Date) || !Number.isFinite(today.getTime())) return null;
  return calculateAgeOnCalendarDate(
    birthDate,
    today.getFullYear(),
    today.getMonth() + 1,
    today.getDate(),
  );
}

export function calculateAgeInTimeZone(
  birthDate: string | null | undefined,
  timezone: string | null | undefined,
  now = new Date(),
): number | null {
  if (
    typeof timezone !== "string" ||
    !timezone.trim() ||
    !(now instanceof Date) ||
    !Number.isFinite(now.getTime())
  ) return null;

  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(now);
  } catch {
    return null;
  }

  const values = new Map(parts.map((part) => [part.type, part.value]));
  return calculateAgeOnCalendarDate(
    birthDate,
    Number(values.get("year")),
    Number(values.get("month")),
    Number(values.get("day")),
  );
}

export function canUseOrdysAi(
  birthDate: string | null | undefined,
  timezone: string | null | undefined,
  now = new Date(),
) {
  const age = calculateAgeInTimeZone(birthDate, timezone, now);
  return {
    age,
    allowed: age !== null && age >= ORDYS_AI_MIN_AGE,
    reason:
      age === null
        ? "Confirme sua data de nascimento e fuso horário no Perfil para liberar os recursos de IA."
        : age < ORDYS_AI_MIN_AGE
          ? "Os recursos de IA que usam a OpenAI estão disponíveis apenas para contas com 18 anos ou mais."
          : "",
  };
}
