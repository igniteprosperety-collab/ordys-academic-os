import type { QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export const ORDYS_REALTIME_TABLES = [
  { table: "profiles", ownerColumn: "id", queryKeys: [["profile"]] },
  { table: "subjects", ownerColumn: "user_id", queryKeys: [["subjects"]] },
  { table: "subject_schedules", ownerColumn: "user_id", queryKeys: [["schedules"]] },
  { table: "topics", ownerColumn: "user_id", queryKeys: [["topics"]] },
  { table: "tasks", ownerColumn: "user_id", queryKeys: [["tasks"]] },
  { table: "subtasks", ownerColumn: "user_id", queryKeys: [["subtasks"]] },
  { table: "exams", ownerColumn: "user_id", queryKeys: [["exams"]] },
  { table: "grades", ownerColumn: "user_id", queryKeys: [["grades"]] },
  { table: "attendance_records", ownerColumn: "user_id", queryKeys: [["attendance"]] },
  { table: "focus_sessions", ownerColumn: "user_id", queryKeys: [["focus"]] },
  { table: "plan_sessions", ownerColumn: "user_id", queryKeys: [["plan"]] },
  { table: "reviews", ownerColumn: "user_id", queryKeys: [["reviews"]] },
  { table: "goals", ownerColumn: "user_id", queryKeys: [["goals"]] },
  { table: "notifications", ownerColumn: "user_id", queryKeys: [["notifications"]] },
  {
    table: "notification_preferences",
    ownerColumn: "user_id",
    queryKeys: [["notif-prefs"]],
  },
  { table: "calendar_events", ownerColumn: "user_id", queryKeys: [["events"]] },
  {
    table: "calendar_connections",
    ownerColumn: "user_id",
    queryKeys: [["calendar-connections"]],
  },
  { table: "daily_checkins", ownerColumn: "user_id", queryKeys: [["checkins"]] },
  { table: "quiz_attempts", ownerColumn: "user_id", queryKeys: [["quiz-attempts"]] },
  { table: "quiz_answers", ownerColumn: "user_id", queryKeys: [["quiz-answers"]] },
] as const;

export function invalidateOrdysRealtimeTable(
  queryClient: QueryClient,
  userId: string,
  tableName: string,
): boolean {
  const definition = ORDYS_REALTIME_TABLES.find((item) => item.table === tableName);
  if (!definition) return false;

  for (const key of definition.queryKeys) {
    void queryClient.invalidateQueries({
      queryKey: [...key, userId, "cloud"],
      exact: false,
    });
  }
  return true;
}

export function subscribeToOrdysRealtime(queryClient: QueryClient, userId: string) {
  if (!userId) return () => undefined;

  let channel = supabase.channel(`ordys-student-data:${userId}`);
  for (const definition of ORDYS_REALTIME_TABLES) {
    const filter = `${definition.ownerColumn}=eq.${userId}`;
    const invalidate = () => {
      invalidateOrdysRealtimeTable(queryClient, userId, definition.table);
    };

    // INSERT/UPDATE are filtered by the authenticated owner. DELETE is deliberately
    // excluded because Postgres Changes cannot safely filter it without replica identity FULL.
    channel = channel
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: definition.table,
          filter,
        },
        invalidate,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: definition.table,
          filter,
        },
        invalidate,
      );
  }

  channel.subscribe();
  return () => {
    void supabase.removeChannel(channel);
  };
}
