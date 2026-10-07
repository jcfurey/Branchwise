// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { WebviewConfig } from "@/types";
import { workspaceVisible } from "@/webview/lib/navigation";
import { initRpcHandler, type PendingRpcRequest } from "@/webview/lib/rpc/rpc-handler";
import { maxCommits, selectedBranch, selectedRepo } from "@/webview/lib/stores";
import { repoListStore } from "@/webview/lib/stores/repo-list.store";
import { getWebviewConfig } from "@/webview/lib/webview-config";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const MALFORMED = "Malformed response to an RPC request";

// The picker's own behaviour is tested with its module; here only the routing to it.
const goTo = vi.hoisted(() => ({ openGoTo: vi.fn(), revealChoice: vi.fn() }));
vi.mock("@/webview/lib/go-to", () => goTo);

const requests = new Map<string, PendingRpcRequest>();
/** Exceptions that escaped the message listener, reported as window `error` events. */
const listenerErrors: unknown[] = [];

function recordListenerError(event: ErrorEvent) {
  listenerErrors.push(event.error);
  event.preventDefault();
}

beforeAll(() => {
  setupWebviewTest();
  initRpcHandler(requests);
});

beforeEach(() => {
  listenerErrors.length = 0;
  window.addEventListener("error", recordListenerError);
  vscodeApi.postMessage.mockClear();
  vscodeApi.setState.mockClear();
  goTo.openGoTo.mockClear();
  goTo.revealChoice.mockClear();
});

