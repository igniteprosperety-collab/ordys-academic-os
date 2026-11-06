import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { getOrdysDataClient } from "@/lib/demo-supabase";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/use-auth";
import { isDemoMode } from "@/lib/demo-mode";

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
  "var(--subject-graphite)",
  "var(--subject-slate)",
  "var(--subject-steel)",
  "var(--subject-blue)",
  "var(--subject-azure)",
  "var(--subject-cobalt)",
  "var(--subject-indigo)",
  "var(--subject-purple)",
  "var(--subject-violet)",
  "var(--subject-magenta)",
  "var(--subject-pink)",
  "var(--subject-rose)",
  "var(--subject-red)",
  "var(--subject-coral)",
  "var(--subject-orange)",
  "var(--subject-amber)",
  "var(--subject-gold)",
  "var(--subject-yellow)",
  "var(--subject-lime)",
  "var(--subject-green)",
  "var(--subject-emerald)",
  "var(--subject-teal)",
  "var(--subject-cyan)",
  "var(--subject-petrol)",
];

function dataClient() {
  return isDemoMode() ? getOrdysDataClient() : supabase;
}

function useOwnedQuery<T>(key: unknown[], run: (client: ReturnType<typeof dataClient>) => PromiseLike<Result<T>>) {
  const { userId, loading } = useAuth();
  return useQuery({
    queryKey: [...key, userId, isDemoMode() ? "demo" : "cloud"],
    enabled: !loading && !!userId,
    queryFn: async () => unwrap<T>(await run(dataClient())),
  });
}

export function useProfile() {
  const { userId } = useAuth();
  return useOwnedQuery<Profile | null>(["profile"], (db) => db.from("profiles").select("*").eq("id", userId!).maybeSingle());
}

export function useSubjects(includeArchived = false) {
  return useOwnedQuery<Subject[]>(["subjects", includeArchived], (db) => {
    const q = db.from("subjects").select("*").order("name");
    return includeArchived ? q : q.eq("archived", false);
  });
}

export function useSchedules() { return useOwnedQuery<SubjectSchedule[]>(["schedules"], (db) => db.from("subject_schedules").select("*").order("start_time")); }

export function useTopics(subjectId?: string | null) {
  return useOwnedQuery<Topic[]>(["topics", subjectId ?? "all"], (db) => {
    const q = db.from("topics").select("*").order("position").order("created_at");
    return subjectId ? q.eq("subject_id", subjectId) : q;
  });
}

export function useTasks() { return useOwnedQuery<Task[]>(["tasks"], (db) => db.from("tasks").select("*").order("due_at", { nullsFirst: false })); }
export function useSubtasks() { return useOwnedQuery<Subtask[]>(["subtasks"], (db) => db.from("subtasks").select("*").order("created_at")); }
export function useExams() { return useOwnedQuery<Exam[]>(["exams"], (db) => db.from("exams").select("*").order("exam_at")); }
export function useGrades() { return useOwnedQuery<Grade[]>(["grades"], (db) => db.from("grades").select("*").order("graded_on")); }
export function useAttendance() { return useOwnedQuery<AttendanceRecord[]>(["attendance"], (db) => db.from("attendance_records").select("*").order("class_date")); }
export function useFocusSessions() { return useOwnedQuery<FocusSession[]>(["focus"], (db) => db.from("focus_sessions").select("*").order("started_at", { ascending: false })); }
export function usePlanSessions() { return useOwnedQuery<PlanSession[]>(["plan"], (db) => db.from("plan_sessions").select("*").order("session_date").order("start_time")); }
export function useReviews() { return useOwnedQuery<Review[]>(["reviews"], (db) => db.from("reviews").select("*").order("due_on")); }
export function useGoals() { return useOwnedQuery<Goal[]>(["goals"], (db) => db.from("goals").select("*").order("created_at")); }
export function useNotifications() {
  return useOwnedQuery<NotificationRow[]>(["notifications"], (db) => db.from("notifications").select("*").is("dismissed_at", null).order("created_at", { ascending: false }).limit(60));
}
export function useNotificationPrefs() {
  const { userId } = useAuth();
  return useOwnedQuery<NotificationPrefs | null>(["notif-prefs"], (db) => db.from("notification_preferences").select("*").eq("user_id", userId!).maybeSingle());
}
export function useCalendarEvents() { return useOwnedQuery<CalendarEvent[]>(["events"], (db) => db.from("calendar_events").select("*").order("starts_at")); }
export function useCheckins() { return useOwnedQuery<DailyCheckin[]>(["checkins"], (db) => db.from("daily_checkins").select("*").order("checkin_date", { ascending: false })); }
export function useQuizAttempts() { return useOwnedQuery<QuizAttempt[]>(["quiz-attempts"], (db) => db.from("quiz_attempts").select("*").order("created_at", { ascending: false })); }
export function useQuizAnswers() { return useOwnedQuery<QuizAnswer[]>(["quiz-answers"], (db) => db.from("quiz_answers").select("*").order("created_at", { ascending: false })); }
export function useCalendarConnections() { return useOwnedQuery<Tables<"calendar_connections">[]>(["calendar-connections"], (db) => db.from("calendar_connections").select("*").order("provider")); }

