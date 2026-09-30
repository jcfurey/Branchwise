import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { GitRepo } from "@/types";

let scan: typeof import("@/webview/lib/load-repos");
let store: typeof import("@/webview/lib/stores/repo-list.store").repoListStore;

beforeEach(async () => {
  vi.resetModules();
  scan = await import("@/webview/lib/load-repos");
  ({ repoListStore: store } = await import("@/webview/lib/stores/repo-list.store"));
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A scan whose outcome the test decides later. */
function heldScan() {
  let settle = { pass: (_repos: Array<GitRepo>) => {}, fail: (_reason: unknown) => {} };
  const promise = new Promise<Array<GitRepo>>((resolve, reject) => {
    settle = { pass: resolve, fail: reject };
  });
  return { promise, ...settle };
}

it("never rejects, and reports the failure's message", async () => {
  vi.spyOn(store, "load").mockRejectedValue(new Error("x"));
  await expect(scan.loadRepoList()).resolves.toBeUndefined();
  expect(scan.repoListError.value).toBe("x");
});

it("reports a failure that is not an Error as text", async () => {
  vi.spyOn(store, "load").mockRejectedValue("text");
  await scan.loadRepoList();
  expect(scan.repoListError.value).toBe("text");
});

it("reports an empty message as it is", async () => {
  vi.spyOn(store, "load").mockRejectedValue(new Error(""));
  await scan.loadRepoList();
  expect(scan.repoListError.value).toBe("");
});

it("clears an old error at once, and keeps it clear when the scan works", async () => {
  const held = heldScan();
  const load = vi.spyOn(store, "load").mockReturnValue(held.promise);
  scan.repoListError.value = "old";

  const done = scan.loadRepoList();
  expect(scan.repoListError.value).toBeUndefined();
  expect(load).toHaveBeenCalledOnce();

  held.pass([]);
  await expect(done).resolves.toBeUndefined();
  expect(scan.repoListError.value).toBeUndefined();
});

it("ignores an older scan that fails after a newer one started", async () => {
  const older = heldScan();
  const newer = heldScan();
  vi.spyOn(store, "load").mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

  const first = scan.loadRepoList();
  const second = scan.loadRepoList();
  newer.pass([]);
  await second;
  older.fail(new Error("late failure"));
  await first;

  expect(scan.repoListError.value).toBeUndefined();
});

it("keeps the newest scan's error when an older one succeeds afterwards", async () => {
  const older = heldScan();
  const newer = heldScan();
  vi.spyOn(store, "load").mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);

  const first = scan.loadRepoList();
  const second = scan.loadRepoList();
  newer.fail(new Error("newest failed"));
  await second;
  older.pass([]);
  await first;

  expect(scan.repoListError.value).toBe("newest failed");
});
