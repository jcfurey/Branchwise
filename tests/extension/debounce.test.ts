import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Uri } from "vscode";

import { createDebouncer, type FsWatcherEvent } from "@/extension/util/debounce";

const logSpy = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock("@/extension/util/logger", () => ({ logger: logSpy }));

type Callback = (type: FsWatcherEvent, uri: Uri) => Promise<void>;

/** The debouncer reads only `toString()`; `fsPath` lets a test tell equal URIs apart. */
function uriOf(text: string, fsPath = text): Uri {
  return { fsPath, toString: () => text } as unknown as Uri;
}

const resolved = (): Callback => vi.fn(async () => {});

let debouncer: ReturnType<typeof createDebouncer>;
beforeEach(() => {
  vi.useFakeTimers();
  logSpy.error.mockReset();
  debouncer = createDebouncer();
});
afterEach(() => {
  debouncer.dispose();
  vi.useRealTimers();
});

it("runs once, 100 ms after the last call of a burst", () => {
  const callback = resolved();
  const uri = uriOf("file:///ws/a/.git");
  for (let call = 0; call < 5; call++) {
    debouncer.debounce("created", uri, callback);
    vi.advanceTimersByTime(30);
  }
  vi.advanceTimersByTime(99 - 30);
  expect(callback).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(callback).toHaveBeenCalledExactlyOnceWith("created", uri);
});

it("keeps a separate wait for each event kind and resource", () => {
  const callback = resolved();
  const first = uriOf("file:///ws/one/.git");
  const second = uriOf("file:///ws/two/.git");
  debouncer.debounce("created", first, callback);
  debouncer.debounce("deleted", first, callback);
  debouncer.debounce("created", second, callback);
  vi.advanceTimersByTime(100);
  expect(vi.mocked(callback).mock.calls).toEqual([
    ["created", first],
    ["deleted", first],
    ["created", second]
  ]);
});

it("treats URIs that print alike as one resource and passes on the latest", () => {
  const callback = resolved();
  const earlier = uriOf("file:///ws/same", "/mnt/earlier");
  const later = uriOf("file:///ws/same", "/mnt/later");
  debouncer.debounce("created", earlier, callback);
  debouncer.debounce("created", later, callback);
  vi.advanceTimersByTime(100);
  expect(callback).toHaveBeenCalledOnce();
  expect(vi.mocked(callback).mock.calls[0]![1]).toBe(later);
});

it("drops the callbacks of earlier calls in a burst", () => {
  const dropped = resolved();
  const kept = resolved();
  const uri = uriOf("file:///ws/x");
  debouncer.debounce("deleted", uri, dropped);
  vi.advanceTimersByTime(60);
  debouncer.debounce("deleted", uri, kept);
  vi.advanceTimersByTime(99);
  expect(kept).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(dropped).not.toHaveBeenCalled();
  expect(kept).toHaveBeenCalledExactlyOnceWith("deleted", uri);
});

it.each([
  ["an error", new Error("boom")],
  ["a string", "text reason"]
])("logs a callback that rejects with %s", async (_name, reason) => {
  debouncer.debounce("created", uriOf("file:///ws/r"), () => Promise.reject(reason));
  await vi.advanceTimersByTimeAsync(100);
  expect(logSpy.error).toHaveBeenCalledExactlyOnceWith(
    "Unable to process repository change",
    reason
  );
});

it("logs a callback that throws before returning, without failing the timer", () => {
  const failure = new Error("thrown at once");
  debouncer.debounce("created", uriOf("file:///ws/t"), () => {
    throw failure;
  });
  expect(() => vi.advanceTimersByTime(100)).not.toThrow();
  expect(logSpy.error).toHaveBeenCalledExactlyOnceWith(
    "Unable to process repository change",
    failure
  );
});

it("accepts a callback that returns no promise", async () => {
  const plain = vi.fn(() => undefined);
  debouncer.debounce("deleted", uriOf("file:///ws/p"), plain as unknown as Callback);
  await vi.advanceTimersByTimeAsync(100);
  expect(plain).toHaveBeenCalledOnce();
  expect(logSpy.error).not.toHaveBeenCalled();
});

it("logs nothing when the callback succeeds", async () => {
  debouncer.debounce("created", uriOf("file:///ws/ok"), resolved());
  await vi.advanceTimersByTimeAsync(100);
  expect(logSpy.error).not.toHaveBeenCalled();
});

it("cancels every waiting call on dispose and leaves no timer behind", () => {
  const callback = resolved();
  debouncer.debounce("created", uriOf("file:///ws/d1"), callback);
  debouncer.debounce("deleted", uriOf("file:///ws/d2"), callback);
  debouncer.dispose();
  expect(vi.getTimerCount()).toBe(0);
  vi.advanceTimersByTime(1000);
  expect(callback).not.toHaveBeenCalled();
});

it("still accepts calls after dispose", () => {
  const callback = resolved();
  debouncer.dispose();
  debouncer.dispose();
  debouncer.debounce("created", uriOf("file:///ws/again"), callback);
  vi.advanceTimersByTime(100);
  expect(callback).toHaveBeenCalledOnce();
});

it("starts a new callback while the previous one for the pair is still running", () => {
  const unsettled = vi.fn(() => new Promise<void>(() => {}));
  const uri = uriOf("file:///ws/slow");
  debouncer.debounce("created", uri, unsettled);
  vi.advanceTimersByTime(100);
  debouncer.debounce("created", uri, unsettled);
  vi.advanceTimersByTime(100);
  expect(unsettled).toHaveBeenCalledTimes(2);
});

it("keeps debouncers independent of each other", () => {
  const other = createDebouncer();
  const mine = resolved();
  const theirs = resolved();
  const uri = uriOf("file:///ws/shared");
  debouncer.debounce("created", uri, mine);
  other.debounce("created", uri, theirs);
  debouncer.dispose();
  vi.advanceTimersByTime(100);
  expect(mine).not.toHaveBeenCalled();
  expect(theirs).toHaveBeenCalledOnce();
  other.dispose();
});
