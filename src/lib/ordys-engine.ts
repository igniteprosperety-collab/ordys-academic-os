import { supabase } from "@/integrations/supabase/client";
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

/* ------------------------------------------------------------- date utils */

export const dateKey = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

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
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const base = new Date(target);
  base.setHours(0, 0, 0, 0);
  return Math.round((base.getTime() - today.getTime()) / 86400000);
};

export const weekdayShort = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

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

  for (const exam of exams) {
    const left = daysUntil(exam.exam_at);
    if (left === null || left < 0 || left > 14) continue;
    const subject = subjects.find((s) => s.id === exam.subject_id);
    const related = topics.filter((t) => t.subject_id === exam.subject_id);
    const weak = related.filter((t) => WEAK_STATUS.has(t.status) || t.mastery < 70);
    const pool = weak.length ? weak : related.slice(0, 2);
    const urgency = left <= 3 ? 1 : left <= 7 ? 2 : 3;
    if (!pool.length) {
      out.push({
        subject_id: exam.subject_id,
        topic_id: null,
        exam_id: exam.id,
        task_id: null,
        duration_minutes: 45,
        kind: "estudo",
        reason: `${subject?.name ?? "Prova"} — prova em ${left} dia(s)`,
        priority: urgency,
        latest: dateKey(new Date(exam.exam_at)),
      });
      continue;
    }
    for (const topic of pool.slice(0, left <= 3 ? 4 : 3)) {
      out.push({
        subject_id: exam.subject_id,
        topic_id: topic.id,
        exam_id: exam.id,
        task_id: null,
        duration_minutes: topic.mastery < 40 ? 60 : 45,
        kind: "estudo",
        reason: `Prova de ${subject?.name ?? "disciplina"} em ${left} dia(s) · domínio ${topic.mastery}% em ${topic.title}`,
        priority: urgency,
        latest: dateKey(new Date(exam.exam_at)),
      });
    }
  }

  for (const task of tasks) {
    if (task.status === "concluida") continue;
    const left = daysUntil(task.due_at);
    if (left === null || left > 7) continue;
    out.push({
      subject_id: task.subject_id,
      topic_id: task.topic_id,
      exam_id: null,
      task_id: task.id,
      duration_minutes: task.estimated_minutes ?? 45,
      kind: "tarefa",
      reason:
        left < 0
          ? `Tarefa atrasada: ${task.title}`
          : `Tarefa "${task.title}" vence em ${left} dia(s)`,
      priority: left <= 1 ? 1 : 2,
      latest: task.due_at ? dateKey(new Date(task.due_at)) : null,
    });
  }

  for (const review of reviews) {
    if (review.status !== "pendente") continue;
    const topic = topics.find((t) => t.id === review.topic_id);
    if (!topic) continue;
    out.push({
      subject_id: topic.subject_id,
      topic_id: topic.id,
      exam_id: null,
      task_id: null,
      duration_minutes: 30,
      kind: "revisao",
      reason: review.reason ?? `Revisão de ${topic.title}`,
      priority: 2,
      latest: review.due_on,
    });
  }

  for (const subject of subjects) {
    const avg = subjectAverage(grades, subject.id, scale);
    const goal = subject.grade_goal ? Number(subject.grade_goal) : null;
    if (avg !== null && goal !== null && avg < goal) {
      const weak = topics
        .filter((t) => t.subject_id === subject.id && (WEAK_STATUS.has(t.status) || t.mastery < 60))
        .slice(0, 1);
      out.push({
        subject_id: subject.id,
        topic_id: weak[0]?.id ?? null,
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
  const days = input.days ?? 7;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const rangeStart = dateKey(today);
  const rangeEnd = dateKey(addDays(today, days - 1));
  const dailyLimit = input.profile?.daily_load_limit_minutes ?? 240;

  // limpa apenas o que foi gerado automaticamente e ainda não foi feito
  await supabase
    .from("plan_sessions")
    .delete()
    .eq("generated", true)
    .eq("status", "planejada")
    .gte("session_date", rangeStart)
    .lte("session_date", rangeEnd);

  const manual = input.existing.filter(
    (s) => (!s.generated || s.status !== "planejada") && s.session_date >= rangeStart && s.session_date <= rangeEnd,
  );

  const load = new Map<string, number>();
  for (let i = 0; i < days; i++) load.set(dateKey(addDays(today, i)), 0);
  for (const s of manual) load.set(s.session_date, (load.get(s.session_date) ?? 0) + s.duration_minutes);

  const candidates = buildCandidates(input);
  const rows: Record<string, unknown>[] = [];

  for (const candidate of candidates) {
    const limitKey = candidate.latest;
    for (let i = 0; i < days; i++) {
      const key = dateKey(addDays(today, i));
      if (limitKey && key > limitKey) break;
      const used = load.get(key) ?? 0;
      if (used + candidate.duration_minutes > dailyLimit) continue;
      const slotIndex = Math.floor(used / 60);
      const hour = Math.min(21, 15 + slotIndex);
      load.set(key, used + candidate.duration_minutes);
      rows.push({
        user_id: input.userId,
        subject_id: candidate.subject_id,
        topic_id: candidate.topic_id,
        exam_id: candidate.exam_id,
        task_id: candidate.task_id,
        session_date: key,
        start_time: `${String(hour).padStart(2, "0")}:00`,
        duration_minutes: candidate.duration_minutes,
        kind: candidate.kind,
        reason: candidate.reason,
        priority: candidate.priority,
        status: "planejada",
        generated: true,
      });
      break;
    }
  }

  if (rows.length) {
    const { error } = await supabase.from("plan_sessions").insert(rows as never);
    if (error) throw new Error(error.message);
  }
  return rows.length;
}

/** Marca sessões passadas não realizadas como perdidas e reorganiza o restante. */
export async function replanMissed(input: PlanInput) {
  const todayKey = dateKey(new Date());
  const missed = input.existing.filter((s) => s.status === "planejada" && s.session_date < todayKey);
  if (missed.length) {
    const { error } = await supabase
      .from("plan_sessions")
      .update({ status: "perdida" })
      .in(
        "id",
        missed.map((s) => s.id),
      );
    if (error) throw new Error(error.message);
  }
  const refreshed = await supabase.from("plan_sessions").select("*");
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
  const pending = new Set(reviews.filter((r) => r.status === "pendente").map((r) => r.topic_id));
  const rows: Record<string, unknown>[] = [];
  const today = new Date();

  for (const topic of topics) {
    if (pending.has(topic.id)) continue;
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
    rows.push({
      user_id: userId,
      topic_id: topic.id,
      due_on: dateKey(due < today ? today : due),
      source: "automatica",
      reason: exam
        ? `Prova próxima e domínio de ${topic.mastery}% em ${topic.title}`
        : `Domínio baixo (${topic.mastery}%) em ${topic.title}`,
    });
  }

  if (rows.length) {
    const { error } = await supabase.from("reviews").insert(rows as never);
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
  profile: Profile | null;
  prefs: {
    enabled: boolean;
    exams: boolean;
    tasks: boolean;
    overdue: boolean;
    study_sessions: boolean;
    goals: boolean;
  } | null;
};

export function buildNotificationRules(input: NotifyInput) {
  const { subjects, topics, tasks, exams, plan, grades, attendance, profile, prefs } = input;
  const rows: { category: string; title: string; body: string; link: string; dedupe_key: string }[] = [];
  if (prefs && !prefs.enabled) return rows;
  const scale = Number(profile?.grade_scale_max ?? 10);
  const subjectName = (id: string | null) => subjects.find((s) => s.id === id)?.name ?? "Disciplina";

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

  if (!prefs || prefs.tasks) {
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
      } else if (left === 0 || left === 1) {
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
  }

  if (!prefs || prefs.study_sessions) {
    const todayKey = dateKey(new Date());
    const missed = plan.filter((s) => s.status === "perdida" && s.session_date === dateKey(addDays(new Date(), -1)));
    if (missed.length) {
      rows.push({
        category: "estudos",
        title: "Plano de estudos reorganizado",
        body: `Você não realizou ${missed.length} sessão(ões) de ontem. O plano foi redistribuído.`,
        link: "/estudos",
        dedupe_key: `replan:${todayKey}`,
      });
    }
    const todaySessions = plan.filter((s) => s.session_date === todayKey && s.status === "planejada");
    if (todaySessions.length) {
      rows.push({
        category: "estudos",
        title: `${todaySessions.length} sessão(ões) de estudo hoje`,
        body: todaySessions[0]!.reason ?? "Sessões planejadas para hoje.",
        link: "/estudos",
        dedupe_key: `plan-today:${todayKey}`,
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
  const { error } = await supabase
    .from("notifications")
    .upsert(rows as never, { onConflict: "user_id,dedupe_key", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
  return rows.length;
}

/* ------------------------------------------------------------- resumos */

export function summarize(range: { from: Date; to: Date }, data: {
  focus: FocusSession[];
  tasks: Task[];
  plan: PlanSession[];
  grades: Grade[];
  attendance: AttendanceRecord[];
}) {
  const inRange = (iso: string | null) => {
    if (!iso) return false;
    const d = new Date(iso);
    return d >= range.from && d <= range.to;
  };
  const focus = data.focus.filter((f) => f.status === "concluida" && inRange(f.started_at));
  const minutes = focus.reduce((acc, f) => acc + (f.actual_minutes ?? f.planned_minutes), 0);
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

  return {
    minutes,
    focusCount: focus.length,
    tasksDone: done.length,
    tasksPending: pending.length,
    tasksLate: late.length,
    grades,
    gradeAverage: grades.length
      ? grades.reduce((acc, g) => acc + (Number(g.score) / Number(g.max_score || 10)) * 10, 0) / grades.length
      : null,
    attendanceRate: attendance.length
      ? (attendance.filter((a) => a.status === "presente" || a.status === "justificada").length /
          attendance.length) *
        100
      : null,
    plannedCount: planned.length,
    completedPlanCount: completedPlan.length,
  };
}
