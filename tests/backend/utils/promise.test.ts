import { describe, expect, it, vi } from "vitest";

import { evalPromises } from "@/backend/utils/promise";

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Wraps `work` so a test can see when each item started and ended and how many ran together.
 * The wrapper is asynchronous, so a throw inside `work` reaches the helper as a rejection.
 */
function observe<T, R>(work: (item: T) => Promise<R>) {
  const log: string[] = [];
  let running = 0;
  let most = 0;
  const task = async (item: T) => {
    log.push(`start ${String(item)}`);
    running += 1;
    most = Math.max(most, running);
    try {
      return await work(item);
    } finally {
      running -= 1;
      log.push(`end ${String(item)}`);
    }
  };
  return { task, log, most: () => most, started: () => log.filter((e) => e.startsWith("start")) };
}

describe("evalPromises results", () => {
  it("fulfils an empty list without calling the task", async () => {
    const task = vi.fn(async (item: number) => item);
    await expect(evalPromises([], 3, task)).resolves.toEqual([]);
    expect(task).not.toHaveBeenCalled();
  });

  it("keeps each value at its item's index whatever order the tasks finish in", async () => {
    await expect(evalPromises([30, 10, 20], 3, (ms) => sleep(ms).then(() => ms))).resolves.toEqual([
      30, 10, 20
    ]);
  });

  it("keeps undefined values in place", async () => {
    const values = await evalPromises([1, 2, 3], 2, async (n) => (n === 2 ? undefined : n));
    expect(values).toEqual([1, undefined, 3]);
    expect(values).toHaveLength(3);
    expect(1 in values).toBe(true);
  });

  it("processes items appended to the input while the run is pending", async () => {
    const items = ["x", "y", "z"];
    const run = evalPromises(items, 1, async (item) => item.toUpperCase());
    items.push("w");
    await expect(run).resolves.toEqual(["X", "Y", "Z", "W"]);
  });
});

describe("evalPromises scheduling", () => {
  it("never runs more than the limit and starts items in index order", async () => {
    const { task, most, started } = observe((n: number) => sleep((7 - n) * 3).then(() => n));
    await expect(evalPromises([1, 2, 3, 4, 5, 6], 2, task)).resolves.toEqual([1, 2, 3, 4, 5, 6]);
    expect(most()).toBe(2);
    expect(started()).toEqual(["start 1", "start 2", "start 3", "start 4", "start 5", "start 6"]);
  });

  it("starts the next item as soon as a lane frees up", async () => {
    const { task, log } = observe((n: number) => sleep((6 - n) * 5).then(() => n * 10));
    await expect(evalPromises([1, 2, 3, 4, 5], 2, task)).resolves.toEqual([10, 20, 30, 40, 50]);
    expect(log.slice(0, 4)).toEqual(["start 1", "start 2", "end 2", "start 3"]);
  });

  it("starts every item at once when the limit exceeds their number", async () => {
    const { task, log } = observe((n: number) => sleep(5).then(() => n));
    await expect(evalPromises([1, 2, 3], 10, task)).resolves.toEqual([1, 2, 3]);
    expect(log.slice(0, 3)).toEqual(["start 1", "start 2", "start 3"]);
  });

  it("starts the first tasks before returning", () => {
    const task = vi.fn(async (letter: string) => letter);
    void evalPromises(["p", "q", "r"], 2, task);
    expect(task.mock.calls).toEqual([["p"], ["q"]]);
  });

  it("rounds a fractional limit up", async () => {
    const { task, most } = observe((n: number) => sleep(5).then(() => n));
    await expect(evalPromises([1, 2, 3, 4], 1.5, task)).resolves.toEqual([1, 2, 3, 4]);
    expect(most()).toBe(2);
  });

  // Decision evalPromises Q1: every input settles.
  it.each([0, -2, Number.NaN])("runs one task at a time for the limit %s", async (limit) => {
    const { task, most } = observe((n: number) => sleep(2).then(() => n * 2));
    await expect(evalPromises([1, 2, 3], limit, task)).resolves.toEqual([2, 4, 6]);
    expect(most()).toBe(1);
  });

  it("runs a single item whatever the limit", async () => {
    await expect(evalPromises(["a"], 0, async (item) => item + "!")).resolves.toEqual(["a!"]);
  });
});

describe("evalPromises failures", () => {
  // Decisions evalPromises Q2 and Q3: the first failure's own reason, and nothing starts after.
  it("rejects with a failed task's reason and starts nothing more", async () => {
    const failure = new Error("item 2 failed");
    const { task, started } = observe(async (n: number) => {
      await sleep(2);
      if (n === 2) {
        throw failure;
      }
      return n;
    });
    await expect(evalPromises([1, 2, 3, 4], 1, task)).rejects.toBe(failure);
    await sleep(20);
    expect(started()).toEqual(["start 1", "start 2"]);
  });

  it("passes on a rejection value that is not an Error", async () => {
    await expect(
      evalPromises([1, 2], 2, (n) => (n === 1 ? Promise.reject("why") : Promise.resolve(n)))
    ).rejects.toBe("why");
  });

  it("rejects with the value a lone task throws", async () => {
    const failure = new Error("only item");
    await expect(
      evalPromises([1], 2, () => {
        throw failure;
      })
    ).rejects.toBe(failure);
  });

  it("stops after a task throws while the first tasks start", async () => {
    const failure = new Error("item 2 threw");
    const calls: number[] = [];
    const run = evalPromises([1, 2, 3, 4], 2, (n) => {
      calls.push(n);
      if (n === 2) {
        throw failure;
      }
      return sleep(5).then(() => n);
    });
    await expect(run).rejects.toBe(failure);
    await sleep(30);
    expect(calls).toEqual([1, 2]);
  });

  it("stops after a later task throws", async () => {
    const failure = new Error("item 3 threw");
    const calls: number[] = [];
    const run = evalPromises([1, 2, 3, 4], 1, (n) => {
      calls.push(n);
      if (n === 3) {
        throw failure;
      }
      return sleep(2).then(() => n);
    });
    await expect(run).rejects.toBe(failure);
    await sleep(10);
    expect(calls).toEqual([1, 2, 3]);
  });

  it("rejects without waiting for tasks still running", async () => {
    const slow = Promise.withResolvers<string>();
    let slowDone = false;
    void slow.promise.then(() => {
      slowDone = true;
    });
    const run = evalPromises(["fail", "slow"], 2, (item) =>
      item === "fail" ? Promise.reject(new Error("fast failure")) : slow.promise
    );
    await expect(run).rejects.toThrow("fast failure");
    expect(slowDone).toBe(false);
    slow.resolve("slow");
    await expect(slow.promise).resolves.toBe("slow");
  });
});
