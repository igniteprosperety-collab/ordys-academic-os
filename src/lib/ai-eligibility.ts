export const ORDYS_AI_MIN_AGE = 18;

export function calculateAge(birthDate: string | null | undefined, today = new Date()): number | null {
  if (!birthDate || !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) return null;
  const year = Number(birthDate.slice(0, 4));
  const month = Number(birthDate.slice(5, 7));
  const day = Number(birthDate.slice(8, 10));
  const birth = new Date(year, month - 1, day);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    birth.getFullYear() !== year ||
    birth.getMonth() !== month - 1 ||
    birth.getDate() !== day
  ) {
    return null;
  }

  let age = today.getFullYear() - year;
  const beforeBirthday =
    today.getMonth() < month - 1 ||
    (today.getMonth() === month - 1 && today.getDate() < day);
  if (beforeBirthday) age -= 1;

  return age >= 0 && age <= 130 ? age : null;
}

export function canUseOrdysAi(birthDate: string | null | undefined, today = new Date()) {
  const age = calculateAge(birthDate, today);
  return {
    age,
    allowed: age !== null && age >= ORDYS_AI_MIN_AGE,
    reason:
      age === null
        ? "Cadastre sua data de nascimento no Perfil para liberar os recursos de IA."
        : age < ORDYS_AI_MIN_AGE
          ? "Os recursos de IA que usam a OpenAI estão disponíveis apenas para contas com 18 anos ou mais."
          : "",
  };
}
