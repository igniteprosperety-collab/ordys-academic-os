import { describe, expect, it } from "vitest";
import { createSerialTaskQueue } from "@/lib/async-task-queue";

describe("serial async task queue", () => {
  it("runs queued tasks in order without overlapping", async () => {
    const enqueue = createSerialTaskQueue();
    const events: string[] = [];

    const first = enqueue(async () => {
      events.push("first:start");
      await Promise.resolve();
      events.push("first:end");
    });
    const second = enqueue(async () => {
      events.push("second:start");
      events.push("second:end");
    });

    await Promise.all([first, second]);
    expect(events).toEqual(["first:start", "first:end", "second:start", "second:end"]);
  });

  it("continues processing after a task rejects", async () => {
    const enqueue = createSerialTaskQueue();

    await expect(
      enqueue(async () => {
        throw new Error("temporary failure");
      }),
    ).rejects.toThrow("temporary failure");

    await expect(enqueue(async () => "recovered")).resolves.toBe("recovered");
  });
});
