import { supabase } from "@/integrations/supabase/client";
import { getOrdysDataClient } from "@/lib/demo-supabase";
import { getActiveLocalProfileId, isDemoMode } from "@/lib/demo-mode";
import type {
  AttendanceRecord,
  Exam,
  FocusSession,
  Grade,
  PlanSession,
  Profile,
  Review,
  Subject,
  Task,
  Topic,
} from "./ordys-db";
import { subjectAttendance, subjectAverage } from "./ordys-db";

function dataClient() {
  return isDemoMode() ? getOrdysDataClient() : supabase;
}


/* ------------------------------------------------------------- date utils */

export const dateKey = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

export function parseTimeOfDay(value: string | null | undefined) {
  if (!value) return null;
  const [hourText, minuteText] = value.slice(0, 5).split(":");
  if (hourText === undefined || minuteText === undefined) return null;
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { hour, minute };
}

export const parseDateKey = (key: string) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
};

export const addDays = (d: Date, days: number) => {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
};

export const startOfWeek = (d: Date) => {
  const next = new Date(d);
  const day = (next.getDay() + 6) % 7; // monday = 0
  next.setDate(next.getDate() - day);
  next.setHours(0, 0, 0, 0);
  return next;
};

export const daysUntil = (iso: string | null) => {
  if (!iso) return null;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const base = new Date(target);
  base.setHours(0, 0, 0, 0);
  return Math.round((base.getTime() - today.getTime()) / 86400000);
};

export const weekdayShort = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

/** Converte o índice ORDYS (segunda=0 ... domingo=6) para o índice de Date.getDay(). */
export const ordysWeekdayToJsDay = (weekday: number) => (weekday + 1) % 7;

export const weekdayLong = [
  "Segunda-feira",
  "Terça-feira",
  "Quarta-feira",
  "Quinta-feira",
  "Sexta-feira",
  "Sábado",
  "Domingo",
];

export const priorityLabel = (value: string | null) =>
  value === "alta" ? "Alta" : value === "baixa" ? "Baixa" : "Média";

export const difficultyLabel = (value: string | null) =>
  value === "facil" ? "Fácil" : value === "dificil" ? "Difícil" : "Média";

export const taskStatusLabel = (value: string | null) =>
  value === "nao_iniciada" ? "Não iniciada" :
  value === "pendente" ? "Pendente" :
  value === "em_andamento" ? "Em andamento" :
  value === "concluida" ? "Concluída" :
  value === "atrasada" ? "Atrasada" : "Status não informado";

export const planStatusLabel = (value: string | null) =>
  value === "planejada" ? "Planejada" :
  value === "em_andamento" ? "Em andamento" :
  value === "concluida" ? "Concluída" :
  value === "perdida" ? "Perdida" :
  value === "cancelada" ? "Cancelada" : "Status não informado";

export const reviewStatusLabel = (value: string | null) =>
  value === "pendente" ? "Pendente" :
  value === "concluida" ? "Concluída" :
  value === "cancelada" ? "Cancelada" : "Status não informado";

export const topicStatusLabel = (value: string | null) =>
  value === "nao_estudado" ? "Não estudado" :
  value === "estudando" ? "Estudando" :
  value === "estudado" ? "Estudado" :
  value === "precisa_revisar" ? "Precisa revisar" :
  value === "dominado" ? "Dominado" : "Status não informado";

export const attendanceStatusLabel = (value: string | null) =>
  value === "presente" ? "Presente" :
  value === "falta" ? "Falta" :
  value === "justificada" ? "Justificada" : "Status não informado";

export const goalMetricLabel = (value: string | null) =>
  value === "horas_estudo" ? "horas de estudo" :
  value === "media" || value === "media_disciplina" ? "média" :
  value === "frequencia" ? "frequência" :
  value === "tarefas" ? "tarefas" : "métrica não informada";

export const goalPeriodLabel = (value: string | null) =>
  value === "diario" ? "diário" :
  value === "semanal" || value === "semana" ? "semanal" :
  value === "mensal" ? "mensal" :
  value === "bimestral" ? "bimestral" :
  value === "semestral" ? "semestral" : "período não informado";