afterEach(() => {
  window.removeEventListener("error", recordListenerError);
  for (const request of requests.values()) {
    clearTimeout(request.timeout);
  }
  requests.clear();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function send(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

function pending(id: string, timeout = setTimeout(() => undefined, 30_000)) {
  const request = { resolve: vi.fn(), reject: vi.fn(), timeout };
  requests.set(id, request);
  return request;
}

function notification(name: string, message: unknown) {
  return { kind: "rpc.notify", id: "note", name, message };
}

function postedCommands() {
  return vscodeApi.postMessage.mock.calls.map(
    ([message]) => (message as { command: string }).command
  );
}

function rejection(request: { reject: { mock: { calls: unknown[][] } } }) {
  const [reason] = request.reject.mock.calls[0] ?? [];
  expect(reason).toBeInstanceOf(Error);
  return reason as Error;
}

describe("responses", () => {
  it("resolves the request, removes it and cancels its deadline", () => {
    vi.useFakeTimers();
    const deadline = vi.fn();
    const request = pending("a", setTimeout(deadline, 30_000));

    send({ kind: "rpc.response", id: "a", success: true, result: { x: 1 } });

    expect(request.resolve).toHaveBeenCalledOnce();
    expect(request.resolve).toHaveBeenCalledWith({ x: 1 });
    expect(request.reject).not.toHaveBeenCalled();
    expect(requests.has("a")).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(deadline).not.toHaveBeenCalled();
  });

  it("rejects a failure with a plain Error that carries only the extension's text", () => {
    const request = pending("b");

    send({ kind: "rpc.response", id: "b", success: false, error: "boom" });

    expect(request.reject).toHaveBeenCalledOnce();
    expect(request.resolve).not.toHaveBeenCalled();
    const error = rejection(request);
    expect(error.constructor).toBe(Error);
    expect(error.name).toBe("Error");
    expect(error.message).toBe("boom");
    expect(Object.keys(error)).toEqual([]);
    expect("cause" in error).toBe(false);
    expect(requests.has("b")).toBe(false);
  });

  it("keeps an empty error text", () => {
    const request = pending("b2");

    send({ kind: "rpc.response", id: "b2", success: false, error: "" });

    expect(rejection(request).message).toBe("");
  });

  it("passes null and undefined results through unchanged", () => {
    const withNull = pending("null");
    const withUndefined = pending("undefined");

    send({ kind: "rpc.response", id: "null", success: true, result: null });
    send({ kind: "rpc.response", id: "undefined", success: true, result: undefined });

    expect(withNull.resolve).toHaveBeenCalledWith(null);
    expect(withUndefined.resolve).toHaveBeenCalledWith(undefined);
    expect(requests.size).toBe(0);
  });

  it("follows `success` when a response also carries the other outcome's field", () => {
    const succeeded = pending("ok");
    const failed = pending("failed");

    send({ kind: "rpc.response", id: "ok", success: true, result: 1, error: "e" });
    send({ kind: "rpc.response", id: "failed", success: false, result: 1, error: "e" });

    expect(succeeded.resolve).toHaveBeenCalledWith(1);
    expect(succeeded.reject).not.toHaveBeenCalled();
    expect(rejection(failed).message).toBe("e");
    expect(failed.resolve).not.toHaveBeenCalled();
  });

  it("settles only the request the response names", () => {
    const x = pending("x");
    const y = pending("y");

    send({ kind: "rpc.response", id: "y", success: true, result: "y" });

    expect(y.resolve).toHaveBeenCalledWith("y");
    expect(x.resolve).not.toHaveBeenCalled();
    expect([...requests.keys()]).toEqual(["x"]);
  });

  it("ignores a response for an id that is not pending", () => {
    const request = pending("d");

    expect(() => send({ kind: "rpc.response", id: "zzz", success: true, result: 1 })).not.toThrow();

    expect(request.resolve).not.toHaveBeenCalled();
    expect(request.reject).not.toHaveBeenCalled();
    expect(requests.has("d")).toBe(true);
    expect(listenerErrors).toEqual([]);
  });

  it("settles once, and ignores later responses for the same id", () => {
    const request = pending("c");

    send({ kind: "rpc.response", id: "c", success: true, result: 1 });
    send({ kind: "rpc.response", id: "c", success: true, result: 2 });
    send({ kind: "rpc.response", id: "c", success: false, error: "late" });

    expect(request.resolve).toHaveBeenCalledOnce();
    expect(request.resolve).toHaveBeenCalledWith(1);
    expect(request.reject).not.toHaveBeenCalled();
    expect(listenerErrors).toEqual([]);
  });

  it("resolves a success without a result with undefined", () => {
    const request = pending("m");

    send({ kind: "rpc.response", id: "m", success: true });

    expect(request.resolve).toHaveBeenCalledOnce();
    expect(request.resolve).toHaveBeenCalledWith(undefined);
    expect(requests.has("m")).toBe(false);
  });

  it.each([
    ["an error that is a number", { success: false, error: 42 }],
    ["an error that is an object", { success: false, error: { message: "x" } }],
    ["no error", { success: false }],
    ["no error but a result", { success: false, result: 1 }],
    ["`success` as a string", { success: "true", result: 1 }],
    ["`success` as a number", { success: 1, result: 1 }],
    ["no `success`", { result: 1 }]
  ])("rejects a malformed response with %s at once, instead of at the deadline", (_, fields) => {
    vi.useFakeTimers();
    const deadline = vi.fn();
    const request = pending("m", setTimeout(deadline, 30_000));

    send({ kind: "rpc.response", id: "m", ...fields });

    expect(request.reject).toHaveBeenCalledOnce();
    expect(request.resolve).not.toHaveBeenCalled();
    const error = rejection(request);
    expect(error.constructor).toBe(Error);
    expect(error.message).toBe(MALFORMED);
    expect(requests.has("m")).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(deadline).not.toHaveBeenCalled();
  });

  it.each([
    ["an id that is a number", { kind: "rpc.response", id: 5, success: true, result: 1 }],
    ["no id", { kind: "rpc.response", success: true, result: 1 }],
    ["no kind", { id: "m", success: true, result: 1 }],
    ["the request kind", { kind: "rpc.request", id: "m", success: true, result: 1 }],
    ["a legacy command", { command: "loadBranches", id: "m" }],
    ["a notification with the same id", { kind: "rpc.notify", id: "m", name: "x", message: null }],
    ["a string", "rpc.response"],
    ["null", null],
    ["a number", 3],
    ["an array", []],
    ["undefined", undefined]
  ])("does not settle a request for %s", (_, data) => {
    const request = pending("m");

    expect(() => send(data)).not.toThrow();

    expect(request.resolve).not.toHaveBeenCalled();
    expect(request.reject).not.toHaveBeenCalled();
    expect(requests.has("m")).toBe(true);
    expect(listenerErrors).toEqual([]);
  });

  it("does not settle a request with a notification, even a known one with the same id", () => {
    const request = pending("n1");

    send({ kind: "rpc.notify", id: "n1", name: "repo.updated", message: { path: "/nowhere" } });

    expect(request.resolve).not.toHaveBeenCalled();
    expect(request.reject).not.toHaveBeenCalled();
    expect(requests.has("n1")).toBe(true);
  });

  it("removes the entry before the callback runs, which may send more messages", () => {
    const order: string[] = [];
    let pendingInCallback: boolean | undefined;
    const r = pending("r");
    const s = pending("s");
    s.resolve.mockImplementation(() => order.push("s"));
    r.resolve.mockImplementation(() => {
      pendingInCallback = requests.has("r");
      send({ kind: "rpc.response", id: "r", success: true, result: "again" });
      send({ kind: "rpc.response", id: "s", success: true, result: "s" });
      order.push("r");
    });

    send({ kind: "rpc.response", id: "r", success: true, result: "r" });

    expect(pendingInCallback).toBe(false);
    expect(r.resolve).toHaveBeenCalledOnce();
    expect(r.resolve).toHaveBeenCalledWith("r");
    expect(s.resolve).toHaveBeenCalledWith("s");
    expect(order).toEqual(["s", "r"]);
    expect(requests.size).toBe(0);
  });
});

describe("isolation of one message from the next", () => {
  it("leaves the table consistent when a callback throws, and handles the next response", () => {
    vi.useFakeTimers();
    const deadline = vi.fn();
    const failure = new Error("callback failed");
    const throwing = pending("t", setTimeout(deadline, 30_000));
    throwing.resolve.mockImplementation(() => {
      throw failure;
    });
    const next = pending("u");

    expect(() => send({ kind: "rpc.response", id: "t", success: true, result: 1 })).not.toThrow();

    // The exception is reported like any other page error, not swallowed.
    expect(listenerErrors).toEqual([failure]);
    expect(requests.has("t")).toBe(false);
    vi.advanceTimersByTime(60_000);
    expect(deadline).not.toHaveBeenCalled();

    send({ kind: "rpc.response", id: "u", success: false, error: "next" });
    expect(rejection(next).message).toBe("next");
  });

  it("handles later messages after an action throws", () => {
    selectedRepo.value = "/a";
    selectedBranch.value = "main";
    vscodeApi.postMessage.mockImplementationOnce(() => {
      throw new Error("post failed");
    });
    const request = pending("c");

    expect(() => send(notification("repo.updated", { path: "/a" }))).not.toThrow();
    send({ kind: "rpc.response", id: "c", success: true, result: "c" });
    send(notification("repo.updated", { path: "/a" }));

    expect(listenerErrors).toHaveLength(1);
    expect(request.resolve).toHaveBeenCalledWith("c");
    expect(postedCommands()).toContain("loadCommits");
  });
});

describe("messages that are not RPC", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "text"],
    ["a number", 3],
    ["an array", []],
    ["a legacy message", { command: "loadBranches" }],
    ["a request", { kind: "rpc.request", id: "q", method: "repo.scan", params: null }]
  ])("ignores %s", (_, data) => {
    pending("kept");

    expect(() => send(data)).not.toThrow();

    expect(listenerErrors).toEqual([]);
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
    expect([...requests.keys()]).toEqual(["kept"]);
  });
});

