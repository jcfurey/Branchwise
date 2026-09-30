// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { RpcMethod, RpcRequest } from "@/types";
import { rpcClient } from "@/webview/lib/rpc/rpc-client";

import { vscodeApi } from "@tests/webview/setup";

// The client is loaded once for the whole file, so its waiting requests and its listener carry
// over from test to test. Only one test calls `init`: the others rely on `request` to listen.

const DEADLINE = 30_000;
const TIMEOUT_TEXT = "Unanswered: {0}";

/** Exceptions thrown inside window listeners, which jsdom reports as window `error` events. */
const escaped: unknown[] = [];

function recordEscaped(event: ErrorEvent) {
  escaped.push(event.error);
  event.preventDefault();
}

beforeEach(() => {
  vscodeApi.postMessage.mockClear();
  escaped.length = 0;
  window.addEventListener("error", recordEscaped);
});

afterEach(() => {
  window.removeEventListener("error", recordEscaped);
  vi.useRealTimers();
});

/** The text on `<html>` that a timed-out request's error is made from; `undefined` removes it. */
function setTimeoutText(text: string | undefined) {
  if (text === undefined) {
    delete document.documentElement.dataset["rpcTimeout"];
  } else {
    document.documentElement.dataset["rpcTimeout"] = text;
  }
}

function lastPosted(): RpcRequest {
  const call = vscodeApi.postMessage.mock.calls.at(-1);
  if (call === undefined) {
    throw new Error("Nothing was posted");
  }
  return call[0] as RpcRequest;
}

/** The extension's successful answer to the request with `id`, delivered at once. */
function answer(id: string, result: unknown) {
  window.dispatchEvent(
    new MessageEvent("message", { data: { kind: "rpc.response", id, success: true, result } })
  );
}

type Outcome = { settled: "pending" | "fulfilled" | "rejected"; value?: unknown };

/** Follows a promise without leaving a rejection unhandled. */
function watch(promise: Promise<unknown>): Outcome {
  const outcome: Outcome = { settled: "pending" };
  void promise.then(
    (value) => {
      outcome.settled = "fulfilled";
      outcome.value = value;
    },
    (reason: unknown) => {
      outcome.settled = "rejected";
      outcome.value = reason;
    }
  );
  return outcome;
}

/** The reason `promise` rejects with; fulfilling fails the test. */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    (value) => {
      throw new Error(`Expected a rejection, but it fulfilled with ${String(value)}`);
    },
    (reason: unknown) => reason
  );
}

function oneMicrotask() {
  return Promise.resolve();
}

