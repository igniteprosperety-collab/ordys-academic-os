/**
 * Returns the next monthly summary time at 19:00 local time.
 * Unlike academic reminders, this single summary is scheduled beyond the
 * 14-day rolling window so it is not silently skipped early in the month.
 */
export function nextMonthlySummaryAt(now: Date): Date {
  const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  currentMonthEnd.setHours(19, 0, 0, 0);

  if (currentMonthEnd.getTime() > now.getTime()) {
    return currentMonthEnd;
  }

  const nextMonthEnd = new Date(now.getFullYear(), now.getMonth() + 2, 0);
  nextMonthEnd.setHours(19, 0, 0, 0);
  return nextMonthEnd;
}
