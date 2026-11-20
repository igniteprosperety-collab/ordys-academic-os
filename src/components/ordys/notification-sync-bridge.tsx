import { useEffect, useRef, useState } from "react";

import { useAuth } from "@/hooks/use-auth";
import {
  useAttendance,
  useCalendarEvents,
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
import { dateKey, syncNotifications } from "@/lib/ordys-engine";
import {
  isNativeAndroid,
  syncNativeAcademicNotifications,
} from "@/lib/native-notifications";

const EMPTY_ROWS: never[] = [];

function notificationClockBucket() {
  const now = new Date();
  const timeWindow =
    now.getHours() >= 20 ? "after20" : now.getHours() >= 19 ? "after19" : "before19";
  return `${dateKey(now)}:${timeWindow}`;
}

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
  const eventsQuery = useCalendarEvents();
  const focusQuery = useFocusSessions();
  const prefsQuery = useNotificationPrefs();
  const lastSyncedSignature = useRef<string | null>(null);
  const syncInProgress = useRef(false);
  const [clockBucket, setClockBucket] = useState(notificationClockBucket);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = notificationClockBucket();
      setClockBucket((current) => (current === next ? current : next));
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const readyQueries = [
    profileQuery,
    subjectsQuery,
    topicsQuery,
    tasksQuery,
    examsQuery,
    planQuery,
    gradesQuery,
    attendanceQuery,
    eventsQuery,
    focusQuery,
    prefsQuery,
  ];
  const ready = readyQueries.every((query) => !query.isLoading && !query.isError) && !!userId;

  const profile = profileQuery.data ?? null;
  const subjects = subjectsQuery.data ?? EMPTY_ROWS;
  const topics = topicsQuery.data ?? EMPTY_ROWS;
  const tasks = tasksQuery.data ?? EMPTY_ROWS;
  const exams = examsQuery.data ?? EMPTY_ROWS;
  const plan = planQuery.data ?? EMPTY_ROWS;
  const grades = gradesQuery.data ?? EMPTY_ROWS;
  const attendance = attendanceQuery.data ?? EMPTY_ROWS;
  const events = eventsQuery.data ?? EMPTY_ROWS;
  const focus = focusQuery.data ?? EMPTY_ROWS;
  const prefs = prefsQuery.data ?? null;

  const signature = JSON.stringify([
    userId,
    clockBucket,
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
    subjects.map((item) => [
      item.id,
      item.name,
      item.archived,
      item.grade_goal,
      item.attendance_goal,
    ]),
    topics.map((item) => [item.id, item.status, item.mastery, item.last_review]),
    tasks.map((item) => [item.id, item.status, item.due_at, item.completed_at]),
    exams.map((item) => [item.id, item.exam_at, item.subject_id, item.content]),
    plan.map((item) => [item.id, item.status, item.session_date, item.start_time]),
    grades.map((item) => [item.id, item.score, item.max_score, item.weight, item.graded_on]),
    attendance.map((item) => [item.id, item.status, item.class_date, item.subject_id]),
    events.map((item) => [item.id, item.title, item.starts_at, item.ends_at, item.location]),
    focus.map((item) => [item.id, item.status, item.started_at, item.actual_minutes]),
  ]);

  useEffect(() => {
    if (!ready || !userId || lastSyncedSignature.current === signature || syncInProgress.current) {
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
      events,
      focus,
      profile,
      prefs,
    })
      .then(() => {
        lastSyncedSignature.current = signature;
        if (isNativeAndroid()) {
          void syncNativeAcademicNotifications().catch((error) => {
            console.error("[notifications] Android schedule refresh failed", error);
          });
        }
      })
      .catch((error) => {
        console.error("[notifications] automatic sync failed", error);
      })
      .finally(() => {
        syncInProgress.current = false;
      });
  }, [
    attendance,
    events,
    exams,
    focus,
    grades,
    plan,
    prefs,
    profile,
    ready,
    signature,
    clockBucket,
    subjects,
    tasks,
    topics,
    userId,
  ]);

  return null;
}
