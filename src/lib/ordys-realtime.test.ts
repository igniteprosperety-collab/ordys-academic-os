import { describe, expect, it } from "vitest";
import {
  matchesOrdysRealtimeOwnerQueryKey,
  matchesOrdysRealtimeQueryKey,
  ORDYS_REALTIME_TABLES,
} from "@/lib/ordys-realtime";

describe("ORDYS realtime coverage", () => {
  it("covers each student-facing data area exactly once", () => {
    const tables = ORDYS_REALTIME_TABLES.map((item) => item.table);

    expect(new Set(tables).size).toBe(tables.length);
    expect(tables).toContain("notifications");
    expect(tables).toContain("calendar_events");
    expect(tables).toContain("focus_sessions");
    expect(tables).toContain("tasks");
    expect(tables).toContain("profiles");
  });

  it("uses an owner column for every subscription", () => {
    for (const item of ORDYS_REALTIME_TABLES) {
      expect(["id", "user_id"]).toContain(item.ownerColumn);
      expect(item.queryKeys.length).toBeGreaterThan(0);
      for (const key of item.queryKeys) expect(key.length).toBeGreaterThan(0);
    }
  });

  it("invalidates parameterized queries without crossing student accounts", () => {
    expect(
      matchesOrdysRealtimeQueryKey(
        ["subjects", false, "student-a", "cloud"],
        "student-a",
        "subjects",
      ),
    ).toBe(true);
    expect(
      matchesOrdysRealtimeQueryKey(
        ["topics", "subject-1", "student-a", "cloud"],
        "student-a",
        "topics",
      ),
    ).toBe(true);
    expect(
      matchesOrdysRealtimeQueryKey(["topics", "all", "student-b", "cloud"], "student-a", "topics"),
    ).toBe(false);
    expect(
      matchesOrdysRealtimeQueryKey(
        ["subjects", false, "student-a", "demo"],
        "student-a",
        "subjects",
      ),
    ).toBe(false);
  });

  it("matches every owned cloud query when the profile revision changes", () => {
    const ownedKeys = [
      ["profile", "student-a", "cloud"],
      ["subjects", false, "student-a", "cloud"],
      ["topics", "subject-1", "student-a", "cloud"],
      ["tasks", "student-a", "cloud"],
      ["calendar-connections", "student-a", "cloud"],
      ["quiz-answers", "student-a", "cloud"],
    ];

    for (const queryKey of ownedKeys) {
      expect(matchesOrdysRealtimeOwnerQueryKey(queryKey, "student-a")).toBe(true);
    }
    expect(
      matchesOrdysRealtimeOwnerQueryKey(
        ["tasks", "student-b", "cloud"],
        "student-a",
      ),
    ).toBe(false);
    expect(
      matchesOrdysRealtimeOwnerQueryKey(
        ["tasks", "student-a", "demo"],
        "student-a",
      ),
    ).toBe(false);
    expect(
      matchesOrdysRealtimeOwnerQueryKey(
        ["billing", "student-a", "cloud"],
        "student-a",
      ),
    ).toBe(false);
  });

  it("uses the profile primary key instead of a user_id column", () => {
    expect(ORDYS_REALTIME_TABLES.find((item) => item.table === "profiles")).toMatchObject({
      ownerColumn: "id",
      queryKeys: [["profile"]],
    });
  });
});