describe("a request", () => {
  it("posts one message with its method and params, and starts its deadline at once", () => {
    vi.useFakeTimers();
    const params = "3f9a2c1";

    const pending = rpcClient.request("clipboard.copy", params);

    expect(vi.getTimerCount()).toBe(1);
    expect(pending).toBeInstanceOf(Promise);
    expect(vscodeApi.postMessage).toHaveBeenCalledOnce();
    expect(vscodeApi.postMessage.mock.calls[0]).toHaveLength(1);
    expect(lastPosted()).toEqual({
      kind: "rpc.request",
      id: expect.any(String),
      method: "clipboard.copy",
      params
    });
    expect(lastPosted().params).toBe(params);

    answer(lastPosted().id, true);
  });

  it("passes params and method on exactly as given, even ones the types refuse", () => {
    vi.useFakeTimers();
    const unusual = { nested: ["kept", "as", "is"] };

    watch(rpcClient.request("clipboard.copy", unusual as unknown as string));
    expect(lastPosted().params).toBe(unusual);

    watch(rpcClient.request("no.such.method" as RpcMethod, undefined as never));
    const unknown = lastPosted();
    expect(unknown.method).toBe("no.such.method");
    expect(Object.hasOwn(unknown, "params")).toBe(true);
    expect(unknown.params).toBe(undefined);

    watch(rpcClient.request("settings.open", null));
    expect(Object.hasOwn(lastPosted(), "params")).toBe(true);
    expect(lastPosted().params).toBe(null);
  });

  it("settles by its own id when several are waiting", async () => {
    vi.useFakeTimers();
    const earlier = watch(rpcClient.request("repo.scan", null));
    const earlierId = lastPosted().id;
    const later = watch(rpcClient.request("repo.scan", null));
    const laterId = lastPosted().id;
    const found = { repos: [{ name: "orchard", path: "/srv/checkouts/orchard" }] };

    expect(vscodeApi.postMessage).toHaveBeenCalledTimes(2);
    expect(laterId).not.toBe(earlierId);
    expect(vi.getTimerCount()).toBe(2);

    answer(laterId, found);
    expect(vi.getTimerCount()).toBe(1);
    await oneMicrotask();

    expect(later.settled).toBe("fulfilled");
    expect(later.value).toBe(found);
    expect(earlier.settled).toBe("pending");

    answer(earlierId, { repos: [] });
  });

  it("uses the API the page acquired when it loaded, even after init", () => {
    vi.useFakeTimers();
    const acquisitions = vi.mocked(acquireVsCodeApi).mock.calls.length;
    expect(acquisitions).toBeGreaterThan(0);

    rpcClient.init();
    watch(rpcClient.request("walkthrough.open", null));
    watch(rpcClient.request("git.init", null));

    expect(vi.mocked(acquireVsCodeApi).mock.calls).toHaveLength(acquisitions);
    expect(vscodeApi.postMessage).toHaveBeenCalledTimes(2);
  });
});

describe("an answer", () => {
  it("settles a request, and cancels its deadline, even while the message is being posted", async () => {
    vi.useFakeTimers();
    vscodeApi.postMessage.mockImplementationOnce((message: RpcRequest) => {
      answer(message.id, false);
    });

    const outcome = watch(rpcClient.request("settings.open", null));

    expect(vi.getTimerCount()).toBe(0);
    await oneMicrotask();
    expect(outcome).toEqual({ settled: "fulfilled", value: false });
  });

  it("reaches a newly loaded client that was never started, from its first request", async () => {
    vi.resetModules();
    const fresh = await import("@/webview/lib/rpc/rpc-client");
    vi.useFakeTimers();

    const outcome = watch(fresh.rpcClient.request("docs.open", null));
    answer(lastPosted().id, true);

    expect(vi.getTimerCount()).toBe(0);
    await oneMicrotask();
    expect(outcome).toEqual({ settled: "fulfilled", value: true });
  });
});

