import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";

export type Subject = Tables<"subjects">;
export type Topic = Tables<"topics">;
export type Task = Tables<"tasks">;
export type Subtask = Tables<"subtasks">;
export type Exam = Tables<"exams">;
export type Grade = Tables<"grades">;
export type AttendanceRecord = Tables<"attendance_records">;
export type FocusSession = Tables<"focus_sessions">;
export type PlanSession = Tables<"plan_sessions">;
export type Review = Tables<"reviews">;
export type Goal = Tables<"goals">;
export type Profile = Tables<"profiles">;
export type NotificationRow = Tables<"notifications">;
export type NotificationPrefs = Tables<"notification_preferences">;
export type SubjectSchedule = Tables<"subject_schedules">;
export type CalendarEvent = Tables<"calendar_events">;
export type DailyCheckin = Tables<"daily_checkins">;
export type QuizAttempt = Tables<"quiz_attempts">;
export type QuizAnswer = Tables<"quiz_answers">;

type Result<T> = { data: T | null; error: { message: string } | null };

export function unwrap<T>(res: Result<T>): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export const TOPIC_STATUS = [
  { key: "nao_estudado", label: "Não estudado" },
  { key: "estudando", label: "Estudando" },
  { key: "estudado", label: "Estudado" },
  { key: "precisa_revisar", label: "Precisa revisar" },
  { key: "dominado", label: "Dominado" },
] as const;

export const SUBJECT_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--gold)",
];

/* ------------------------------------------------------------------ reads */

function useOwnedQuery<T>(key: unknown[], run: () => PromiseLike<Result<T>>) {
  const { userId, loading } = useAuth();
  return useQuery({
    queryKey: [...key, userId],
    enabled: !loading && !!userId,
    queryFn: async () => unwrap<T>(await run()),
  });
}

export function useProfile() {
  const { userId } = useAuth();
  return useOwnedQuery<Profile | null>(["profile"], () =>
    supabase.from("profiles").select("*").eq("id", userId!).maybeSingle(),
  );
}

export function useSubjects(includeArchived = false) {
  return useOwnedQuery<Subject[]>(["subjects", includeArchived], () => {
    const q = supabase.from("subjects").select("*").order("name");
    return includeArchived ? q : q.eq("archived", false);
  });
}

export function useSchedules() {
  return useOwnedQuery<SubjectSchedule[]>(["schedules"], () =>
    supabase.from("subject_schedules").select("*").order("start_time"),
  );
}

export function useTopics(subjectId?: string | null) {
  return useOwnedQuery<Topic[]>(["topics", subjectId ?? "all"], () => {
    const q = supabase.from("topics").select("*").order("position").order("created_at");
    return subjectId ? q.eq("subject_id", subjectId) : q;
  });
}

export function useTasks() {
  return useOwnedQuery<Task[]>(["tasks"], () =>
    supabase.from("tasks").select("*").order("due_at", { nullsFirst: false }),
  );
}

export function useSubtasks() {
  return useOwnedQuery<Subtask[]>(["subtasks"], () =>
    supabase.from("subtasks").select("*").order("created_at"),
  );
}

export function useExams() {
  return useOwnedQuery<Exam[]>(["exams"], () =>
    supabase.from("exams").select("*").order("exam_at"),
  );
}

export function useGrades() {
  return useOwnedQuery<Grade[]>(["grades"], () =>
    supabase.from("grades").select("*").order("graded_on"),
  );
}

export function useAttendance() {
  return useOwnedQuery<AttendanceRecord[]>(["attendance"], () =>
    supabase.from("attendance_records").select("*").order("class_date"),
  );
}

export function useFocusSessions() {
  return useOwnedQuery<FocusSession[]>(["focus"], () =>
    supabase.from("focus_sessions").select("*").order("started_at", { ascending: false }),
  );
}

export function usePlanSessions() {
  return useOwnedQuery<PlanSession[]>(["plan"], () =>
    supabase.from("plan_sessions").select("*").order("session_date").order("start_time"),
  );
}

export function useReviews() {
  return useOwnedQuery<Review[]>(["reviews"], () =>
    supabase.from("reviews").select("*").order("due_on"),
  );
}

export function useGoals() {
  return useOwnedQuery<Goal[]>(["goals"], () =>
    supabase.from("goals").select("*").order("created_at"),
  );
}

export function useNotifications() {
  return useOwnedQuery<NotificationRow[]>(["notifications"], () =>
    supabase
      .from("notifications")
      .select("*")
      .is("dismissed_at", null)
      .order("created_at", { ascending: false })
      .limit(60),
  );
}