describe("view.showPane", () => {
  beforeEach(() => {
    workspaceVisible.value = false;
  });

  it("opens the workspace pane and remembers it, once", () => {
    send(notification("view.showPane", { pane: "workspace" }));

    expect(workspaceVisible.value).toBe(true);
    expect(vscodeApi.setState).toHaveBeenCalledOnce();
    expect(vscodeApi.setState).toHaveBeenCalledWith(
      expect.objectContaining({ navigation: expect.objectContaining({ workspace: true }) })
    );

    send(notification("view.showPane", { pane: "workspace" }));
    send(notification("view.showPane", { pane: "refs" }));
    expect(vscodeApi.setState).toHaveBeenCalledOnce();
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["no payload", null],
    ["an unknown pane", { pane: "bogus" }],
    ["an inherited property name", { pane: "toString" }],
    ["no pane", {}],
    ["a pane that is not a string", { pane: 1 }],
    ["a bare pane name", "workspace"]
  ])("ignores a payload with %s", (_, message) => {
    send(notification("view.showPane", message));

    expect(workspaceVisible.value).toBe(false);
    expect(vscodeApi.setState).not.toHaveBeenCalled();
    expect(listenerErrors).toEqual([]);
  });
});

describe("view.goTo and view.reveal", () => {
  it("ask for the picker, whatever the payload", () => {
    send(notification("view.goTo", null));
    send(notification("view.goTo", { anything: 1 }));
    expect(goTo.openGoTo).toHaveBeenCalledTimes(2);
  });

  it("show the commit chosen in the picker", () => {
    send(notification("view.reveal", { repo: "/work/app", hash: "abc" }));
    expect(goTo.revealChoice).toHaveBeenCalledExactlyOnceWith("/work/app", "abc", false);
  });

  it("open the details of a commit revealed from an editor line, and only when asked", () => {
    send(notification("view.reveal", { repo: "/work/app", hash: "abc", details: true }));
    send(notification("view.reveal", { repo: "/work/app", hash: "def", details: "yes" }));
    expect(goTo.revealChoice.mock.calls).toEqual([
      ["/work/app", "abc", true],
      ["/work/app", "def", false]
    ]);
  });

  it.each([
    ["no payload", null],
    ["no hash", { repo: "/work/app" }],
    ["no repository", { hash: "abc" }],
    ["a hash that is not a string", { repo: "/work/app", hash: 1 }]
  ])("ignore a reveal with %s", (_, message) => {
    send(notification("view.reveal", message));
    expect(goTo.revealChoice).not.toHaveBeenCalled();
    expect(listenerErrors).toEqual([]);
  });
});