type TableName = "subjects" | "subject_schedules" | "topics" | "tasks" | "subtasks" | "exams" | "grades" | "attendance_records" | "focus_sessions" | "plan_sessions" | "reviews" | "goals" | "notifications" | "calendar_events" | "calendar_connections" | "daily_checkins" | "quiz_attempts" | "quiz_answers";

export function useOrdysMutations() {
  const client = useQueryClient();
  const { userId } = useAuth();
  const refresh = () => client.invalidateQueries();
  type MutationResult = Result<unknown>;
  type MutationBuilder = PromiseLike<MutationResult> & {
    select(): MutationBuilder;
    single(): PromiseLike<MutationResult>;
    eq(column: string, value: unknown): MutationBuilder;
    insert(values: Record<string, unknown>): MutationBuilder;
    update(values: Record<string, unknown>): MutationBuilder;
    delete(): MutationBuilder;
    upsert(values: Record<string, unknown>, options?: { onConflict?: string }): MutationBuilder;
  };
  type MutationDbTableName = TableName | "profiles" | "notification_preferences";
  type MutationClient = { from(table: MutationDbTableName): MutationBuilder };
  const mutationDb = () => dataClient() as unknown as MutationClient;

  async function insert(table: TableName, values: Record<string, unknown>) {
    if (!userId) throw new Error("Sem sessão");
    const res = await mutationDb().from(table).insert({ ...values, user_id: userId }).select().single();
    const row = unwrap(res);
    refresh();
    return row;
  }

  async function update(table: TableName, id: string, values: Record<string, unknown>) {
    if (!userId) throw new Error("Sem sessão");
    const { user_id: _ignoredUserId, ...safeValues } = values;
    const res = await mutationDb()
      .from(table)
      .update(safeValues)
      .eq("id", id)
      .eq("user_id", userId)
      .select()
      .single();
    const row = unwrap(res);
    refresh();
    return row;
  }

  async function remove(table: TableName, id: string) {
    if (!userId) throw new Error("Sem sessão");
    const { error } = await mutationDb()
      .from(table)
      .delete()
      .eq("id", id)
      .eq("user_id", userId);
    if (error) throw new Error(error.message);
    refresh();
  }

  async function upsertProfile(values: TablesUpdate<"profiles">) {
    if (!userId) throw new Error("Sem sessão");
    const res = await mutationDb().from("profiles").upsert({ ...values, id: userId } as TablesInsert<"profiles">).select().single();
    const row = unwrap(res);
    refresh();
    return row;
  }

  async function upsertNotificationPrefs(values: TablesUpdate<"notification_preferences">) {
    if (!userId) throw new Error("Sem sessão");
    const res = await mutationDb()
      .from("notification_preferences")
      .upsert(
        { ...values, user_id: userId } as TablesInsert<"notification_preferences">,
        { onConflict: "user_id" },
      )
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
  return useMutation({ mutationFn: (args: TArgs) => fn(...args), onSuccess: () => client.invalidateQueries() });
}

export function subjectAverage(grades: Grade[], subjectId: string, scaleMax = 10) {
  const rows = grades
    .filter((g) => g.subject_id === subjectId)
    .map((grade) => ({
      score: Number(grade.score),
      maxScore: Number(grade.max_score || scaleMax),
      weight: Number(grade.weight || 1),
    }))
    .filter(
      (grade) =>
        Number.isFinite(grade.score) &&
        Number.isFinite(grade.maxScore) &&
        grade.maxScore > 0 &&
        Number.isFinite(grade.weight) &&
        grade.weight > 0,
    );
  if (!rows.length) return null;
  const totalWeight = rows.reduce((acc, grade) => acc + grade.weight, 0);
  const sum = rows.reduce(
    (acc, grade) => acc + (grade.score / grade.maxScore) * scaleMax * grade.weight,
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

export const fmtNumber = (n: number, digits = 1) => n.toLocaleString("pt-BR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const minutesLabel = (minutes: number) => { const h = Math.floor(minutes / 60); const m = Math.round(minutes % 60); return h ? `${h}h${m ? String(m).padStart(2, "0") : ""}` : `${m}min`; };
