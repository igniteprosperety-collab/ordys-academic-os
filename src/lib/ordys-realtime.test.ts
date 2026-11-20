import { describe, expect, it } from "vitest";
import { ORDYS_REALTIME_TABLES } from "@/lib/ordys-realtime";

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

  it("uses the profile primary key instead of a user_id column", () => {
    expect(ORDYS_REALTIME_TABLES.find((item) => item.table === "profiles")).toMatchObject({
      ownerColumn: "id",
      queryKeys: [["profile"]],
    });
  });
});
