import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { dateKey, ordysWeekdayToJsDay, parseTimeOfDay } from "@/lib/ordys-engine";

// Native reminders are enabled only in distribution profiles that explicitly opt in.
// The direct-install APK v1 disables this feature; Google Play keeps it available.
export const nativeNotificationsDisabled =
  import.meta.env["VITE_ORDYS_DISABLE_NATIVE_NOTIFICATIONS"] === "1";
const NATIVE_NOTIFICATIONS_DISABLED = nativeNotificationsDisabled;
type LocalNotificationsApi = typeof import("@capacitor/local-notifications").LocalNotifications;
let localNotifications: LocalNotificationsApi | null = null;

async function getLocalNotifications() {
  if (NATIVE_NOTIFICATIONS_DISABLED || !isNativeAndroid()) return null;
  if (!localNotifications) {
    localNotifications = (await import("@capacitor/local-notifications")).LocalNotifications;
  }
  return localNotifications;
}

export const isNativeAndroid = () => Capacitor.getPlatform() === "android";

const NOTIFICATION_IDS = { exam: 100000, task: 200000, study: 300000, class: 400000, summary: 500000 };
const NOTIFICATION_PREFIXES = Object.values(NOTIFICATION_IDS);

function stableId(prefix: number, value: string) {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = Math.imul(hash, 31) + value.charCodeAt(i);
  return prefix + ((hash >>> 0) % 90000);
}

function atLocalTime(date: Date, hour: number, minute: number) {
  const next = new Date(date);
  next.setHours(hour, minute, 0, 0);
  return next;
}

