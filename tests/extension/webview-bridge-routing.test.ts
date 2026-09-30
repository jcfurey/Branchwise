import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Webview } from "vscode";

import { logger } from "@/extension/util/logger";
import { webviewBridgeFactory } from "@/old-extension/webviewBridge";

vi.mock("@/extension/util/logger", () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));

/** A bridge over a webview double that lets the test play the page. */
function connect() {
  const unsubscribe = vi.fn();
  const onDidReceiveMessage = vi.fn((_listener: (message: unknown) => Promise<void>) => ({
    dispose: unsubscribe
  }));
  const postMessage = vi.fn();
  const bridge = webviewBridgeFactory({ onDidReceiveMessage, postMessage } as unknown as Webview);
  const listener = onDidReceiveMessage.mock.calls[0]![0];
  return { bridge, listener, onDidReceiveMessage, postMessage, unsubscribe };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("a new bridge", () => {
  it("subscribes to the page once, with the listener alone, and posts nothing", () => {
    const { onDidReceiveMessage, postMessage } = connect();

    expect(onDidReceiveMessage).toHaveBeenCalledOnce();
    expect(onDidReceiveMessage.mock.calls[0]).toHaveLength(1);
    expect(postMessage).not.toHaveBeenCalled();
  });

  it("ends its subscription on every dispose", () => {
    const { bridge, unsubscribe } = connect();

    bridge.dispose();
    bridge.dispose();

    expect(unsubscribe).toHaveBeenCalledTimes(2);
  });
});

describe("routing", () => {
  it("runs the latest handler of a command, within the delivering call", async () => {
    const { bridge, listener } = connect();
    const replaced = vi.fn();
    const current = vi.fn();
    bridge.onMessage("selectRepo", replaced);
    bridge.onMessage("selectRepo", current);
    const message = { command: "selectRepo", repo: "/a" };

    const delivered = listener(message);
    expect(current).toHaveBeenCalledExactlyOnceWith(message);
    expect(current.mock.calls[0]![0]).toBe(message);
    await expect(delivered).resolves.toBeUndefined();
    expect(replaced).not.toHaveBeenCalled();
  });

  it("waits for a handler that is still working", async () => {
    const { bridge, listener } = connect();
    const work = Promise.withResolvers<void>();
    bridge.onMessage("selectRepo", () => work.promise);
    let settled = false;

    const delivered = listener({ command: "selectRepo", repo: "/a" }).then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);
    work.resolve();
    await delivered;
    expect(settled).toBe(true);
  });

  // Decision bridge Q4: anything but an object with a string command is ignored quietly.
  it.each([
    ["an unknown command", { command: "nope" }],
    ["RPC traffic", { kind: "rpc.request", id: 1 }],
    ["an inherited name", { command: "toString" }],
    ["a constructor name", { command: "constructor" }],
    ["a command that is not a string", { command: 7 }],
    ["null", null],
    ["undefined", undefined],
    ["a bare string", "selectRepo"]
  ])("ignores %s", async (_case, message) => {
    const { bridge, listener, postMessage } = connect();
    const handler = vi.fn();
    bridge.onMessage("selectRepo", handler);

    await expect(listener(message)).resolves.toBeUndefined();

    expect(handler).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("keeps no messages for handlers registered later", async () => {
    const { bridge, listener } = connect();
    const late = vi.fn();

    await listener({ command: "selectRepo", repo: "/early" });
    bridge.onMessage("selectRepo", late);
    await listener({ command: "selectRepo", repo: "/late" });

    expect(late.mock.calls).toEqual([[{ command: "selectRepo", repo: "/late" }]]);
  });
});

// Decision bridge Q1: failures are logged with the command's name and never escape.
describe("a failing handler", () => {
  it("is logged when it throws before returning", async () => {
    const { bridge, listener } = connect();
    const failure = new Error("sync failure");
    bridge.onMessage("saveRepoState", () => {
      throw failure;
    });

    const delivered = listener({ command: "saveRepoState", repo: "/a", state: {} });

    expect(delivered).toBeInstanceOf(Promise);
    await expect(delivered).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("saveRepoState"),
      failure
    );
  });

  it("is logged when its promise rejects", async () => {
    const { bridge, listener } = connect();
    const failure = new Error("async failure");
    bridge.onMessage("viewDiff", () => Promise.reject(failure));

    await expect(listener({ command: "viewDiff", repo: "/a" })).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("viewDiff"),
      failure
    );
  });
});

describe("posting", () => {
  it("hands the message over unchanged and returns VS Code's answer", () => {
    const { bridge, postMessage } = connect();
    const answer = Promise.resolve(true);
    postMessage.mockReturnValueOnce(answer);
    const message = { command: "refresh" } as const;

    expect(bridge.post(message)).toBe(answer);
    expect(postMessage).toHaveBeenCalledExactlyOnceWith(message);
    expect(postMessage.mock.calls[0]![0]).toBe(message);
  });

  it("leaves a refused post to its caller, even after dispose", async () => {
    const { bridge, postMessage } = connect();
    const refusal = new Error("Webview is disposed");
    postMessage.mockImplementationOnce(() => Promise.reject(refusal));

    bridge.dispose();

    await expect(bridge.post({ command: "refresh" })).rejects.toBe(refusal);
  });
});
