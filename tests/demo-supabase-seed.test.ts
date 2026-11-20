import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  addLocalProfile,
  getLocalProfiles,
  startDemoMode,
  switchLocalProfile,
} from "../src/lib/demo-mode";
import { demoSupabase, seedOrdysDemoDataset } from "../src/lib/demo-supabase";

class MemoryStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }

  removeItem(key: string) {
    this.values.delete(key);
  }
}

async function readRows(table: string) {
  const result = await demoSupabase.from(table).select("*");
  expect(result.error).toBeNull();
  return result.data as Array<Record<string, unknown>>;
}

beforeEach(() => {
  const localStorage = new MemoryStorage();
  vi.stubGlobal("window", {
    localStorage,
    dispatchEvent: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ORDYS local demonstration dataset", () => {
  it("preloads linked student data for a new local profile without using the cloud", async () => {
    const profile = addLocalProfile("Demonstração");
    startDemoMode();

    expect(seedOrdysDemoDataset()).toBe(true);

    const [
      profiles,
      subjects,
      topics,
      tasks,
      exams,
      grades,
      plans,
      focus,
      reviews,
      goals,
      attempts,
      answers,
    ] = await Promise.all([
      readRows("profiles"),
      readRows("subjects"),
      readRows("topics"),
      readRows("tasks"),
      readRows("exams"),
      readRows("grades"),
      readRows("plan_sessions"),
      readRows("focus_sessions"),
      readRows("reviews"),
      readRows("goals"),
      readRows("quiz_attempts"),
      readRows("quiz_answers"),
    ]);

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      id: profile.id,
      full_name: "Demonstração",
    });
    expect(subjects).toHaveLength(4);
    expect(topics.length).toBeGreaterThanOrEqual(8);
    expect(tasks.length).toBeGreaterThanOrEqual(4);
    expect(exams.length).toBeGreaterThanOrEqual(2);
    expect(grades.length).toBeGreaterThanOrEqual(3);
    expect(plans.length).toBeGreaterThanOrEqual(4);
    expect(focus.length).toBeGreaterThanOrEqual(2);
    expect(reviews.length).toBeGreaterThanOrEqual(2);
    expect(goals.length).toBeGreaterThanOrEqual(2);
    expect(attempts).toHaveLength(1);
    expect(answers).toHaveLength(5);

    const subjectIds = new Set(subjects.map((row) => row.id));
    const topicIds = new Set(topics.map((row) => row.id));
    for (const row of [
      ...topics,
      ...tasks,
      ...exams,
      ...grades,
      ...plans,
      ...focus,
      ...reviews,
      ...goals,
      ...attempts,
      ...answers,
    ]) {
      expect(row.user_id).toBe(profile.id);
    }
    for (const row of topics)
      expect(subjectIds.has(String(row.subject_id))).toBe(true);
    for (const row of tasks) {
      expect(row.subject_id == null || subjectIds.has(row.subject_id)).toBe(
        true,
      );
      expect(row.topic_id == null || topicIds.has(String(row.topic_id))).toBe(
        true,
      );
    }
    for (const row of grades) expect(subjectIds.has(row.subject_id)).toBe(true);
    for (const row of answers) expect(topicIds.has(row.topic_id)).toBe(true);

    expect(tasks.some((row) => row.status === "concluida")).toBe(true);
    expect(tasks.some((row) => row.status !== "concluida")).toBe(true);
    expect(plans.some((row) => row.status === "planejada")).toBe(true);
    expect(plans.some((row) => row.status === "concluida")).toBe(true);
    expect(reviews.some((row) => row.status === "pendente")).toBe(true);
  });

  it("is idempotent and never overwrites existing local work", async () => {
    addLocalProfile("Perfil local");
    startDemoMode();

    expect(seedOrdysDemoDataset()).toBe(true);
    const subjectsBefore = await readRows("subjects");
    const firstSubject = subjectsBefore[0];
    expect(firstSubject).toBeTruthy();

    await demoSupabase
      .from("subjects")
      .update({ name: "Disciplina editada pela pessoa" })
      .eq("id", firstSubject!.id);

    expect(seedOrdysDemoDataset()).toBe(false);
    const subjectsAfter = await readRows("subjects");
    expect(subjectsAfter).toHaveLength(subjectsBefore.length);
    expect(subjectsAfter.find((row) => row.id === firstSubject!.id)?.name).toBe(
      "Disciplina editada pela pessoa",
    );
  });

  it("keeps separate sample data for each local profile", async () => {
    const first = addLocalProfile("Primeiro perfil");
    startDemoMode();
    expect(seedOrdysDemoDataset()).toBe(true);
    const firstSubjectIds = (await readRows("subjects")).map((row) => row.id);

    addLocalProfile("Segundo perfil");
    startDemoMode();
    expect(seedOrdysDemoDataset()).toBe(true);
    const secondSubjectIds = (await readRows("subjects")).map((row) => row.id);
    expect(secondSubjectIds).not.toEqual(firstSubjectIds);

    const profiles = getLocalProfiles();
    expect(profiles).toHaveLength(2);
    switchLocalProfile(first.id);
    const restoredSubjectIds = (await readRows("subjects")).map(
      (row) => row.id,
    );
    expect(restoredSubjectIds).toEqual(firstSubjectIds);
  });
});
