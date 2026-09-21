type GuestRow = Record<string, unknown>;

export type GuestTable =
  | "subjects"
  | "subject_schedules"
  | "topics"
  | "tasks"
  | "subtasks"
  | "exams"
  | "grades"
  | "attendance_records"
  | "focus_sessions"
  | "plan_sessions"
  | "reviews"
  | "goals"
  | "notifications"
  | "calendar_events"
  | "daily_checkins"
  | "quiz_attempts"
  | "quiz_answers"
  | "calendar_connections"
  | "notification_preferences";

type GuestState = {
  id: string;
  created_at: string;
  profile: GuestRow;
  tables: Record<GuestTable, GuestRow[]>;
};

const ACTIVE_KEY = "ordys:guest:active";
const STATE_KEY = "ordys:guest:state:v1";

const uuid = () =>
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `guest-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const pad = (n: number) => String(n).padStart(2, "0");
const dateKey = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const isoAt = (d: Date, hour: number, minute = 0) => {
  const next = new Date(d);
  next.setHours(hour, minute, 0, 0);
  return next.toISOString();
};
const addDays = (d: Date, days: number) => {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
};

function buildDefaultState(): GuestState {
  const now = new Date();
  const id = uuid();
  const subject = (name: string, short_name: string, teacher: string, room: string, color: string) => ({
    id: uuid(),
    user_id: id,
    name,
    short_name,
    teacher,
    room,
    color,
    term: "2026 · 2º período",
    weekly_hours: 4,
    grade_goal: 7,
    attendance_goal: 75,
    archived: false,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  });

  const subjects = [
    subject("Comunicação Empresarial", "COM", "Prof. Marina", "Sala 12", "var(--subject-blue)"),
    subject("Matemática", "MAT", "Prof. Renato", "Sala 08", "var(--subject-indigo)"),
    subject("História", "HIS", "Prof. Camila", "Sala 15", "var(--subject-gold)"),
    subject("Tecnologia", "TEC", "Prof. Lucas", "Lab 02", "var(--subject-cyan)"),
  ];

  const topics = [
    ["Fundamentos da comunicação", subjects[0]!.id, 58, "estudando"],
    ["Comunicação não verbal", subjects[0]!.id, 36, "precisa_revisar"],
    ["Funções e gráficos", subjects[1]!.id, 72, "estudado"],
    ["Equações do 2º grau", subjects[1]!.id, 42, "precisa_revisar"],
    ["Brasil República", subjects[2]!.id, 68, "estudado"],
    ["Era Vargas", subjects[2]!.id, 40, "estudando"],
    ["Segurança digital", subjects[3]!.id, 84, "dominado"],
    ["Lógica de programação", subjects[3]!.id, 55, "estudando"],
  ].map(([title, subject_id, mastery, status], i) => ({
    id: uuid(),
    user_id: id,
    subject_id,
    title,
    mastery,
    status,
    last_review: dateKey(addDays(now, -(i + 1))),
    next_review: dateKey(addDays(now, i % 2 ? 2 : 4)),
    notes: "Conteúdo de demonstração do modo visita.",
    position: i,
    created_at: now.toISOString(),
    updated_at: now.toISOString(),
  }));

  const tasks = [
    {
      id: uuid(), user_id: id, subject_id: subjects[0]!.id, topic_id: topics[0]!.id,
      title: "Resumo da comunicação corporativa", description: "Criar um resumo de uma página.",
      due_at: isoAt(addDays(now, 1), 23, 59), priority: "alta", status: "nao_iniciada", estimated_minutes: 45,
      completed_at: null, created_at: now.toISOString(), updated_at: now.toISOString(),
    },
    {
      id: uuid(), user_id: id, subject_id: subjects[1]!.id, topic_id: topics[3]!.id,
      title: "Lista de exercícios · 2º grau", description: "Resolver exercícios selecionados.",
      due_at: isoAt(addDays(now, 2), 20), priority: "media", status: "nao_iniciada", estimated_minutes: 60,
      completed_at: null, created_at: now.toISOString(), updated_at: now.toISOString(),
    },
    {
      id: uuid(), user_id: id, subject_id: subjects[3]!.id, topic_id: topics[7]!.id,
      title: "Revisão de lógica", description: "Refazer exercícios errados.",
      due_at: isoAt(addDays(now, -1), 18), priority: "alta", status: "nao_iniciada", estimated_minutes: 30,
      completed_at: null, created_at: now.toISOString(), updated_at: now.toISOString(),
    },
    {
      id: uuid(), user_id: id, subject_id: subjects[2]!.id, topic_id: topics[5]!.id,
      title: "Leitura complementar", description: "Ler material indicado.",
      due_at: isoAt(addDays(now, 5), 21), priority: "baixa", status: "nao_iniciada", estimated_minutes: 35,
      completed_at: null, created_at: now.toISOString(), updated_at: now.toISOString(),
    },
  ];

  const exams = [
    {
      id: uuid(), user_id: id, subject_id: subjects[1]!.id, title: "Avaliação de Matemática",
      exam_at: isoAt(addDays(now, 4), 8), weight: "2", content: "Funções, gráficos e equações.",
      kind: "prova", created_at: now.toISOString(), updated_at: now.toISOString(),
    },
    {
      id: uuid(), user_id: id, subject_id: subjects[0]!.id, title: "Projeto de Comunicação",
      exam_at: isoAt(addDays(now, 8), 10), weight: "2", content: "Comunicação verbal e não verbal.",
      kind: "trabalho", created_at: now.toISOString(), updated_at: now.toISOString(),
    },
  ];

  const schedules = subjects.flatMap((s, index) => [
    { id: uuid(), user_id: id, subject_id: s.id, weekday: index % 5, start_time: "08:00", end_time: "09:00", room: s.room, created_at: now.toISOString() },
    { id: uuid(), user_id: id, subject_id: s.id, weekday: (index + 2) % 5, start_time: "10:00", end_time: "11:00", room: s.room, created_at: now.toISOString() },
  ]);

  const grades = [
    { id: uuid(), user_id: id, subject_id: subjects[0]!.id, exam_id: null, title: "Atividade 1", score: 8.2, max_score: 10, weight: 1, term: "2026.2", graded_on: dateKey(addDays(now, -12)), created_at: now.toISOString() },
    { id: uuid(), user_id: id, subject_id: subjects[1]!.id, exam_id: null, title: "Lista", score: 6.3, max_score: 10, weight: 1, term: "2026.2", graded_on: dateKey(addDays(now, -8)), created_at: now.toISOString() },
    { id: uuid(), user_id: id, subject_id: subjects[2]!.id, exam_id: null, title: "Seminário", score: 8.7, max_score: 10, weight: 1, term: "2026.2", graded_on: dateKey(addDays(now, -6)), created_at: now.toISOString() },
    { id: uuid(), user_id: id, subject_id: subjects[3]!.id, exam_id: null, title: "Prática", score: 7.8, max_score: 10, weight: 1, term: "2026.2", graded_on: dateKey(addDays(now, -4)), created_at: now.toISOString() },
  ];

  const attendance = subjects.flatMap((s, idx) => [0,1,2].map((n) => ({
    id: uuid(), user_id: id, subject_id: s.id, class_date: dateKey(addDays(now, -(n + idx + 1))),
    status: n === 2 && idx === 1 ? "falta" : "presente", note: null, created_at: now.toISOString(),
  })));

  const plan = [0,1,2,3,4].map((i) => ({
    id: uuid(), user_id: id, subject_id: subjects[i % subjects.length]!.id, topic_id: topics[i]!.id,
    exam_id: i < 2 ? exams[0]!.id : null, task_id: i === 2 ? tasks[0]!.id : null,
    session_date: dateKey(addDays(now, i)), start_time: `${pad(15 + (i % 3))}:00`,
    duration_minutes: i === 1 ? 60 : 45, kind: "estudo", reason: i === 0 ? "Prioridade do dia" : "Plano de demonstração",
    priority: i < 2 ? 1 : 2, status: i === 0 ? "planejada" : "planejada", generated: true,
    created_at: now.toISOString(), updated_at: now.toISOString(),
  }));

  const reviews = [topics[1]!, topics[3]!].map((t, i) => ({
    id: uuid(), user_id: id, topic_id: t.id, due_on: dateKey(addDays(now, i)), reason: "Revisão sugerida pelo nível de domínio",
    source: "automatica", status: "pendente", completed_at: null, created_at: now.toISOString(),
  }));

  const goals = [
    { id: uuid(), user_id: id, subject_id: subjects[1]!.id, title: "Chegar a 7,0 em Matemática", metric: "media", target: 7, period: "semanal", active: true, created_at: now.toISOString(), updated_at: now.toISOString() },
    { id: uuid(), user_id: id, subject_id: null, title: "Estudar 8h por semana", metric: "horas_estudo", target: 8, period: "semanal", active: true, created_at: now.toISOString(), updated_at: now.toISOString() },
  ];

  const events = exams.map((e) => ({
    id: uuid(), user_id: id, subject_id: e.subject_id, title: e.title, starts_at: e.exam_at, ends_at: null,
    location: subjects.find((s) => s.id === e.subject_id)?.room ?? null, kind: "prova", source: "ordys", external_id: null, created_at: now.toISOString(),
  }));

  const focus = [
    { id: uuid(), user_id: id, subject_id: subjects[0]!.id, topic_id: topics[0]!.id, planned_minutes: 45, actual_minutes: 42, started_at: isoAt(addDays(now, -1), 16), ended_at: isoAt(addDays(now, -1), 16, 42), status: "concluida", plan_session_id: plan[0]!.id, created_at: now.toISOString() },
    { id: uuid(), user_id: id, subject_id: subjects[1]!.id, topic_id: topics[2]!.id, planned_minutes: 25, actual_minutes: 25, started_at: isoAt(addDays(now, -3), 17), ended_at: isoAt(addDays(now, -3), 17, 25), status: "concluida", plan_session_id: null, created_at: now.toISOString() },
  ];

  const notifications = [
    { id: uuid(), user_id: id, category: "estudos", title: "Você tem uma sessão de foco hoje", body: "Confira o plano e comece quando estiver pronto.", link: "/estudos", dedupe_key: "guest-focus", read_at: null, dismissed_at: null, created_at: now.toISOString() },
    { id: uuid(), user_id: id, category: "tarefas", title: "Há uma tarefa atrasada", body: tasks[2]!.title, link: "/tarefas", dedupe_key: "guest-task", read_at: null, dismissed_at: null, created_at: now.toISOString() },
  ];

  const checkins = [1,2].map((n) => ({
    id: uuid(), user_id: id, checkin_date: dateKey(addDays(now, -n)), completed_plan: n === 1 ? "sim" : "parcial",
    focus_rating: n === 1 ? 4 : 3, studied_minutes: n === 1 ? 65 : 40, hardest_subject_id: subjects[1]!.id,
    pending_note: null, created_at: now.toISOString(),
  }));

  return {
    id,
    created_at: now.toISOString(),
    profile: {
      id, full_name: "Visitante ORDYS", stage: "medio", timezone: "America/Sao_Paulo",
      grade_scale_max: 10, grade_pass: 6, attendance_target: 75,
      weekly_study_target_minutes: 480, daily_load_limit_minutes: 240, created_at: now.toISOString(), updated_at: now.toISOString(),
    },
    tables: {
      subjects, subject_schedules: schedules, topics, tasks, subtasks: [], exams, grades, attendance_records: attendance,
      focus_sessions: focus, plan_sessions: plan, reviews, goals, notifications, calendar_events: events,
      daily_checkins: checkins, quiz_attempts: [], quiz_answers: [], calendar_connections: [],
      notification_preferences: [{ user_id: id, enabled: true, exams: true, tasks: true, overdue: true, classes: true, study_sessions: true, goals: true, daily_summary: true, weekly_summary: true, monthly_summary: false, quiet_start: "22:00", quiet_end: "07:00", updated_at: now.toISOString() }],
    },
  };
}

const readState = (): GuestState | null => {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STATE_KEY);
    return raw ? (JSON.parse(raw) as GuestState) : null;
  } catch {
    return null;
  }
};

export const isGuestMode = () => typeof window !== "undefined" && localStorage.getItem(ACTIVE_KEY) === "1";

export const getGuestId = () => readState()?.id ?? null;

const ensureState = () => {
  const existing = readState();
  if (existing) return existing;
  const next = buildDefaultState();
  localStorage.setItem(STATE_KEY, JSON.stringify(next));
  return next;
};

const notify = () => {
  if (typeof window !== "undefined") window.dispatchEvent(new Event("ordys:guest-change"));
};

export const startGuestMode = () => {
  ensureState();
  localStorage.setItem(ACTIVE_KEY, "1");
  notify();
};

export const stopGuestMode = () => {
  localStorage.removeItem(ACTIVE_KEY);
  notify();
};

export const resetGuestMode = () => {
  localStorage.removeItem(STATE_KEY);
  ensureState();
  localStorage.setItem(ACTIVE_KEY, "1");
  notify();
};

export function readGuestRows<T = GuestRow>(table: GuestTable): T[] {
  return (readState()?.tables[table] ?? []) as T[];
}

export function readGuestProfile<T = GuestRow>(): T | null {
  return (readState()?.profile ?? null) as T | null;
}

const writeState = (state: GuestState) => {
  localStorage.setItem(STATE_KEY, JSON.stringify(state));
  notify();
};

export function insertGuestRow<T extends GuestRow>(table: GuestTable, values: T): T {
  const state = ensureState();
  const now = new Date().toISOString();
  const row = { id: values.id ?? uuid(), user_id: state.id, created_at: now, updated_at: now, ...values } as T;
  state.tables[table] = [...state.tables[table], row];
  writeState(state);
  return row;
}

export function updateGuestRow<T extends GuestRow>(table: GuestTable, id: string, values: Partial<T>): T {
  const state = ensureState();
  const index = state.tables[table].findIndex((row) => row.id === id);
  if (index < 0) throw new Error("Registro não encontrado");
  const current = state.tables[table][index]!;
  const row = { ...current, ...values, updated_at: new Date().toISOString() } as T;
  state.tables[table][index] = row;
  writeState(state);
  return row;
}

export function removeGuestRow(table: GuestTable, id: string) {
  const state = ensureState();
  state.tables[table] = state.tables[table].filter((row) => row.id !== id);
  writeState(state);
}

export function upsertGuestProfile(values: GuestRow) {
  const state = ensureState();
  state.profile = { ...state.profile, ...values, id: state.id, updated_at: new Date().toISOString() };
  writeState(state);
  return state.profile;
}

export function upsertGuestNotificationPrefs(values: GuestRow) {
  const state = ensureState();
  const current = state.tables.notification_preferences[0] ?? { user_id: state.id };
  state.tables.notification_preferences = [{ ...current, ...values, user_id: state.id, updated_at: new Date().toISOString() }];
  writeState(state);
  return state.tables.notification_preferences[0]!;
}