describe("repo.select", () => {
  beforeEach(() => {
    selectedRepo.value = "/a";
    repoListStore.add({ name: "a", path: "/a" });
    vscodeApi.postMessage.mockClear();
  });

  it("adds the repository to the picker before selecting it", () => {
    const add = vi.spyOn(repoListStore, "add");

    send(notification("repo.select", { name: "n", path: "/n" }));

    expect(selectedRepo.value).toBe("/n");
    expect(repoListStore.get()).toContainEqual({ name: "n", path: "/n" });
    expect(add).toHaveBeenCalledWith({ name: "n", path: "/n" });
    const selectCall = vscodeApi.postMessage.mock.calls.findIndex(
      ([message]) => (message as { command: string }).command === "selectRepo"
    );
    expect(add.mock.invocationCallOrder[0]).toBeLessThan(
      vscodeApi.postMessage.mock.invocationCallOrder[selectCall] ?? 0
    );
  });

  it("renames the entry of the repository already selected, and sends nothing", () => {
    send(notification("repo.select", { name: "a-renamed", path: "/a" }));

    expect(repoListStore.get()?.filter((repo) => repo.path === "/a")).toEqual([
      { name: "a-renamed", path: "/a" }
    ]);
    expect(selectedRepo.value).toBe("/a");
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["no payload", null],
    ["no path", { name: "nopath" }],
    ["a path that is not a string", { name: "x", path: 5 }],
    ["no name", { path: "/nameless" }],
    ["an array", [{ name: "x", path: "/x" }]]
  ])("ignores a payload with %s", (_, message) => {
    const before = repoListStore.get();

    send(notification("repo.select", message));

    expect(repoListStore.get()).toBe(before);
    expect(selectedRepo.value).toBe("/a");
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
    expect(listenerErrors).toEqual([]);
  });
});

