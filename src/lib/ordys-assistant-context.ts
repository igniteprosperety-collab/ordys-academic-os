export const ORDYS_CONTEXT_SCOPE_OPTIONS = [
  { value: "profile", label: "Perfil e matérias", description: "Etapa de ensino, preferências acadêmicas e dados das disciplinas." },
  { value: "agenda", label: "Agenda", description: "Horários, tarefas e provas." },
  { value: "performance", label: "Desempenho", description: "Notas, frequência e metas." },
  { value: "study", label: "Estudos", description: "Tópicos, plano, foco, revisões e check-ins." },
  { value: "quizzes", label: "Simulados", description: "Histórico e resultados dos simulados." },
] as const;

export type OrdysAcademicContextScope = (typeof ORDYS_CONTEXT_SCOPE_OPTIONS)[number]["value"];

export type OrdysContextSection =
  | "profile" | "subjects" | "schedules" | "tasks" | "exams" | "grades"
  | "attendance" | "goals" | "topics" | "plan" | "focus" | "reviews"
  | "quizAttempts" | "checkins";

const SCOPE_SECTIONS: Record<OrdysAcademicContextScope, readonly OrdysContextSection[]> = {
  profile: ["profile", "subjects"],
  agenda: ["schedules", "tasks", "exams"],
  performance: ["grades", "attendance", "goals"],
  study: ["topics", "plan", "focus", "reviews", "checkins"],
  quizzes: ["quizAttempts"],
};

export function normalizeOrdysContextScopes(value: unknown): OrdysAcademicContextScope[] {
  if (!Array.isArray(value)) return [];
  const allowed = new Set<string>(ORDYS_CONTEXT_SCOPE_OPTIONS.map((option) => option.value));
  const selected = new Set<OrdysAcademicContextScope>();
  for (const item of value) {
    if (typeof item === "string" && allowed.has(item)) {
      selected.add(item as OrdysAcademicContextScope);
    }
  }
  return [...selected];
}

export function getOrdysContextSections(
  scopes: readonly OrdysAcademicContextScope[],
): Set<OrdysContextSection> {
  const sections = new Set<OrdysContextSection>();
  for (const scope of scopes) {
    for (const section of SCOPE_SECTIONS[scope]) sections.add(section);
  }
  return sections;
}
