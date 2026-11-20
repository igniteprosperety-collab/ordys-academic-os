import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/use-auth";
import {
  useAttendance,
  useExams,
  useFocusSessions,
  useGrades,
  useNotificationPrefs,
  usePlanSessions,
  useProfile,
  useSubjects,
  useTasks,
  useTopics,
} from "@/lib/ordys-db";
import { syncNotifications } from "@/lib/ordys-engine";

export function NotificationSyncBridge() {
  const { userId } = useAuth();
  const profileQuery = useProfile();
  const subjectsQuery = useSubjects();
  const topicsQuery = useTopics();
  const tasksQuery = useTasks();
  const examsQuery = useExams();
  const planQuery = usePlanSessions();
  const gradesQuery = useGrades();
  const attendanceQuery = useAttendance();
  const focusQuery = useFocusSessions();
  const prefsQuery = useNotificationPrefs();
  const lastSyncedSignature = useRef<string | null>(null);
  const syncInProgress = useRef(false);

  const readyQueries = [
    profileQuery,
    subjectsQuery,
    topicsQuery,
    tasksQuery,
    examsQuery,
    planQuery,
    gradesQuery,
    attendanceQuery,
    focusQuery,
    prefsQuery,
  ];
  const ready =
    readyQueries.every((query) => !query.isLoading && !query.isError) && !!userId;

  const profile = profileQuery.data ?? null;
  const subjects = subjectsQuery.data ?? [];
  const topics = topicsQuery.data ?? [];
  const tasks = tasksQuery.data ?? [];
  const exams = examsQuery.data ?? [];
  const plan = planQuery.data ?? [];
  const grades = gradesQuery.data ?? [];
  const attendance = attendanceQuery.data ?? [];
  const focus = focusQuery.data ?? [];
  const prefs = prefsQuery.data ?? null;

  const signature = JSON.stringify([
    userId,
    profile?.id ?? null,
    profile?.grade_scale_max ?? null,
    profile?.attendance_target ?? null,
    prefs
      ? [
          prefs.enabled,
          prefs.exams,
          prefs.tasks,
          prefs.overdue,
          prefs.classes,
          prefs.study_sessions,
          prefs.goals,
          prefs.daily_summary,
          prefs.weekly_summary,
          prefs.monthly_summary,
        ]
      : null,
    subjects.map((item) => [item.id, item.name, item.archived, item.grade_goal, item.attendance_goal]),
    topics.map((item) => [item.id, item.status, item.mastery, item.last_review]),
    tasks.map((item) => [item.id, item.status, item.due_at, item.completed_at]),
    exams.map((item) => [item.id, item.exam_at, item.subject_id, item.content]),
    plan.map((item) => [item.id, item.status, item.session_date, item.start_time]),
    grades.map((item) => [item.id, item.score, item.max_score, item.weight, item.graded_on]),
    attendance.map((item) => [item.id, item.status, item.class_date, item.subject_id]),
    focus.map((item) => [item.id, item.status, item.started_at, item.actual_minutes]),
  ]);

  useEffect(() => {
    if (
      !ready ||
      !userId ||
      lastSyncedSignature.current === signature ||
      syncInProgress.current
    ) {
      return;
    }

    syncInProgress.current = true;
    void syncNotifications({
      userId,
      subjects,
      topics,
      tasks,
      exams,
      plan,
      grades,
      attendance,
      focus,
      profile,
      prefs,
    })
      .then(() => {
        lastSyncedSignature.current = signature;
      })
      .catch((error) => {
        console.error("[notifications] automatic sync failed", error);
      })
      .finally(() => {
        syncInProgress.current = false;
      });
  }, [
    attendance,
    exams,
    focus,
    grades,
    plan,
    prefs,
    profile,
    ready,
    signature,
    subjects,
    tasks,
    topics,
    userId,
  ]);

  return null;
}