describe("the deadline", () => {
  beforeEach(() => {
    setTimeoutText(TIMEOUT_TEXT);
  });

  it("rejects with the page's own text for a timeout, in the page's language", async () => {
    setTimeoutText("La extensión no respondió: {0}");
    vi.useFakeTimers();
    const failure = rejectionOf(rpcClient.request("clipboard.copy", "9e8d7c"));

    await vi.runAllTimersAsync();

    const error = await failure;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("La extensión no respondió: clipboard.copy");
  });

  it("falls exactly 30 seconds after the request, and a late answer does not undo it", async () => {
    vi.useFakeTimers();
    const outcome = watch(rpcClient.request("docs.open", null));
    const { id } = lastPosted();

    await vi.advanceTimersByTimeAsync(DEADLINE - 1);
    expect(outcome.settled).toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.settled).toBe("rejected");
    expect(outcome.value).toBeInstanceOf(Error);
    expect(vi.getTimerCount()).toBe(0);
    const expired = outcome.value;

    answer(id, true);
    await oneMicrotask();
    expect(outcome.settled).toBe("rejected");
    expect(outcome.value).toBe(expired);
    expect(escaped).toEqual([]);
  });

  it("rejects with a plain Error that names the method", async () => {
    vi.useFakeTimers();
    const failure = rejectionOf(rpcClient.request("docs.open", null));

    await vi.advanceTimersByTimeAsync(DEADLINE);

    const error = await failure;
    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ name: "Error", message: "Unanswered: docs.open" });
  });

  it("rejects with an empty message when the page carries no text for it", async () => {
    setTimeoutText(undefined);
    vi.useFakeTimers();
    const failure = rejectionOf(rpcClient.request("clipboard.copy", "0c0ffee"));

    await vi.advanceTimersByTimeAsync(DEADLINE);

    const error = await failure;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("");
  });

  it("uses the text the page carries when the deadline falls, not when the request was sent", async () => {
    setTimeoutText("sent under {0}");
    vi.useFakeTimers();
    const failure = rejectionOf(rpcClient.request("docs.open", null));

    setTimeoutText("expired under {0}");
    await vi.advanceTimersByTimeAsync(DEADLINE);

    expect(((await failure) as Error).message).toBe("expired under docs.open");
  });

  it("gives every request a deadline of its own", async () => {
    vi.useFakeTimers();
    const first = watch(rpcClient.request("docs.open", null));
    await vi.advanceTimersByTimeAsync(12_000);
    const second = watch(rpcClient.request("settings.open", null));

    await vi.advanceTimersByTimeAsync(DEADLINE - 12_000);
    expect(first.settled).toBe("rejected");
    expect(second.settled).toBe("pending");
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(12_000 - 1);
    expect(second.settled).toBe("pending");

    await vi.advanceTimersByTimeAsync(1);
    expect(second.settled).toBe("rejected");
    expect((second.value as Error).message).toBe("Unanswered: settings.open");
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([
    ["{0} / {0}", "docs.open", "docs.open / docs.open"],
    ["nothing to fill in", "docs.open", "nothing to fill in"],
    ["{2} {0} $& {0}!", "settings.open", "{2} settings.open $& settings.open!"],
    ["said $&", "p$&q", "said $&"],
    ["said {0}", "p$&q", "said p$&q"],
    ["{0}", "$'$`$$", "$'$`$$"]
  ])("fills %j for method %j as %j", async (text, method, message) => {
    setTimeoutText(text);
    vi.useFakeTimers();
    const failure = rejectionOf(rpcClient.request(method as "docs.open", null));

    await vi.advanceTimersByTimeAsync(DEADLINE);

    expect(((await failure) as Error).message).toBe(message);
  });
});

describe("a message that cannot be posted", () => {
  it("rejects with the error from posting, without throwing, and without a deadline", async () => {
    vi.useFakeTimers();
    const cloneFailure = new Error("could not clone the message");
    vscodeApi.postMessage.mockImplementationOnce(() => {
      throw cloneFailure;
    });

    let outcome: Outcome | undefined;
    expect(() => {
      outcome = watch(rpcClient.request("clipboard.copy", "5b5b5b"));
    }).not.toThrow();
    await oneMicrotask();

    expect(outcome).toEqual({ settled: "rejected", value: cloneFailure });
    expect(outcome?.value).toBe(cloneFailure);
    expect(vi.getTimerCount()).toBe(0);

    // The mock recorded the message although it threw; an answer to it must change nothing.
    answer(lastPosted().id, true);
    await oneMicrotask();
    expect(outcome?.settled).toBe("rejected");
    expect(outcome?.value).toBe(cloneFailure);
    expect(escaped).toEqual([]);
  });

  it("wraps something thrown that is not an Error, keeping it as the cause", async () => {
    vi.useFakeTimers();
    const thrown = "the channel is closed";
    vscodeApi.postMessage.mockImplementationOnce(() => {
      throw thrown;
    });

    const error = await rejectionOf(rpcClient.request("clipboard.copy", "5b5b5b"));

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: thrown, cause: thrown });
    expect(vi.getTimerCount()).toBe(0);
  });
});