export const formatDateTime = (iso: string | null) =>
  iso
    ? new Date(iso).toLocaleString("pt-BR", {
        day: "2-digit",
        month: "short",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "sem data";

export const formatDay = (iso: string) =>
  new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

/* ------------------------------------------------------- plan generation */

type PlanInput = {
  userId: string;
  profile: Profile | null;
  subjects: Subject[];
  topics: Topic[];
  tasks: Task[];
  exams: Exam[];
  grades: Grade[];
  reviews: Review[];
  existing: PlanSession[];
  schedules?: import("./ordys-db").SubjectSchedule[];
  calendarEvents?: import("./ordys-db").CalendarEvent[];
  days?: number;
};

type Candidate = {
  subject_id: string | null;
  topic_id: string | null;
  exam_id: string | null;
  task_id: string | null;
  duration_minutes: number;
  kind: "estudo" | "revisao" | "tarefa" | "simulado";
  reason: string;
  priority: number;
  latest: string | null; // deadline date key
};

const WEAK_STATUS = new Set(["nao_estudado", "estudando", "precisa_revisar"]);

export function buildCandidates(input: PlanInput): Candidate[] {
  const { subjects, topics, tasks, exams, grades, reviews, profile } = input;
  const scale = Number(profile?.grade_scale_max ?? 10);
  const out: Candidate[] = [];
  const seen = new Set<string>();

  const push = (candidate: Candidate) => {
    const key = [
      candidate.kind,
      candidate.subject_id ?? "",
      candidate.topic_id ?? "",
      candidate.exam_id ?? "",
      candidate.task_id ?? "",
    ].join(":");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(candidate);
  };

  for (const exam of exams) {
    const left = daysUntil(exam.exam_at);
    if (left === null || left < 0 || left > 14) continue;

    const subject = subjects.find((s) => s.id === exam.subject_id);
    const related = topics
      .filter((t) => t.subject_id === exam.subject_id)
      .sort((a, b) => a.mastery - b.mastery);
    const weak = related.filter((t) => WEAK_STATUS.has(t.status) || t.mastery < 70);
    const pool = (weak.length ? weak : related).slice(0, left <= 3 ? 4 : 3);
    const urgency = left <= 3 ? 1 : left <= 7 ? 2 : 3;

    if (!pool.length) {
      push({
        subject_id: exam.subject_id,
        topic_id: null,
        exam_id: exam.id,
        task_id: null,
        duration_minutes: 45,
        kind: exam.kind === "simulado" ? "simulado" : "estudo",
        reason: `${subject?.name ?? "Disciplina"} — avaliação em ${left === 0 ? "hoje" : left === 1 ? "1 dia" : `${left} dias`}`,
        priority: urgency,
        latest: dateKey(new Date(exam.exam_at)),
      });
      continue;
    }

    for (const topic of pool) {
      push({
        subject_id: exam.subject_id,
        topic_id: topic.id,
        exam_id: exam.id,
        task_id: null,
        duration_minutes: topic.mastery < 40 ? 60 : 45,
        kind: "estudo",
        reason: `Prova de ${subject?.name ?? "disciplina"} em ${left === 0 ? "hoje" : left === 1 ? "1 dia" : `${left} dias`} · domínio ${topic.mastery}% em ${topic.title}`,
        priority: urgency,
        latest: dateKey(new Date(exam.exam_at)),
      });
    }
  }

  for (const task of tasks) {
    if (task.status === "concluida") continue;
    const left = daysUntil(task.due_at);
    if (left === null || left > 7) continue;

    const overdue = left < 0;
    push({
      subject_id: task.subject_id,
      topic_id: task.topic_id,
      exam_id: null,
      task_id: task.id,
      duration_minutes: Math.min(240, Math.max(5, task.estimated_minutes ?? 45)),
      kind: "tarefa",
      reason: overdue
        ? `Tarefa atrasada: ${task.title}`
        : `Tarefa "${task.title}" vence ${left === 0 ? "hoje" : left === 1 ? "amanhã" : `em ${left} dias`}`,
      priority: overdue ? 0 : left <= 1 ? 1 : 2,
      latest: overdue ? dateKey(new Date()) : task.due_at ? dateKey(new Date(task.due_at)) : null,
    });
  }

  for (const review of reviews) {
    if (review.status !== "pendente") continue;
    const topic = topics.find((t) => t.id === review.topic_id);
    if (!topic) continue;

    push({
      subject_id: topic.subject_id,
      topic_id: topic.id,
      exam_id: null,
      task_id: null,
      duration_minutes: 30,
      kind: "revisao",
      reason: review.reason ?? `Revisão de ${topic.title}`,
      priority: review.due_on <= dateKey(new Date()) ? 1 : 2,
      latest: review.due_on < dateKey(new Date()) ? dateKey(new Date()) : review.due_on,
    });
  }

  for (const subject of subjects) {
    const avg = subjectAverage(grades, subject.id, scale);
    const goal = subject.grade_goal ? Number(subject.grade_goal) : null;
    if (avg !== null && goal !== null && avg < goal) {
      const weak = topics
        .filter((t) => t.subject_id === subject.id && (WEAK_STATUS.has(t.status) || t.mastery < 60))
        .sort((a, b) => a.mastery - b.mastery)[0];

      push({
        subject_id: subject.id,
        topic_id: weak?.id ?? null,
        exam_id: null,
        task_id: null,
        duration_minutes: 45,
        kind: "estudo",
        reason: `Média ${avg.toFixed(1)} abaixo da meta ${goal} em ${subject.name}`,
        priority: 3,
        latest: null,
      });
    }
  }

  return out.sort((a, b) => a.priority - b.priority);
}

export async function generateWeeklyPlan(input: PlanInput) {
  const days = Math.max(1, Math.min(14, input.days ?? 7));
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rangeStart = dateKey(today);
  const rangeEnd = dateKey(addDays(today, days - 1));
  const dailyLimit = Math.max(0, Math.min(1440, Number(input.profile?.daily_load_limit_minutes ?? 240)));

  const { error: clearError } = await dataClient()
    .from("plan_sessions")
    .delete()
    .eq("user_id", input.userId)
    .eq("generated", true)
    .eq("status", "planejada")
    .gte("session_date", rangeStart)
    .lte("session_date", rangeEnd);
  if (clearError) throw new Error(clearError.message);

  const manual = input.existing.filter(
    (s) => (!s.generated || s.status !== "planejada") && s.session_date >= rangeStart && s.session_date <= rangeEnd,
  );

  const toMinutes = (value: string | null | undefined) => {
    const parsed = parseTimeOfDay(value);
    return parsed ? parsed.hour * 60 + parsed.minute : null;
  };

  const occupied = new Map<string, Array<{ start: number; end: number }>>();
  const addOccupied = (day: string, start: number, end: number) => {
    if (end <= start) return;
    const list = occupied.get(day) ?? [];
    list.push({ start, end });
    occupied.set(day, list);
  };

  const weekdayIndex = (d: Date) => (d.getDay() + 6) % 7; // Monday = 0

  for (const session of manual) {
    const start = toMinutes(session.start_time);
    if (start === null) continue;
    addOccupied(session.session_date, start, start + Math.max(5, session.duration_minutes));
  }

  for (let i = 0; i < days; i++) {
    const day = addDays(today, i);
    const key = dateKey(day);
    for (const schedule of input.schedules ?? []) {
      if (schedule.weekday !== weekdayIndex(day)) continue;
      const start = toMinutes(schedule.start_time);
      const end = toMinutes(schedule.end_time);
      if (start !== null && end !== null) addOccupied(key, start, end);
    }

    const dayStart = new Date(day);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = addDays(dayStart, 1);

    for (const event of input.calendarEvents ?? []) {
      const startDate = new Date(event.starts_at);
      if (Number.isNaN(startDate.getTime())) continue;

      const requestedEnd = event.ends_at ? new Date(event.ends_at) : null;
      const endDate =
        requestedEnd && !Number.isNaN(requestedEnd.getTime()) && requestedEnd > startDate
          ? requestedEnd
          : new Date(startDate.getTime() + 60 * 60 * 1000);

      const overlapStart = startDate > dayStart ? startDate : dayStart;
      const overlapEnd = endDate < dayEnd ? endDate : dayEnd;
      if (overlapEnd <= overlapStart) continue;

      const start =
        overlapStart <= dayStart
          ? 0
          : overlapStart.getHours() * 60 + overlapStart.getMinutes();
      const end =
        overlapEnd >= dayEnd
          ? 24 * 60
          : overlapEnd.getHours() * 60 + overlapEnd.getMinutes();
      if (end > start) addOccupied(key, start, end);
    }
  }

  const load = new Map<string, number>();
  for (let i = 0; i < days; i++) load.set(dateKey(addDays(today, i)), 0);
  for (const s of manual) load.set(s.session_date, (load.get(s.session_date) ?? 0) + Math.max(0, s.duration_minutes));

  const candidates = buildCandidates(input);
  const rows: Record<string, unknown>[] = [];

  const fits = (day: string, start: number, duration: number) => {
    const end = start + duration;
    if (start < 6 * 60 || end > 22 * 60) return false;
    if ((load.get(day) ?? 0) + duration > dailyLimit) return false;
    return !(occupied.get(day) ?? []).some((block) => start < block.end && end > block.start);
  };

  const orderedStarts = (duration: number) => {
    const preferred = 15 * 60;
    const min = 6 * 60;
    const max = 22 * 60 - duration;
    const starts: number[] = [];
    for (let start = min; start <= max; start += 15) starts.push(start);
    return starts.sort((a, b) => Math.abs(a - preferred) - Math.abs(b - preferred));
  };

  for (const candidate of candidates) {
    let placed = false;
    const duration = Math.min(candidate.duration_minutes, dailyLimit);
    if (duration < 5) continue;
    for (let i = 0; i < days && !placed; i++) {
      const day = addDays(today, i);
      const key = dateKey(day);
      if (candidate.latest && key > candidate.latest) break;

      for (const start of orderedStarts(duration)) {
        if (!fits(key, start, duration)) continue;

        const end = start + duration;
        addOccupied(key, start, end);
        load.set(key, (load.get(key) ?? 0) + duration);
        rows.push({
          user_id: input.userId,
          subject_id: candidate.subject_id,
          topic_id: candidate.topic_id,
          exam_id: candidate.exam_id,
          task_id: candidate.task_id,
          session_date: key,
          start_time: `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`,
          duration_minutes: duration,
          kind: candidate.kind,
          reason: candidate.reason,
          priority: candidate.priority,
          status: "planejada",
          generated: true,
        });
        placed = true;
        break;
      }
    }
  }

  if (rows.length) {
    const { error } = await dataClient().from("plan_sessions").insert(rows as never);
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

/** Marca sessões passadas não realizadas como perdidas e reorganiza o restante. */
export async function replanMissed(input: PlanInput) {
  const todayKey = dateKey(new Date());
  const missed = input.existing.filter((s) => s.status === "planejada" && s.session_date < todayKey);
  if (missed.length) {
    const { error } = await dataClient()
      .from("plan_sessions")
      .update({ status: "perdida" })
      .in(
        "id",
        missed.map((s) => s.id),
      )
      .eq("user_id", input.userId);
    if (error) throw new Error(error.message);
  }
  const refreshed = await dataClient()
    .from("plan_sessions")
    .select("*")
    .eq("user_id", input.userId);
  const existing = (refreshed.data ?? []) as PlanSession[];
  const created = await generateWeeklyPlan({ ...input, existing });
  return { missed: missed.length, created };
}

/* ------------------------------------------------------------- revisões */

export async function ensureAutomaticReviews(params: {
  userId: string;
  topics: Topic[];
  exams: Exam[];
  reviews: Review[];
}) {
  const { userId, topics, exams, reviews } = params;

  // Automatic review generation can run after the user switches local profiles.
  // Never write data for the previous profile into the newly active local store.
  if (isDemoMode() && getActiveLocalProfileId() !== userId) return 0;
  const pending = new Set(reviews.filter((r) => r.status === "pendente").map((r) => r.topic_id));
  const existingAutomatic = new Set(
    reviews
      .filter((r) => r.source === "automatico")
      .map((r) => `${r.topic_id}:${r.due_on}`),
  );
  const rows: Record<string, unknown>[] = [];
  const today = new Date();
  const todayKey = dateKey(today);

  for (const topic of topics) {
    if (pending.has(topic.id)) continue;
    if (topic.last_review === todayKey) continue;
    const exam = exams
      .filter((e) => e.subject_id === topic.subject_id)
      .map((e) => ({ e, left: daysUntil(e.exam_at) }))
      .filter((x) => x.left !== null && x.left >= 0 && x.left <= 10)
      .sort((a, b) => (a.left ?? 0) - (b.left ?? 0))[0];

    const needsReview =
      topic.status === "precisa_revisar" ||
      topic.mastery < 50 ||
      (!!exam && topic.mastery < 80) ||
      (!topic.last_review && topic.status !== "nao_estudado");

    if (!needsReview) continue;
    const due = exam ? addDays(new Date(exam.e.exam_at), -1) : addDays(today, topic.mastery < 40 ? 1 : 3);
    const dueOn = dateKey(due < today ? today : due);
    if (existingAutomatic.has(`${topic.id}:${dueOn}`)) continue;
    rows.push({
      user_id: userId,
      topic_id: topic.id,
      due_on: dueOn,
      source: "automatico",
      reason: exam
        ? `Prova próxima e domínio de ${topic.mastery}% em ${topic.title}`
        : `Domínio baixo (${topic.mastery}%) em ${topic.title}`,
    });
  }

  if (rows.length) {
    const { error } = await dataClient().from("reviews").insert(rows as never);
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

/* --------------------------------------------------------- notificações */

type NotifyInput = {
  userId: string;
  subjects: Subject[];
  topics: Topic[];
  tasks: Task[];
  exams: Exam[];
  plan: PlanSession[];
  grades: Grade[];
  attendance: AttendanceRecord[];
  focus?: FocusSession[];
  profile: Profile | null;
  prefs: {
    enabled: boolean;
    exams: boolean;
    tasks: boolean;
    overdue: boolean;
    classes?: boolean;
    study_sessions: boolean;
    goals: boolean;
    daily_summary: boolean;
    weekly_summary: boolean;
    monthly_summary: boolean;
  } | null;
};

export function buildNotificationRules(input: NotifyInput) {
  const { subjects, topics, tasks, exams, plan, grades, attendance, focus = [], profile, prefs } = input;
  const rows: { category: string; title: string; body: string; link: string; dedupe_key: string }[] = [];
  if (prefs && !prefs.enabled) return rows;
  const scale = Number(profile?.grade_scale_max ?? 10);
  const subjectName = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? "Disciplina";
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const nextDay = addDays(dayStart, 1);
  const inRange = (value: string | null, from: Date, to: Date) => {
    if (!value) return false;
    const date = new Date(value);
    return !Number.isNaN(date.getTime()) && date >= from && date < to;
  };
  const minutesFor = (from: Date, to: Date) =>
    focus
      .filter((item) => item.status === "concluida" && inRange(item.started_at, from, to))
      .reduce((sum, item) => sum + (item.actual_minutes ?? item.planned_minutes), 0);
  const tasksDoneFor = (from: Date, to: Date) =>
    tasks.filter((item) => item.status === "concluida" && inRange(item.completed_at, from, to)).length;
  const planDoneFor = (from: Date, to: Date) =>
    plan.filter((item) => item.status === "concluida" && inRange(`${item.session_date}T12:00:00`, from, to)).length;

  if (!prefs || prefs.exams) {
    for (const exam of exams) {
      const left = daysUntil(exam.exam_at);
      if (left === null || left < 0 || left > 3) continue;
      const weak = topics
        .filter((t) => t.subject_id === exam.subject_id && (WEAK_STATUS.has(t.status) || t.mastery < 60))
        .slice(0, 1)[0];
      const when = left === 0 ? "é hoje" : left === 1 ? "é amanhã" : `em ${left} dias`;
      rows.push({
        category: "agenda",
        title: `${subjectName(exam.subject_id)} — prova ${when}`,
        body: weak
          ? `Você ainda não domina ${weak.title} (${weak.mastery}%).`
          : (exam.content ?? "Revise os conteúdos da avaliação."),
        link: "/agenda",
        dedupe_key: `exam:${exam.id}:${left}`,
      });
    }
  }

  for (const task of tasks) {
    if (task.status === "concluida") continue;
    const left = daysUntil(task.due_at);
    if (left === null) continue;

    if (left < 0 && (!prefs || prefs.overdue)) {
      rows.push({
        category: "tarefas",
        title: `${subjectName(task.subject_id)} — tarefa atrasada`,
        body: `${task.title} venceu há ${Math.abs(left)} dia(s).`,
        link: "/tarefas",
        dedupe_key: `task-late:${task.id}:${dateKey(new Date())}`,
      });
    }

    if ((left === 0 || left === 1) && (!prefs || prefs.tasks)) {
      rows.push({
        category: "tarefas",
        title: `${subjectName(task.subject_id)} — tarefa vence ${left === 0 ? "hoje" : "amanhã"}`,
        body: task.estimated_minutes
          ? `Essa tarefa está estimada em ${task.estimated_minutes} minutos.`
          : task.title,
        link: "/tarefas",
        dedupe_key: `task:${task.id}:${left}`,
      });
    }
  }
  if (!prefs || prefs.study_sessions) {
    const todayKey = dateKey(new Date());
    const missed = plan.filter((s) => s.status === "perdida" && s.session_date === dateKey(addDays(new Date(), -1)));
    if (missed.length) {
      rows.push({
        category: "estudos",
        title: "Plano de estudos reorganizado",
        body: `Você não realizou ${missed.length} ${missed.length === 1 ? "sessão" : "sessões"} de ontem. O plano foi redistribuído.`,
        link: "/estudos",
        dedupe_key: `replan:${todayKey}`,
      });
    }
    const todaySessions = plan.filter((s) => s.session_date === todayKey && s.status === "planejada");
    if (todaySessions.length) {
      rows.push({
        category: "estudos",
        title: `${todaySessions.length} ${todaySessions.length === 1 ? "sessão" : "sessões"} de estudo hoje`,
        body: todaySessions[0]!.reason ?? "Sessões planejadas para hoje.",
        link: "/estudos",
        dedupe_key: `plan-today:${todayKey}`,
      });
    }
  }

  if (!prefs || prefs.daily_summary) {
    if (now.getHours() >= 20) {
      const minutes = minutesFor(dayStart, nextDay);
      const completedTasks = tasksDoneFor(dayStart, nextDay);
      const completedPlan = planDoneFor(dayStart, nextDay);
      rows.push({
        category: "resumos",
        title: "Resumo diário",
        body: `Hoje: ${minutes} min de estudo, ${completedTasks} tarefa(s) concluída(s) e ${completedPlan} sessão(ões) do plano concluída(s).`,
        link: "/desempenho",
        dedupe_key: `summary-day:${dateKey(dayStart)}`,
      });
    }
  }

  if (!prefs || prefs.weekly_summary) {
    if (now.getDay() === 0 && now.getHours() >= 19) {
      const from = startOfWeek(now);
      const to = addDays(from, 7);
      const minutes = minutesFor(from, to);
      const completedTasks = tasksDoneFor(from, to);
      const completedPlan = planDoneFor(from, to);
      rows.push({
        category: "resumos",
        title: "Resumo semanal",
        body: `Nesta semana: ${minutes} min de estudo, ${completedTasks} tarefa(s) concluída(s) e ${completedPlan} sessão(ões) do plano concluída(s).`,
        link: "/desempenho",
        dedupe_key: `summary-week:${dateKey(from)}`,
      });
    }
  }

  if (!prefs || prefs.monthly_summary) {
    const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 1);
    const lastDayOfMonth = new Date(monthEnd);
    lastDayOfMonth.setDate(lastDayOfMonth.getDate() - 1);
    if (dateKey(now) === dateKey(lastDayOfMonth) && now.getHours() >= 19) {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      const to = monthEnd;
      const minutes = minutesFor(from, to);
      const completedTasks = tasksDoneFor(from, to);
      const completedPlan = planDoneFor(from, to);
      rows.push({
        category: "resumos",
        title: "Resumo mensal",
        body: `Neste mês: ${minutes} min de estudo, ${completedTasks} tarefa(s) concluída(s) e ${completedPlan} sessão(ões) do plano concluída(s).`,
        link: "/desempenho",
        dedupe_key: `summary-month:${dateKey(from)}`,
      });
    }
  }

  if (!prefs || prefs.goals) {
    for (const subject of subjects) {
      const avg = subjectAverage(grades, subject.id, scale);
      if (avg !== null && subject.grade_goal && avg < Number(subject.grade_goal)) {
        rows.push({
          category: "desempenho",
          title: `${subject.name} — meta de nota não atingida`,
          body: `Média ${avg.toFixed(1)} de ${Number(subject.grade_goal)}.`,
          link: "/desempenho",
          dedupe_key: `goal-grade:${subject.id}:${dateKey(startOfWeek(new Date()))}`,
        });
      }
      const att = subjectAttendance(attendance, subject.id);
      const target = Number(subject.attendance_goal ?? profile?.attendance_target ?? 75);
      if (att !== null && att < target) {
        rows.push({
          category: "desempenho",
          title: `${subject.name} — frequência em ${att.toFixed(0)}%`,
          body: `Abaixo da meta de ${target}%.`,
          link: "/desempenho",
          dedupe_key: `att:${subject.id}:${dateKey(startOfWeek(new Date()))}`,
        });
      }
    }
  }

  return rows;
}

export async function syncNotifications(input: NotifyInput) {
  const rows = buildNotificationRules(input).map((r) => ({ ...r, user_id: input.userId }));
  if (!rows.length) return 0;
  const { error } = await dataClient()
    .from("notifications")
    .upsert(rows as never, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return rows.length;
}

/* ------------------------------------------------------------- resumos */

export function summarize(
  range: { from: Date; to: Date },
  data: {
    focus: FocusSession[];
    tasks: Task[];
    plan: PlanSession[];
    grades: Grade[];
    attendance: AttendanceRecord[];
  },
  gradeScaleMax = 10,
) {
  const inRange = (iso: string | null) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d >= range.from && d <= range.to;
  };
  const focus = data.focus.filter((f) => f.status === "concluida" && inRange(f.started_at));
  const minutes = focus.reduce((acc, f) => {
    const value = Number(f.actual_minutes ?? f.planned_minutes);
    return acc + (Number.isFinite(value) ? Math.max(0, value) : 0);
  }, 0);
  const done = data.tasks.filter((t) => t.status === "concluida" && inRange(t.completed_at));
  const late = data.tasks.filter(
    (t) => t.status !== "concluida" && t.due_at && new Date(t.due_at) < new Date(),
  );
  const pending = data.tasks.filter((t) => t.status !== "concluida");
  const grades = data.grades.filter((g) => inRange(`${g.graded_on}T12:00:00`));
  const attendance = data.attendance.filter((a) => inRange(`${a.class_date}T12:00:00`));
  const planned = data.plan.filter(
    (p) => p.session_date >= dateKey(range.from) && p.session_date <= dateKey(range.to),
  );
  const completedPlan = planned.filter((p) => p.status === "concluida");

  const validGrades = grades
    .map((grade) => ({
      grade,
      score: Number(grade.score),
      maxScore: Number(grade.max_score || gradeScaleMax),
      weight: Number(grade.weight || 1),
    }))
    .filter(
      (item) =>
        Number.isFinite(item.score) &&
        Number.isFinite(item.maxScore) &&
        item.maxScore > 0 &&
        Number.isFinite(item.weight) &&
        item.weight > 0,
    );
  const gradeWeight = validGrades.reduce((acc, item) => acc + item.weight, 0);
  const weightedGradeSum = validGrades.reduce(
    (acc, item) => acc + (item.score / item.maxScore) * gradeScaleMax * item.weight,
    0,
  );

  return {
    minutes,
    focusCount: focus.length,
    tasksDone: done.length,
    tasksPending: pending.length,
    tasksLate: late.length,
    grades,
    gradeAverage: gradeWeight > 0 ? weightedGradeSum / gradeWeight : null,
    attendanceRate: attendance.length
      ? (attendance.filter((a) => a.status === "presente" || a.status === "justificada").length /
          attendance.length) *
        100
      : null,
    plannedCount: planned.length,
    completedPlanCount: completedPlan.length,
  };
}