describe("repo.updated", () => {
  beforeEach(() => {
    selectedRepo.value = "/a";
    selectedBranch.value = "main";
    vscodeApi.postMessage.mockClear();
  });

  it("reloads the selected repository before the dispatch returns", () => {
    send(notification("repo.updated", { path: "/a" }));

    expect(vscodeApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "loadBranches", repo: "/a" })
    );
    expect(vscodeApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "repositoryQuery", repo: "/a" })
    );
    expect(vscodeApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "loadCommits", repo: "/a", branchName: "main" })
    );
  });

  it("ignores another path, a path that differs only in form, and a page with no selection", () => {
    send(notification("repo.updated", { path: "/b" }));
    send(notification("repo.updated", { path: "/a/" }));
    selectedRepo.value = undefined;
    send(notification("repo.updated", { path: "/a" }));

    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["no payload", null],
    ["no path", {}],
    ["a path that is not a string", { path: 1 }]
  ])("ignores a payload with %s", (_, message) => {
    send(notification("repo.updated", message));

    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
    expect(listenerErrors).toEqual([]);
  });
});

describe("config.changed", () => {
  it("passes the payload itself to the settings", () => {
    selectedRepo.value = "/a";
    selectedBranch.value = "main";
    const config: WebviewConfig = { ...getWebviewConfig(), initialLoadCommits: 500 };
    maxCommits.value = 300;

    send(notification("config.changed", config));

    expect(getWebviewConfig()).toBe(config);
    expect(maxCommits.value).toBe(500);
    expect(vscodeApi.postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ command: "loadCommits", repo: "/a", maxCommits: 500 })
    );
  });

  it.each([
    ["null", null],
    ["a string", "text"],
    ["a number", 42],
    ["an array", []]
  ])("ignores a payload that is %s", (_, message) => {
    const config = getWebviewConfig();
    maxCommits.value = 300;

    send(notification("config.changed", message));

    expect(getWebviewConfig()).toBe(config);
    expect(maxCommits.value).toBe(300);
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
    expect(listenerErrors).toEqual([]);
  });
});

describe("notification envelope", () => {
  beforeEach(() => {
    selectedRepo.value = "/a";
    selectedBranch.value = "main";
    vscodeApi.postMessage.mockClear();
  });

  const refresh = { name: "repo.updated", message: { path: "/a" } };

  it.each([
    [
      "an unknown name",
      { kind: "rpc.notify", id: "x", name: "repo.deleted", message: { path: "/a" } }
    ],
    ["a name in another case", { ...notification("Repo.Updated", { path: "/a" }) }],
    ["an inherited property name", { ...notification("toString", { path: "/a" }) }],
    ["the prototype's name", { ...notification("__proto__", { path: "/a" }) }],
    ["no id", { kind: "rpc.notify", ...refresh }],
    ["an id that is a number", { kind: "rpc.notify", id: 1, ...refresh }],
    ["no name", { kind: "rpc.notify", id: "x", message: { path: "/a" } }],
    ["a name that is a number", { kind: "rpc.notify", id: "x", name: 3, message: { path: "/a" } }],
    ["no message", { kind: "rpc.notify", id: "x", name: "repo.updated" }],
    ["another kind", { kind: "rpc.notification", id: "x", ...refresh }]
  ])("ignores a notification with %s", (_, data) => {
    expect(() => send(data)).not.toThrow();

    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
    expect(listenerErrors).toEqual([]);
  });

  it.each([
    ["an empty id", { kind: "rpc.notify", id: "", ...refresh }],
    ["response fields", { kind: "rpc.notify", id: "x", success: true, result: 1, ...refresh }],
    ["a legacy command", { kind: "rpc.notify", id: "x", command: "refresh", ...refresh }]
  ])("handles a notification with %s", (_, data) => {
    send(data);

    expect(postedCommands()).toEqual(expect.arrayContaining(["loadBranches", "loadCommits"]));
  });
});
