// @vitest-environment jsdom
import { effect } from "@preact/signals";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { GitRepo, RpcRequest } from "@/types";

import { vscodeApi } from "@tests/webview/setup";

let list: typeof import("@/webview/lib/stores/repo-list.store").repoListStore;

beforeEach(async () => {
  vi.resetModules();
  vscodeApi.postMessage.mockClear();
  // Fresh copies of the client and the list, so each test starts with no list and no requests.
  const { rpcClient } = await import("@/webview/lib/rpc/rpc-client");
  rpcClient.init();
  ({ repoListStore: list } = await import("@/webview/lib/stores/repo-list.store"));
});

const repo = (path: string, name = path.slice(1)): GitRepo => ({ name, path });

/** Ids of the scans posted so far, oldest first. */
function scanIds() {
  return vscodeApi.postMessage.mock.calls
    .map(([message]) => message as RpcRequest)
    .filter((message) => message.kind === "rpc.request" && message.method === "repo.scan")
    .map((message) => message.id);
}

function answer(id: string | undefined, reply: Record<string, unknown>) {
  const data = { kind: "rpc.response", id, ...reply };
  window.dispatchEvent(new MessageEvent("message", { data }));
}

const found = (id: string | undefined, repos: Array<GitRepo>) =>
  answer(id, { success: true, result: { repos } });

describe("load", () => {
  it("posts its scan before returning, and keeps the answer's own array", async () => {
    const pending = list.load();
    expect(vscodeApi.postMessage).toHaveBeenCalledWith({
      kind: "rpc.request",
      id: expect.any(String),
      method: "repo.scan",
      params: null
    });
    expect(list.get()).toBeUndefined();

    const repos = [repo("/b"), repo("/A"), repo("/a")];
    found(scanIds()[0], repos);
    await expect(pending).resolves.toBe(repos);
    expect(list.get()).toBe(repos);
    expect(list.get()!.map((entry) => entry.path)).toEqual(["/b", "/A", "/a"]);
  });

  it("rejects a failed scan and keeps the list it had", async () => {
    const first = list.load();
    found(scanIds()[0], [repo("/kept")]);
    const kept = await first;

    const second = list.load();
    answer(scanIds()[1], { success: false, error: "scan failed" });
    await expect(second).rejects.toThrow(new Error("scan failed"));
    expect(list.get()).toBe(kept);
  });

  it("keeps the newest scan's answer when an older one arrives after it", async () => {
    const older = list.load();
    const newer = list.load();
    const [olderId, newerId] = scanIds();

    found(newerId, [repo("/second")]);
    await newer;
    found(olderId, [repo("/first")]);
    await older;

    expect(list.get()).toEqual([repo("/second")]);
  });

  it("still takes an older answer that arrives first, then the newer one", async () => {
    const older = list.load();
    const newer = list.load();
    const [olderId, newerId] = scanIds();

    found(olderId, [repo("/first")]);
    await older;
    expect(list.get()).toEqual([repo("/first")]);

    found(newerId, [repo("/second")]);
    await newer;
    expect(list.get()).toEqual([repo("/second")]);
  });
});

describe("add", () => {
  it("makes a one-entry list from nothing", () => {
    list.add(repo("/q"));
    expect(list.get()).toEqual([{ name: "q", path: "/q" }]);
  });

  it("sorts by path into a new array, leaving the scan's array alone", async () => {
    const scanned = [repo("/c"), repo("/a")];
    const pending = list.load();
    found(scanIds()[0], scanned);
    await pending;

    list.add(repo("/b"));
    expect(list.get()!.map((entry) => entry.path)).toEqual(["/a", "/b", "/c"]);
    expect(list.get()).not.toBe(scanned);
    expect(scanned.map((entry) => entry.path)).toEqual(["/c", "/a"]);
  });

  it("replaces the entry with the same path, and posts nothing", () => {
    list.add(repo("/c", "c"));
    const before = list.get();
    list.add(repo("/c", "renamed"));
    expect(list.get()).toEqual([{ name: "renamed", path: "/c" }]);
    expect(list.get()).not.toBe(before);
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });
});

it("wakes a reader after each change of the list", async () => {
  let runs = 0;
  const stop = effect(() => {
    list.get();
    runs += 1;
  });

  const pending = list.load();
  found(scanIds()[0], [repo("/x")]);
  await pending;
  expect(runs).toBe(2);

  list.add(repo("/y"));
  expect(runs).toBe(3);
  stop();
});
