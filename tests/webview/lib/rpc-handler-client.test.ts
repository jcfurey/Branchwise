// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcRequest } from "@/types";
import { repoListError } from "@/webview/lib/load-repos";
import { rpcClient } from "@/webview/lib/rpc/rpc-client";
import { repoListStore } from "@/webview/lib/stores/repo-list.store";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

/** Exceptions that escaped the message listener, reported as window `error` events. */
const listenerErrors: unknown[] = [];

function recordListenerError(event: ErrorEvent) {
  listenerErrors.push(event.error);
  event.preventDefault();
}

beforeAll(() => {
  setupWebviewTest();
  document.documentElement.dataset["rpcTimeout"] = "No response: {0}";
});

beforeEach(() => {
  listenerErrors.length = 0;
  window.addEventListener("error", recordListenerError);
  vscodeApi.postMessage.mockClear();
});

afterEach(() => {
  window.removeEventListener("error", recordListenerError);
  vi.useRealTimers();
});

const rescan = { kind: "rpc.notify", id: "rescan", name: "repo.rescan", message: null };

function send(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

function respond(id: string, fields: Record<string, unknown>) {
  send({ kind: "rpc.response", id, ...fields });
}

function postedRequests(method: string) {
  return vscodeApi.postMessage.mock.calls
    .map(([message]) => message as RpcRequest)
    .filter((message) => message.kind === "rpc.request" && message.method === method);
}

function lastRequestId(method: string) {
  const request = postedRequests(method).at(-1);
  if (request === undefined) {
    throw new Error(`No ${method} request was sent`);
  }
  return request.id;
}

/** Let the scan's continuation store its result. */
function afterScan() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

it("does not listen until the client initializes it", async () => {
  send(rescan);
  expect(vscodeApi.postMessage).not.toHaveBeenCalled();

  rpcClient.init();
  send(rescan);

  expect(postedRequests("repo.scan")).toHaveLength(1);
  respond(lastRequestId("repo.scan"), { success: true, result: { repos: [] } });
  await afterScan();
});

describe("through the client", () => {
  beforeEach(() => {
    rpcClient.init();
  });

  it("resolves a response that arrives just before the deadline, and cancels the deadline", async () => {
    vi.useFakeTimers();
    const result = rpcClient.request("clipboard.copy", "x");
    const id = lastRequestId("clipboard.copy");

    await vi.advanceTimersByTimeAsync(29_999);
    respond(id, { success: true, result: true });

    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(60_000);
    await expect(result).resolves.toBe(true);
  });

  it("ignores a response that arrives after the deadline", async () => {
    vi.useFakeTimers();
    const result = rpcClient.request("clipboard.copy", "x");
    const rejected = expect(result).rejects.toThrow("No response: clipboard.copy");
    const id = lastRequestId("clipboard.copy");

    await vi.advanceTimersByTimeAsync(30_000);
    await rejected;

    expect(() => respond(id, { success: true, result: true })).not.toThrow();
    expect(listenerErrors).toEqual([]);
  });

  it("rejects with the extension's error text", async () => {
    const result = rpcClient.request("repo.scan", null);

    respond(lastRequestId("repo.scan"), {
      success: false,
      error: "Unknown RPC method: repo.scan"
    });

    await expect(result).rejects.toThrow(new Error("Unknown RPC method: repo.scan"));
  });

  it("rejects a malformed response at once, instead of at the deadline", async () => {
    vi.useFakeTimers();
    const result = rpcClient.request("settings.open", null);

    respond(lastRequestId("settings.open"), { success: false });

    expect(vi.getTimerCount()).toBe(0);
    await expect(result).rejects.toThrow("Malformed response to an RPC request");
  });

  it("resolves a success whose result was dropped in transit with undefined", async () => {
    const result = rpcClient.request("settings.open", null);

    respond(lastRequestId("settings.open"), { success: true });

    await expect(result).resolves.toBeUndefined();
  });

  it("matches responses by id, in whatever order they arrive", async () => {
    const settled: string[] = [];
    const a = rpcClient.request("settings.open", null).then(() => settled.push("A"));
    const b = rpcClient.request("docs.open", null).then(() => settled.push("B"));

    respond(lastRequestId("docs.open"), { success: true, result: true });
    await b;
    expect(settled).toEqual(["B"]);

    respond(lastRequestId("settings.open"), { success: true, result: true });
    await a;
    expect(settled).toEqual(["B", "A"]);
  });
});

describe("repo.rescan", () => {
  beforeEach(() => {
    rpcClient.init();
  });

  it("scans again without waiting, and fills the picker with the answer", async () => {
    repoListError.value = "old";

    send(rescan);

    expect(repoListError.value).toBeUndefined();
    expect(postedRequests("repo.scan")).toEqual([
      { kind: "rpc.request", id: expect.any(String), method: "repo.scan", params: null }
    ]);
    respond(lastRequestId("repo.scan"), {
      success: true,
      result: { repos: [{ name: "z", path: "/z" }] }
    });
    await vi.waitFor(() => {
      expect(repoListStore.get()).toEqual([{ name: "z", path: "/z" }]);
    });
  });

  it("reports a failed scan and keeps the list shown", async () => {
    send(rescan);
    respond(lastRequestId("repo.scan"), {
      success: true,
      result: { repos: [{ name: "z", path: "/z" }] }
    });
    await afterScan();

    send(rescan);
    respond(lastRequestId("repo.scan"), { success: false, error: "scan failed" });

    await vi.waitFor(() => {
      expect(repoListError.value).toBe("scan failed");
    });
    expect(repoListStore.get()).toEqual([{ name: "z", path: "/z" }]);
  });

  it("starts a scan for each notification", async () => {
    send(rescan);
    send(rescan);

    const scans = postedRequests("repo.scan");
    expect(scans).toHaveLength(2);
    for (const scan of scans) {
      respond(scan.id, { success: true, result: { repos: [] } });
    }
    await afterScan();
  });

  it.each([
    ["undefined", undefined],
    ["an object", { anything: true }]
  ])("ignores a payload that is %s", async (_, message) => {
    send({ ...rescan, message });

    expect(postedRequests("repo.scan")).toHaveLength(1);
    respond(lastRequestId("repo.scan"), { success: true, result: { repos: [] } });
    await afterScan();
  });

  it("ignores a rescan without a message", () => {
    send({ kind: "rpc.notify", id: "rescan", name: "repo.rescan" });

    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });
});
