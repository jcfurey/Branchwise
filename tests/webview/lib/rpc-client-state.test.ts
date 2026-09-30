// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcRequest } from "@/types";
import type { PendingRpcRequest } from "@/webview/lib/rpc/rpc-handler";

import { vscodeApi } from "@tests/webview/setup";

// The handler is replaced, so that the tests can see the table of waiting requests it is given.
const initRpcHandler = vi.hoisted(() =>
  vi.fn<(requests: Map<string, PendingRpcRequest>) => void>()
);
vi.mock("@/webview/lib/rpc/rpc-handler", () => ({ initRpcHandler }));

/** A page that has just loaded the client. */
async function loadClient() {
  vi.resetModules();
  const { rpcClient } = await import("@/webview/lib/rpc/rpc-client");
  return rpcClient;
}

function installedTable(): Map<string, PendingRpcRequest> {
  const table = initRpcHandler.mock.calls[0]?.[0];
  if (table === undefined) {
    throw new Error("The handler was not installed");
  }
  return table;
}

function lastPosted(): RpcRequest {
  const call = vscodeApi.postMessage.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error("Nothing was posted");
  }
  return call[0] as RpcRequest;
}

beforeEach(() => {
  initRpcHandler.mockReset();
  vscodeApi.postMessage.mockReset();
  document.documentElement.dataset["rpcTimeout"] = "No response: {0}";
  vi.useFakeTimers();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("does nothing when it is loaded", async () => {
  const addEventListener = vi.spyOn(window, "addEventListener");

  await loadClient();

  expect(initRpcHandler).not.toHaveBeenCalled();
  expect(addEventListener).not.toHaveBeenCalled();
  expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  expect(vi.getTimerCount()).toBe(0);
});

describe("init", () => {
  it("installs the handler once, with an empty table", async () => {
    const rpcClient = await loadClient();
    initRpcHandler.mockImplementation((requests) => {
      expect(requests).toBeInstanceOf(Map);
      expect(requests.size).toBe(0);
    });

    expect(rpcClient.init()).toBeUndefined();
    expect(rpcClient.init()).toBeUndefined();

    expect(initRpcHandler).toHaveBeenCalledTimes(1);
  });

  it("throws when the handler cannot be installed, and tries again on the next call", async () => {
    const rpcClient = await loadClient();
    initRpcHandler.mockImplementationOnce(() => {
      throw new Error("install failed");
    });

    expect(() => rpcClient.init()).toThrow("install failed");
    expect(rpcClient.init()).toBeUndefined();
    expect(rpcClient.init()).toBeUndefined();

    expect(initRpcHandler).toHaveBeenCalledTimes(2);
    expect(initRpcHandler.mock.calls[1]?.[0]).toBe(installedTable());
  });
});

describe("a request before init", () => {
  it("installs the handler before it posts, so that the answer is not lost", async () => {
    const rpcClient = await loadClient();
    const installsWhenPosted: number[] = [];
    vscodeApi.postMessage.mockImplementation(() => {
      installsWhenPosted.push(initRpcHandler.mock.calls.length);
    });

    void rpcClient.request("docs.open", null).catch(() => undefined);
    rpcClient.init();
    void rpcClient.request("settings.open", null).catch(() => undefined);

    expect(installsWhenPosted).toEqual([1, 1]);
    expect(initRpcHandler).toHaveBeenCalledTimes(1);
  });

  it("fails at once when the handler cannot be installed, and the next request tries again", async () => {
    const rpcClient = await loadClient();
    const error = new Error("install failed");
    initRpcHandler.mockImplementationOnce(() => {
      throw error;
    });

    const failed = rpcClient.request("docs.open", null);

    await expect(failed).rejects.toBe(error);
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);

    void rpcClient.request("docs.open", null).catch(() => undefined);

    expect(initRpcHandler).toHaveBeenCalledTimes(2);
    expect(vscodeApi.postMessage).toHaveBeenCalledTimes(1);
    expect(initRpcHandler.mock.calls[1]?.[0]).toBe(installedTable());
    expect(installedTable().size).toBe(1);
  });
});

describe("the table of waiting requests", () => {
  it("holds a request, under the id it posts, from before the post until the answer", async () => {
    const rpcClient = await loadClient();
    rpcClient.init();
    const table = installedTable();
    const heldWhenPosted: boolean[] = [];
    vscodeApi.postMessage.mockImplementation((message: RpcRequest) => {
      heldWhenPosted.push(table.has(message.id));
    });
    const answer = { repos: [] };

    const result = rpcClient.request("repo.scan", null);

    expect(heldWhenPosted).toEqual([true]);
    expect(table.size).toBe(1);
    const entry = table.get(lastPosted().id);
    expect(entry).toMatchObject({
      resolve: expect.any(Function),
      reject: expect.any(Function)
    });
    expect(entry?.timeout).toBeDefined();

    // Answer as the handler does.
    table.delete(lastPosted().id);
    clearTimeout(entry?.timeout);
    entry?.resolve(answer);

    expect(vi.getTimerCount()).toBe(0);
    await expect(result).resolves.toBe(answer);
    expect(installedTable()).toBe(table);
  });

  it("passes a rejection through as it is given", async () => {
    const rpcClient = await loadClient();
    rpcClient.init();
    const table = installedTable();
    const reason = new Error("scan failed");

    const result = rpcClient.request("repo.scan", null);
    const entry = table.get(lastPosted().id);
    table.delete(lastPosted().id);
    clearTimeout(entry?.timeout);
    entry?.reject(reason);

    await expect(result).rejects.toBe(reason);
  });

  it("forgets a request that times out", async () => {
    const rpcClient = await loadClient();
    rpcClient.init();
    const table = installedTable();

    const result = rpcClient.request("docs.open", null);
    const rejected = expect(result).rejects.toThrow("No response: docs.open");
    expect(table.size).toBe(1);

    await vi.advanceTimersByTimeAsync(30_000);

    await rejected;
    expect(table.size).toBe(0);
  });

  it("forgets a request whose message cannot be posted", async () => {
    const rpcClient = await loadClient();
    rpcClient.init();
    const table = installedTable();
    vscodeApi.postMessage.mockImplementationOnce(() => {
      throw new Error("clone failed");
    });

    const result = rpcClient.request("clipboard.copy", "x");

    expect(table.size).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    await expect(result).rejects.toThrow("clone failed");
  });
});

it("does not reuse an id after the page loads again", async () => {
  const first = await loadClient();
  void first.request("docs.open", null).catch(() => undefined);
  const firstId = lastPosted().id;

  const second = await loadClient();
  void second.request("docs.open", null).catch(() => undefined);
  const secondId = lastPosted().id;

  expect(typeof firstId).toBe("string");
  expect(typeof secondId).toBe("string");
  expect(secondId).not.toBe(firstId);
});