function nextOccurrenceDate(base: Date, weekday: number, time: string): Date | null {
  const parsed = parseTimeOfDay(time);
  if (
    !parsed ||
    !Number.isInteger(parsed.hour) ||
    !Number.isInteger(parsed.minute) ||
    parsed.hour < 0 ||
    parsed.hour > 23 ||
    parsed.minute < 0 ||
    parsed.minute > 59
  ) return null;
  const { hour, minute } = parsed;
  const date = new Date(base);
  // ORDYS stores weekdays as Monday=0 ... Sunday=6; JavaScript uses Sunday=0 ... Saturday=6.
  const targetJsDay = ordysWeekdayToJsDay(weekday);
  const delta = (targetJsDay - date.getDay() + 7) % 7;
  date.setDate(date.getDate() + delta);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function isWithinQuietHours(date: Date, start: string, end: string) {
  const current = date.getHours() * 60 + date.getMinutes();
  const startTime = parseTimeOfDay(start);
  const endTime = parseTimeOfDay(end);
  if (!startTime || !endTime) return false;
  const startMinutes = startTime.hour * 60 + startTime.minute;
  const endMinutes = endTime.hour * 60 + endTime.minute;
  if (startMinutes === endMinutes) return false;
  if (startMinutes < endMinutes) return current >= startMinutes && current < endMinutes;
  return current >= startMinutes || current < endMinutes;
}

export async function getNativeNotificationPermission() {
  if (NATIVE_NOTIFICATIONS_DISABLED || !isNativeAndroid()) return "denied" as const;
  const notifications = await getLocalNotifications();
  if (!notifications) return "denied" as const;
  const result = await notifications.checkPermissions();
  return result.display === "granted" ? "granted" : result.display === "denied" ? "denied" : "default";
}

export async function requestNativeNotificationPermission() {
  if (NATIVE_NOTIFICATIONS_DISABLED) return "denied" as const;
  if (!isNativeAndroid()) return "denied" as const;
  const notifications = await getLocalNotifications();
  if (!notifications) return "denied" as const;
  const result = await notifications.requestPermissions();
  return result.display === "granted" ? "granted" : result.display === "denied" ? "denied" : "default";
}

export async function ensureNativeNotificationChannel() {
  if (NATIVE_NOTIFICATIONS_DISABLED) return;
  if (!isNativeAndroid()) return;
  const notifications = await getLocalNotifications();
  if (!notifications) return;
  await notifications.createChannel({
    id: "ordys-general",
    name: "ORDYS",
    description: "Lembretes e avisos acadêmicos do ORDYS",
    importance: 5,
    visibility: 1,
    vibration: true,
    sound: "default",
  });
}

export async function scheduleNativeNotification(params: { id: number; title: string; body: string; at: Date }) {
  if (NATIVE_NOTIFICATIONS_DISABLED) return false;
  if (!isNativeAndroid() || !Number.isFinite(params.at.getTime()) || params.at.getTime() <= Date.now()) return false;
  await ensureNativeNotificationChannel();
  const notifications = await getLocalNotifications();
  if (!notifications) return false;
  const permission = await notifications.checkPermissions();
  if (permission.display !== "granted") return false;
  await notifications.schedule({
    notifications: [{
      id: params.id,
      title: params.title,
      body: params.body,
      // Exactness belongs to LocalNotificationSchema, not its Schedule.
      // Keep reminders inexact to avoid exact-alarm access on Android.
      isExactNotification: false,
      schedule: {
        at: params.at,
        allowWhileIdle: true,
      },
      channelId: "ordys-general",
    }],
  });
  return true;
}

export async function cancelNativeNotifications(ids: number[]) {
  if (NATIVE_NOTIFICATIONS_DISABLED) return;
  if (!isNativeAndroid() || !ids.length) return;
  const notifications = await getLocalNotifications();
  if (!notifications) return;
  await notifications.cancel({ notifications: ids.map((id) => ({ id })) });
}

type NativeNotificationPrefs = {
  enabled: boolean;
  exams: boolean;
  tasks: boolean;
  overdue: boolean;
  classes: boolean;
  study_sessions: boolean;
  goals: boolean;
  daily_summary: boolean;
  weekly_summary: boolean;
  monthly_summary: boolean;
  quiet_start?: string | null;
  quiet_end?: string | null;
};

export async function syncNativeAcademicNotifications() {
  if (NATIVE_NOTIFICATIONS_DISABLED) return;
  if (!isNativeAndroid()) return;
  const notificationsApi = await getLocalNotifications();
  if (!notificationsApi) return;
  const permission = await notificationsApi.checkPermissions();
  if (permission.display !== "granted") return;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return;

  const [prefsResult, examsResult, tasksResult, planResult, schedulesResult, focusResult, subjectsResult] =
    await Promise.all([
      supabase.from("notification_preferences").select("*").eq("user_id", userId).maybeSingle(),
      supabase.from("exams").select("id,subject_id,title,content,exam_at").eq("user_id", userId).order("exam_at").limit(30),
      supabase.from("tasks").select("id,subject_id,title,status,due_at,completed_at").eq("user_id", userId).order("due_at").limit(50),
      supabase.from("plan_sessions").select("id,subject_id,status,session_date,start_time,duration_minutes").eq("user_id", userId).gte("session_date", dateKey(new Date())).order("session_date").order("start_time").limit(120),
      supabase.from("subject_schedules").select("id,subject_id,weekday,start_time").eq("user_id", userId).order("weekday").order("start_time").limit(100),
      supabase.from("focus_sessions").select("id,status,started_at,actual_minutes,planned_minutes").eq("user_id", userId).eq("status", "concluida").order("started_at", { ascending: false }).limit(120),
      supabase.from("subjects").select("id,name").eq("user_id", userId),
    ]);

  const queryErrors = [
    prefsResult.error,
    examsResult.error,
    tasksResult.error,
    planResult.error,
    schedulesResult.error,
    focusResult.error,
    subjectsResult.error,
  ].filter(Boolean);

  // Never delete already scheduled reminders when a transient data query fails.
  if (queryErrors.length) {
    console.error("[notifications] sync aborted because a data query failed");
    return;
  }

  const prefs = (prefsResult.data ?? null) as NativeNotificationPrefs | null;
  const exams = examsResult.data;
  const tasks = tasksResult.data;
  const plan = planResult.data;
  const schedules = schedulesResult.data;
  const focus = focusResult.data;
  const subjects = subjectsResult.data;

  const prefixes = NOTIFICATION_PREFIXES;
  const pending = await notificationsApi.getPending();
  const scheduledIds = new Set<number>();

  if (prefs?.enabled === false) {
    await cancelNativeNotifications(
      pending.notifications
        .map((notification) => notification.id)
        .filter((id) => prefixes.some((prefix) => id >= prefix && id < prefix + 90000)),
    );
    return;
  }

  const subjectName = (id: string | null) => subjects?.find((s) => s.id === id)?.name ?? "Disciplina";
  const now = Date.now();
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + 14);
  const quietStart = prefs?.quiet_start ?? "22:00:00";
  const quietEnd = prefs?.quiet_end ?? "07:00:00";
  const nowDate = new Date();
  const dayStart = new Date(nowDate);
  dayStart.setHours(0, 0, 0, 0);
  const nextDay = new Date(dayStart);
  nextDay.setDate(nextDay.getDate() + 1);
  const startOfWeek = (date: Date) => {
    const value = new Date(date);
    value.setHours(0, 0, 0, 0);
    value.setDate(value.getDate() - ((value.getDay() + 6) % 7));
    return value;
  };
  const summarizeRange = (from: Date, to: Date) => {
    const studiedMinutes = (focus ?? [])
      .filter((item) => {
        const value = new Date(item.started_at).getTime();
        return value >= from.getTime() && value < to.getTime();
      })
      .reduce((sum, item) => sum + (item.actual_minutes ?? item.planned_minutes ?? 0), 0);
    const completedTasks = (tasks ?? []).filter((item) => {
      if (!item.completed_at) return false;
      const value = new Date(item.completed_at).getTime();
      return value >= from.getTime() && value < to.getTime();
    }).length;
    const completedPlan = (plan ?? []).filter((item) => {
      if (item.status !== "concluida") return false;
      const value = new Date(`${item.session_date}T12:00:00`).getTime();
      return value >= from.getTime() && value < to.getTime();
    }).length;
    return { studiedMinutes, completedTasks, completedPlan };
  };

  const notifications = [
    ...(prefs?.daily_summary === false ? [] : (() => {
      const at = new Date(dayStart);
      at.setHours(20, 0, 0, 0);
      if (at.getTime() <= now || at.getTime() > horizon.getTime() || isWithinQuietHours(at, quietStart, quietEnd)) return [];
      const summary = summarizeRange(dayStart, nextDay);
      return [{
        id: stableId(NOTIFICATION_IDS.summary, `summary-day:${dateKey(dayStart)}`),
        title: "Resumo diário",
        body: `Hoje: ${summary.studiedMinutes} min de estudo, ${summary.completedTasks} tarefa(s) concluída(s) e ${summary.completedPlan} sessão(ões) do plano concluída(s).`,
        at,
      }];
    })()),
    ...(prefs?.weekly_summary === false ? [] : (() => {
      const at = new Date(nowDate);
      const daysUntilSunday = (0 - at.getDay() + 7) % 7;
      at.setDate(at.getDate() + daysUntilSunday);
      at.setHours(19, 0, 0, 0);
      if (at.getTime() <= now) at.setDate(at.getDate() + 7);
      if (at.getTime() > horizon.getTime() || isWithinQuietHours(at, quietStart, quietEnd)) return [];
      const summaryWeekStart = startOfWeek(at);
      return [{
        id: stableId(NOTIFICATION_IDS.summary, `summary-week:${dateKey(summaryWeekStart)}`),
        title: "Resumo semanal",
        body: "Seu resumo semanal está disponível. Abra o ORDYS para conferir seu progresso atualizado.",
        at,
      }];
    })()),
    ...(prefs?.monthly_summary === false ? [] : (() => {
      let at = new Date(nowDate.getFullYear(), nowDate.getMonth() + 1, 0);
      at.setHours(19, 0, 0, 0);
      if (at.getTime() <= now) {
        at = new Date(nowDate.getFullYear(), nowDate.getMonth() + 2, 0);
        at.setHours(19, 0, 0, 0);
      }
      if (at.getTime() > horizon.getTime() || isWithinQuietHours(at, quietStart, quietEnd)) return [];
      const summaryMonthStart = new Date(at.getFullYear(), at.getMonth(), 1);
      return [{
        id: stableId(NOTIFICATION_IDS.summary, `summary-month:${dateKey(summaryMonthStart)}`),
        title: "Resumo mensal",
        body: "Seu resumo mensal está disponível. Abra o ORDYS para conferir seu progresso atualizado.",
        at,
      }];
    })()),
    ...(prefs?.exams === false ? [] : (exams ?? []).flatMap((exam) => {
      const examDate = new Date(exam.exam_at);
      if (!Number.isFinite(examDate.getTime())) return [];
      const reminderDays = [
        { days: 3, label: "em 3 dias" },
        { days: 1, label: "amanhã" },
        { days: 0, label: "hoje" },
      ];
      return reminderDays.flatMap(({ days, label }) => {
        const reminder = new Date(examDate);
        if (days === 0) {
          // Same-day reminder: one hour before the evaluation, rather than a
          // fixed 09:00 that could land after an early-morning exam.
          reminder.setTime(examDate.getTime() - 60 * 60 * 1000);
        } else {
          reminder.setDate(reminder.getDate() - days);
          reminder.setHours(9, 0, 0, 0);
        }
        if (reminder.getTime() <= now || reminder.getTime() >= examDate.getTime() || isWithinQuietHours(reminder, quietStart, quietEnd)) return [];
        return [{
          id: stableId(NOTIFICATION_IDS.exam, `${exam.id}:${days}d`),
          title: `${subjectName(exam.subject_id)} — avaliação ${label}`,
          body: exam.content ?? `Programe sua revisão de ${exam.title ?? "avaliação"}.`,
          at: reminder,
        }];
      });
    })),
    ...(prefs?.tasks === false ? [] : (tasks ?? []).flatMap((task) => {
      if (task.status === "concluida" || !task.due_at) return [];
      const due = new Date(task.due_at);
      if (!Number.isFinite(due.getTime())) return [];
      const reminders = [0, 1].map((daysBefore) => {
        const reminder = new Date(due);
        reminder.setDate(reminder.getDate() - daysBefore);
        reminder.setHours(9, 0, 0, 0);

        // Never schedule after the actual due time. For deadlines before 10:00,
        // move the reminder to one hour before the deadline.
        if (reminder.getTime() >= due.getTime()) {
          reminder.setTime(due.getTime() - 60 * 60 * 1000);
        }

        const label = daysBefore === 0 ? "prazo hoje" : "prazo amanhã";
        return {
          id: stableId(NOTIFICATION_IDS.task, `${task.id}:${daysBefore}d`),
          title: `${subjectName(task.subject_id)} — ${label}`,
          body: task.title,
          at: reminder,
        };
      });

      return reminders.filter(
        ({ at }) => at.getTime() > now && at.getTime() < due.getTime() && !isWithinQuietHours(at, quietStart, quietEnd),
      );
    })),
    ...(prefs?.study_sessions === false ? [] : (plan ?? []).flatMap((session) => {
      if (session.status !== "planejada" || !session.start_time) return [];
      const parsedTime = parseTimeOfDay(session.start_time);
      if (
        !parsedTime ||
        !Number.isInteger(parsedTime.hour) ||
        !Number.isInteger(parsedTime.minute) ||
        parsedTime.hour < 0 ||
        parsedTime.hour > 23 ||
        parsedTime.minute < 0 ||
        parsedTime.minute > 59
      ) return [];
      const { hour, minute } = parsedTime;
      const start = new Date(`${session.session_date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`);
      const reminder = new Date(start.getTime() - 10 * 60 * 1000);
      if (reminder.getTime() <= now || isWithinQuietHours(reminder, quietStart, quietEnd)) return [];
      return [{ id: stableId(NOTIFICATION_IDS.study, `${session.id}:10m`), title: "Sessão de estudo em 10 minutos", body: `${subjectName(session.subject_id)} · ${session.duration_minutes} min`, at: reminder }];
    })),
    ...(prefs?.classes === false ? [] : (schedules ?? []).flatMap((schedule) => {
      const weekday = Number(schedule.weekday);
      if (!Number.isInteger(weekday) || !schedule.start_time) return [];
      const out = [];
      let cursor = new Date();
      for (let i = 0; i < 3; i += 1) {
        const occurrence = nextOccurrenceDate(cursor, weekday, schedule.start_time);
        if (!occurrence) continue;
        if (occurrence.getTime() <= now) {
          cursor = new Date(occurrence);
        cursor.setDate(cursor.getDate() + 1);
          continue;
        }
        if (occurrence.getTime() > horizon.getTime()) break;
        const reminder = new Date(occurrence.getTime() - 10 * 60 * 1000);
        if (reminder.getTime() > now && !isWithinQuietHours(reminder, quietStart, quietEnd)) {
          out.push({ id: stableId(NOTIFICATION_IDS.class, `${schedule.id}:${occurrence.toISOString().slice(0, 10)}`), title: `${subjectName(schedule.subject_id)} — aula em 10 minutos`, body: "Separe seus materiais e prepare-se.", at: reminder });
        }
        cursor = new Date(occurrence.getTime() + 24 * 60 * 60 * 1000);
      }
      return out;
    })),
  ];

  const seen = new Set<number>();
  for (const notification of notifications) {
    if (seen.has(notification.id)) continue;
    seen.add(notification.id);
    scheduledIds.add(notification.id);
    await scheduleNativeNotification(notification);
  }

  const staleIds = pending.notifications
    .map((notification) => notification.id)
    .filter((id) => prefixes.some((prefix) => id >= prefix && id < prefix + 90000) && !scheduledIds.has(id));
  await cancelNativeNotifications(staleIds);
}

export async function setupNativeNotifications() {
  if (NATIVE_NOTIFICATIONS_DISABLED || !isNativeAndroid()) return;
  // Do not trigger a permission prompt at app startup. The student opts in
  // explicitly from Perfil before any Android notification is scheduled.
  await ensureNativeNotificationChannel();
  await syncNativeAcademicNotifications();
}
