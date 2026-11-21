export type GoalAlertGoal = {
  id: string;
  title: string;
  metric: string;
  target: number;
  period: string;
  subject_id: string | null;
  active: boolean;
};

export type GoalAlertGrade = {
  graded_on: string;
  score: number;
  max_score: number;
  weight: number;
  subject_id: string;
};

export type GoalAlertAttendance = {
  class_date: string;
  status: string;
  subject_id: string;
};

export type GoalProgressReminder = {
  id: number;
  title: string;
  body: string;
  at: Date;
};

type GoalProgressOptions = {
  now: Date;
  scale: number;
  quietStart: string;
  quietEnd: string;
};

const GOAL_NOTIFICATION_ID_PREFIX = 700000;
const DAILY_REMINDER_MINUTES = 19 * 60;

function startOfDay(date: Date) {
  const value = new Date(date);
  value.setHours(0, 0, 0, 0);
  return value;
}

function startOfWeek(date: Date) {
  const value = startOfDay(date);
  value.setDate(value.getDate() - ((value.getDay() + 6) % 7));
  return value;
}

function goalRange(period: string, now: Date) {
  const year = now.getFullYear();
  const month = now.getMonth();

  switch (period) {
    case "diario": {
      const from = startOfDay(now);
      const to = new Date(from);
      to.setDate(to.getDate() + 1);
      return { from, to };
    }
    case "mensal":
      return { from: new Date(year, month, 1), to: new Date(year, month + 1, 1) };
    case "bimestral": {
      const firstMonth = Math.floor(month / 2) * 2;
      return { from: new Date(year, firstMonth, 1), to: new Date(year, firstMonth + 2, 1) };
    }
    case "semestral": {
      const firstMonth = month < 6 ? 0 : 6;
      return { from: new Date(year, firstMonth, 1), to: new Date(year, firstMonth + 6, 1) };
    }
    case "semanal":
    default: {
      const from = startOfWeek(now);
      const to = new Date(from);
      to.setDate(to.getDate() + 7);
      return { from, to };
    }
  }
}

function isDateOnlyInRange(value: string, range: { from: Date; to: Date }) {
  if (!value) return false;
  const date = new Date(`${value}T00:00:00`);
  return Number.isFinite(date.getTime()) && date >= range.from && date < range.to;
}

function parseClockMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

function isWithinQuietHours(date: Date, start: string, end: string) {
  const startMinutes = parseClockMinutes(start);
  const endMinutes = parseClockMinutes(end);
  if (startMinutes === null || endMinutes === null || startMinutes === endMinutes) return false;

  const currentMinutes = date.getHours() * 60 + date.getMinutes();
  return startMinutes < endMinutes
    ? currentMinutes >= startMinutes && currentMinutes < endMinutes
    : currentMinutes >= startMinutes || currentMinutes < endMinutes;
}

function stableGoalNotificationId(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(hash, 31) + value.charCodeAt(index);
  }
  return GOAL_NOTIFICATION_ID_PREFIX + ((hash >>> 0) % 90000);
}

function currentGoalValue(
  goal: GoalAlertGoal,
  grades: GoalAlertGrade[],
  attendance: GoalAlertAttendance[],
  options: GoalProgressOptions,
): { value: number; suffix: string } | null {
  const range = goalRange(goal.period, options.now);
  if (goal.metric === "media") {
    const scopedGrades = grades.filter(
      (grade) =>
        isDateOnlyInRange(grade.graded_on, range) &&
        (!goal.subject_id || grade.subject_id === goal.subject_id),
    );
    if (!scopedGrades.length) return null;

    let weightedSum = 0;
    let totalWeight = 0;
    for (const grade of scopedGrades) {
      const weight = Number(grade.weight || 1);
      const score = Number(grade.score);
      const maxScore = Number(grade.max_score || options.scale);
      if (
        !Number.isFinite(score) ||
        !Number.isFinite(maxScore) ||
        maxScore <= 0 ||
        !Number.isFinite(weight) ||
        weight <= 0
      ) {
        continue;
      }
      weightedSum += (score / maxScore) * options.scale * weight;
      totalWeight += weight;
    }
    if (!totalWeight) return null;
    return { value: weightedSum / totalWeight, suffix: "" };
  }

  if (goal.metric === "frequencia") {
    const scopedAttendance = attendance.filter(
      (record) =>
        isDateOnlyInRange(record.class_date, range) &&
        (!goal.subject_id || record.subject_id === goal.subject_id),
    );
    if (!scopedAttendance.length) return null;
    const present = scopedAttendance.filter(
      (record) => record.status === "presente" || record.status === "justificada",
    ).length;
    return { value: (present / scopedAttendance.length) * 100, suffix: "%" };
  }

  return null;
}

export function buildGoalProgressReminders(
  goals: GoalAlertGoal[],
  grades: GoalAlertGrade[],
  attendance: GoalAlertAttendance[],
  options: GoalProgressOptions,
): GoalProgressReminder[] {
  const nowMs = options.now.getTime();
  if (!Number.isFinite(nowMs) || !Number.isFinite(options.scale) || options.scale <= 0) return [];

  const reminderAt = new Date(options.now);
  reminderAt.setHours(19, 0, 0, 0);
  if (
    reminderAt.getTime() <= nowMs ||
    isWithinQuietHours(reminderAt, options.quietStart, options.quietEnd)
  ) {
    return [];
  }

  return goals.flatMap((goal) => {
    if (!goal.active || !goal.id || !goal.title.trim()) return [];
    if (goal.metric !== "media" && goal.metric !== "frequencia") return [];
    const target = Number(goal.target);
    if (!Number.isFinite(target) || target <= 0) return [];

    const current = currentGoalValue(goal, grades, attendance, options);
    if (!current || current.value >= target) return [];

    const valueLabel = goal.metric === "media"
      ? current.value.toFixed(1)
      : `${Math.round(current.value)}%`;
    const targetLabel = goal.metric === "media"
      ? target.toFixed(1)
      : `${target}%`;
    const dayKey = `${options.now.getFullYear()}-${String(options.now.getMonth() + 1).padStart(2, "0")}-${String(options.now.getDate()).padStart(2, "0")}`;

    return [{
      id: stableGoalNotificationId(`${goal.id}:${goal.period}:${dayKey}`),
      title: "Meta acadêmica abaixo do alvo",
      body: `${goal.title}: ${valueLabel} de ${targetLabel}. Confira seu progresso no ORDYS.`,
      at: reminderAt,
    }];
  });
}
