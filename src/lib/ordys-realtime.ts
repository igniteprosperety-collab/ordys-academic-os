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

export function matchesOrdysRealtimeQueryKey(
  queryKey: readonly unknown[],
  userId: string,
  tableName: string,
): boolean {
  const definition = ORDYS_REALTIME_TABLES.find((item) => item.table === tableName);
  if (!definition || queryKey.length < 3) return false;

  const matchesResource = definition.queryKeys.some(([prefix]) => queryKey[0] === prefix);
  return (
    matchesResource &&
    queryKey[queryKey.length - 2] === userId &&
    queryKey[queryKey.length - 1] === "cloud"
  );
}

export function invalidateOrdysRealtimeTable(
  queryClient: QueryClient,
  userId: string,
  tableName: string,
): boolean {
  const definition = ORDYS_REALTIME_TABLES.find((item) => item.table === tableName);
  if (!definition) return false;

  void queryClient.invalidateQueries({
    predicate: (query) => matchesOrdysRealtimeQueryKey(query.queryKey, userId, tableName),
  });
  return true;
}

/** Match only cloud queries owned by this student across every ORDYS data area. */
export function matchesOrdysRealtimeOwnerQueryKey(
  queryKey: readonly unknown[],
  userId: string,
): boolean {
  return ORDYS_REALTIME_TABLES.some(({ table }) =>
    matchesOrdysRealtimeQueryKey(queryKey, userId, table),
  );
}

/**
 * A profile revision bump is the safe DELETE signal: Postgres Changes does not
 * apply RLS to DELETE payloads, so never subscribe to unfiltered row deletions.
 */
export function invalidateOrdysRealtimeOwnerQueries(
  queryClient: QueryClient,
  userId: string,
): boolean {
  if (!userId) return false;
  void queryClient.invalidateQueries({
    predicate: (query) => matchesOrdysRealtimeOwnerQueryKey(query.queryKey, userId),
  });
  return true;
}

export function subscribeToOrdysRealtime(queryClient: QueryClient, userId: string) {
  if (!userId) return () => undefined;

  let channel = supabase.channel(`ordys-student-data:${userId}`);
  for (const definition of ORDYS_REALTIME_TABLES) {
    const filter = `${definition.ownerColumn}=eq.${userId}`;
    const invalidate = () => {
      if (definition.table === "profiles") {
        // Student DELETE triggers bump this owner's profile revision. The filtered
        // UPDATE invalidates all owned resources without leaking DELETE payloads.
        invalidateOrdysRealtimeOwnerQueries(queryClient, userId);
        return;
      }
      invalidateOrdysRealtimeTable(queryClient, userId, definition.table);
    };

    // INSERT/UPDATE stay owner-filtered. DELETE events are never subscribed to:
    // the database emits a filtered profiles UPDATE instead.
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

  let subscribedAtLeastOnce = false;
  channel.subscribe((status, error) => {
    if (status === "SUBSCRIBED") {
      if (subscribedAtLeastOnce) {
        // Refresh owner-scoped data after a socket recovery to cover changes
        // that happened while the app was offline or suspended.
        invalidateOrdysRealtimeOwnerQueries(queryClient, userId);
      }
      subscribedAtLeastOnce = true;
      return;
    }

    if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      console.error("[realtime] student data channel unavailable", {
        userId,
        status,
        error,
      });
    }
  });
  return () => {
    void supabase.removeChannel(channel);
  };
}
