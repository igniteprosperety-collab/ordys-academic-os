import { describe, expect, it } from "vitest";
import {
  collectFreshBrowserNotifications,
  type BrowserNotificationStorage,
  type BrowserNotificationRow,
} from "@/lib/browser-notifications";

class MemoryStorage implements BrowserNotificationStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const now = Date.parse("2026-11-20T12:00:00.000Z");
const row = (id: string, ageMs = 0): BrowserNotificationRow => ({
  id,
  title: `Aviso ${id}`,
  body: "Lembrete acadêmico",
  created_at: new Date(now - ageMs).toISOString(),
});

describe("browser notification delivery", () => {
  it("creates a baseline instead of replaying old notifications on first use", () => {
    const storage = new MemoryStorage();

    expect(collectFreshBrowserNotifications("student-a", [row("old")], storage, now)).toEqual([]);
    expect(collectFreshBrowserNotifications("student-a", [row("old")], storage, now)).toEqual([]);
  });

  it("returns only fresh unseen notifications for the same account", () => {
    const storage = new MemoryStorage();
    collectFreshBrowserNotifications("student-a", [], storage, now);

    expect(
      collectFreshBrowserNotifications(
        "student-a",
        [row("new"), row("old", 10 * 60_000)],
        storage,
        now,
      ),
    ).toEqual([row("new")]);
    expect(collectFreshBrowserNotifications("student-a", [row("new")], storage, now)).toEqual(
      [],
    );
  });

  it("does not share notification history between student accounts", () => {
    const storage = new MemoryStorage();
    collectFreshBrowserNotifications("student-a", [row("a")], storage, now);
    collectFreshBrowserNotifications("student-b", [], storage, now);

    expect(collectFreshBrowserNotifications("student-b", [row("a")], storage, now)).toEqual([
      row("a"),
    ]);
  });

  it("does not replay notifications with invalid or future timestamps", () => {
    const storage = new MemoryStorage();
    collectFreshBrowserNotifications("student-a", [], storage, now);
    const invalid = { ...row("invalid"), created_at: "not-a-date" };
    const future = { ...row("future"), created_at: new Date(now + 60_000).toISOString() };

    expect(collectFreshBrowserNotifications("student-a", [invalid, future], storage, now)).toEqual(
      [],
    );
  });
});
