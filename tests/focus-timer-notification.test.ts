import { describe, expect, it } from "vitest";
import {
  buildFocusTimerCompletionReminder,
  focusTimerNotificationId,
} from "@/lib/focus-timer-notification";
import type { RestoredFocusTimer } from "@/lib/focus-timer-state";

const snapshot: RestoredFocusTimer = {
  version: 1,
  userId: "student-1",
  minutes: 25,
  leftSeconds: 600,
  startedAt: "2026-11-21T12:00:00.000Z",
  endAtMs: Date.parse("2026-11-21T12:25:00.000Z"),
  status: "running",
  subjectId: "math",
  topicId: "fractions",
  planId: null,
  remainingSeconds: 600,
};

describe("focus timer completion reminders", () => {
  it("builds a native reminder for the exact session deadline", () => {
    const reminder = buildFocusTimerCompletionReminder(
      snapshot,
      Date.parse("2026-11-21T12:15:00.000Z"),
    );

    expect(reminder).toMatchObject({
      id: focusTimerNotificationId("student-1", snapshot.startedAt),
      title: "Tempo de foco concluído",
      body: "Sua sessão de 25 min terminou. Abra o ORDYS para registrar o estudo.",
    });
    expect(reminder?.at.getTime()).toBe(snapshot.endAtMs);
  });

  it("does not schedule reminders for paused or expired sessions", () => {
    expect(
      buildFocusTimerCompletionReminder({
        ...snapshot,
        status: "paused",
        endAtMs: null,
      }),
    ).toBeNull();

    expect(
      buildFocusTimerCompletionReminder(snapshot, snapshot.endAtMs),
    ).toBeNull();
  });

  it("scopes notification identifiers to both account and session", () => {
    const first = focusTimerNotificationId("student-1", snapshot.startedAt);
    const otherAccount = focusTimerNotificationId("student-2", snapshot.startedAt);
    const otherSession = focusTimerNotificationId(
      "student-1",
      "2026-11-21T12:01:00.000Z",
    );

    expect(first).toBeGreaterThanOrEqual(900000);
    expect(first).toBeLessThan(990000);
    expect(otherAccount).not.toBe(first);
    expect(otherSession).not.toBe(first);
  });

  it("rejects snapshots with an invalid account or deadline", () => {
    expect(
      buildFocusTimerCompletionReminder({ ...snapshot, userId: "" }),
    ).toBeNull();

    expect(
      buildFocusTimerCompletionReminder({ ...snapshot, endAtMs: Number.NaN }),
    ).toBeNull();
  });
});