export function useNotificationPrefs() {
  const { userId } = useAuth();
  return useOwnedQuery<NotificationPrefs | null>(["notif-prefs"], () =>
    supabase.from("notification_preferences").select("*").eq("user_id", userId!).maybeSingle(),
  );
}

export function useCalendarEvents() {
  return useOwnedQuery<CalendarEvent[]>(["events"], () =>
    supabase.from("calendar_events").select("*").order("starts_at"),
  );
}

export function useCheckins() {
  return useOwnedQuery<DailyCheckin[]>(["checkins"], () =>
    supabase.from("daily_checkins").select("*").order("checkin_date", { ascending: false }),
  );
}

export function useQuizAttempts() {
  return useOwnedQuery<QuizAttempt[]>(["quiz-attempts"], () =>
    supabase.from("quiz_attempts").select("*").order("created_at", { ascending: false }),
  );
}

export function useQuizAnswers() {
  return useOwnedQuery<QuizAnswer[]>(["quiz-answers"], () =>
    supabase.from("quiz_answers").select("*").order("created_at", { ascending: false }),
  );
}

export function useCalendarConnections() {
  return useOwnedQuery<Tables<"calendar_connections">[]>(["calendar-connections"], () =>
    supabase.from("calendar_connections").select("*").order("provider"),
  );
}

/* ------------------------------------------------------------- mutations */

type TableName =
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
  | "daily_checkins";

export function useOrdysMutations() {
  const client = useQueryClient();
  const { userId } = useAuth();
  const refresh = () => client.invalidateQueries();

  /* eslint-disable @typescript-eslint/no-explicit-any */
  const anyDb = () => supabase as any;

  async function insert(table: TableName, values: Record<string, unknown>) {
    if (!userId) throw new Error("Sem sessão");
    const res = await anyDb()
      .from(table)
      .insert({ ...values, user_id: userId })
      .select()
      .single();
    const row = unwrap(res);
    refresh();
    return row;
  }

  async function update(table: TableName, id: string, values: Record<string, unknown>) {
    const res = await anyDb().from(table).update(values).eq("id", id).select().single();
    const row = unwrap(res);
    refresh();
    return row;
  }

  async function remove(table: TableName, id: string) {
    const { error } = await anyDb().from(table).delete().eq("id", id);
    if (error) throw new Error(error.message);
    refresh();
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */


  async function upsertProfile(values: TablesUpdate<"profiles">) {
    if (!userId) throw new Error("Sem sessão");
    const res = await supabase
      .from("profiles")
      .upsert({ ...values, id: userId } as TablesInsert<"profiles">)
      .select()
      .single();
    const row = unwrap(res);
    refresh();
    return row;
  }

  async function upsertNotificationPrefs(values: TablesUpdate<"notification_preferences">) {
    if (!userId) throw new Error("Sem sessão");
    const res = await supabase
      .from("notification_preferences")
      .upsert({ ...values, user_id: userId } as TablesInsert<"notification_preferences">)
      .select()
      .single();
    const row = unwrap(res);
    refresh();
    return row;
  }

  return { insert, update, remove, upsertProfile, upsertNotificationPrefs, refresh, userId };
}

export function useAsyncAction<TArgs extends unknown[]>(fn: (...args: TArgs) => Promise<unknown>) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (args: TArgs) => fn(...args),
    onSuccess: () => client.invalidateQueries(),
  });
}

/* ---------------------------------------------------------------- derived */

export function subjectAverage(grades: Grade[], subjectId: string, scaleMax = 10) {
  const rows = grades.filter((g) => g.subject_id === subjectId);
  if (!rows.length) return null;
  const totalWeight = rows.reduce((acc, g) => acc + Number(g.weight || 1), 0);
  const sum = rows.reduce(
    (acc, g) => acc + (Number(g.score) / Number(g.max_score || scaleMax)) * scaleMax * Number(g.weight || 1),
    0,
  );
  return totalWeight ? sum / totalWeight : null;
}

export function subjectAttendance(records: AttendanceRecord[], subjectId: string) {
  const rows = records.filter((r) => r.subject_id === subjectId);
  if (!rows.length) return null;
  const present = rows.filter((r) => r.status === "presente" || r.status === "justificada").length;
  return (present / rows.length) * 100;
}

export const fmtNumber = (n: number, digits = 1) =>
  n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export const minutesLabel = (minutes: number) => {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return h ? `${h}h${m ? String(m).padStart(2, "0") : ""}` : `${m}min`;
};
