import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addLocalProfile, startDemoMode } from "../src/lib/demo-mode";
import {
  demoSupabase,
  seedOrdysDemoDataset,
} from "../src/lib/demo-supabase";

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

async function rows(table: string) {
  const result = await demoSupabase.from(table).select("*");
  expect(result.error).toBeNull();
  return result.data as Array<Record<string, unknown>>;
}

async function insertOne(table: string, values: Record<string, unknown>) {
  const result = await demoSupabase.from(table).insert(values).select().single();
  expect(result.error).toBeNull();
  return result.data as Record<string, unknown>;
}

beforeEach(() => {
  vi.stubGlobal("window", {
    localStorage: new MemoryStorage(),
    dispatchEvent: vi.fn(),
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("ORDYS local database delete behavior", () => {
  it("deletes a task's subtasks with the task", async () => {
    const profile = addLocalProfile("Aluno local");
    startDemoMode();
    expect(seedOrdysDemoDataset()).toBe(true);

    const task = (await rows("tasks"))[0]!;
    await insertOne("subtasks", {
      user_id: profile.id,
      task_id: task.id,
      title: "Etapa que pertence à tarefa",
      done: false,
    });

    const deletion = await demoSupabase.from("tasks").delete().eq("id", task.id);
    expect(deletion.error).toBeNull();
    expect((await rows("subtasks")).some((subtask) => subtask.task_id === task.id)).toBe(false);
  });

  it("cascades topic records and clears optional subject references", async () => {
    const profile = addLocalProfile("Aluno local");
    startDemoMode();
    expect(seedOrdysDemoDataset()).toBe(true);

    const subject = (await rows("subjects"))[0]!;
    const subjectId = String(subject.id);
    const topic = await insertOne("topics", {
      user_id: profile.id,
      subject_id: subjectId,
      title: "Conteúdo para testar exclusão",
      status: "nao_estudado",
      mastery: 0,
    });
    const topicId = String(topic.id);
    const task = await insertOne("tasks", {
      user_id: profile.id,
      subject_id: subjectId,
      topic_id: topicId,
      title: "Tarefa vinculada",
    });
    const exam = await insertOne("exams", {
      user_id: profile.id,
      subject_id: subjectId,
      title: "Prova vinculada",
      exam_at: new Date(Date.now() + 86_400_000).toISOString(),
    });
    await insertOne("reviews", {
      user_id: profile.id,
      topic_id: topicId,
      due_on: "2026-12-01",
      reason: "Teste de vínculo",
    });
    await insertOne("subject_schedules", {
      user_id: profile.id,
      subject_id: subjectId,
      weekday: 0,
      start_time: "08:00",
      end_time: "09:00",
    });

    const deletion = await demoSupabase.from("subjects").delete().eq("id", subjectId);
    expect(deletion.error).toBeNull();

    expect((await rows("topics")).some((row) => row.id === topicId)).toBe(false);
    expect((await rows("reviews")).some((row) => row.topic_id === topicId)).toBe(false);
    expect((await rows("subject_schedules")).some((row) => row.subject_id === subjectId)).toBe(
      false,
    );
    expect((await rows("tasks")).find((row) => row.id === task.id)).toMatchObject({
      subject_id: null,
      topic_id: null,
    });
    expect((await rows("exams")).find((row) => row.id === exam.id)?.subject_id).toBeNull();
  });
});
