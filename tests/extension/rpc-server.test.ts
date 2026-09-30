import { runInNewContext } from "node:vm";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRpcServer } from "@/extension/rpc/rpc-server";

const mocks = vi.hoisted(() => ({
  scan: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn(),
  error: vi.fn()
}));

vi.mock("vscode", () => ({}));
vi.mock("@/extension/rpc/handlers", () => ({ rpcHandlers: { "repo.scan": mocks.scan } }));
vi.mock("@/extension/util/logger", () => ({
  logger: { debug: mocks.debug, warn: mocks.warn, error: mocks.error }
}));

let receive: (message: unknown) => Promise<void>;
const postMessage = vi.fn(async () => true);

beforeEach(() => {
  vi.clearAllMocks();
  createRpcServer().attach({
    onDidReceiveMessage: (listener: (message: unknown) => Promise<void>) => {
      receive = listener;
      return { dispose: () => {} };
    },
    postMessage
  } as unknown as import("vscode").Webview);
});

const request = (method: string) => ({ kind: "rpc.request", id: "1", method, params: null });

it("answers a known method with its result", async () => {
  mocks.scan.mockResolvedValue({ repos: [] });
  await receive(request("repo.scan"));
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({
    kind: "rpc.response",
    id: "1",
    success: true,
    result: { repos: [] }
  });
});

it.each(["repo.missing", "toString", "__proto__"])(
  "refuses the unknown method %s without calling a handler",
  async (method) => {
    await receive(request(method));
    expect(postMessage).toHaveBeenCalledExactlyOnceWith({
      kind: "rpc.response",
      id: "1",
      success: false,
      error: `Unknown RPC method: ${method}`
    });
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.warn).toHaveBeenCalledOnce();
  }
);

it.each([
  ["an Error", new Error("scan failed"), "scan failed"],
  ["another value", "plain failure", "plain failure"]
])("reports a handler that throws %s", async (_name, thrown, message) => {
  mocks.scan.mockRejectedValue(thrown);
  await receive(request("repo.scan"));
  expect(postMessage).toHaveBeenCalledExactlyOnceWith({
    kind: "rpc.response",
    id: "1",
    success: false,
    error: message
  });
  expect(mocks.error).toHaveBeenCalledOnce();
});

it("ignores messages that are not RPC requests", async () => {
  await Promise.all(
    [null, "text", { command: "loadCommits" }, { kind: "rpc.request" }].map((message) =>
      receive(message)
    )
  );
  expect(postMessage).not.toHaveBeenCalled();
});

/** Attach a server (a fresh one by default) to a fake webview whose parts the test can inspect. */
function attachFake(
  deliver: (message: unknown) => Promise<boolean> = async () => true,
  server = createRpcServer()
) {
  let listener: ((message: unknown) => Promise<void>) | undefined;
  const dispose = vi.fn();
  const onDidReceiveMessage = vi.fn((registered: (message: unknown) => Promise<void>) => {
    listener = registered;
    return { dispose };
  });
  const post = vi.fn(deliver);
  const attachment = server.attach({
    onDidReceiveMessage,
    postMessage: post
  } as unknown as import("vscode").Webview);
  return {
    attachment,
    dispose,
    onDidReceiveMessage,
    postMessage: post,
    posted: () => post.mock.calls.map(([message]) => message),
    receive: (message: unknown) => {
      if (listener === undefined) {
        throw new Error("No listener registered");
      }
      return listener(message);
    }
  };
}

const requestWith = (id: string, params: unknown = null) => ({
  kind: "rpc.request",
  id,
  method: "repo.scan",
  params
});

const failure = (error: string, id = "1") => ({ kind: "rpc.response", id, success: false, error });

describe("handler results", () => {
  it("passes the request's params to the handler as its only argument", async () => {
    const params = { a: 1 };
    mocks.scan.mockResolvedValue(true);
    await attachFake().receive(requestWith("1", params));
    expect(mocks.scan).toHaveBeenCalledOnce();
    expect(mocks.scan.mock.calls[0]).toHaveLength(1);
    expect(mocks.scan.mock.calls[0]?.[0]).toBe(params);
  });

  it("answers with a value the handler returns without a promise", async () => {
    mocks.scan.mockReturnValue({ repos: [] });
    const fake = attachFake();
    await fake.receive(requestWith("1"));
    expect(fake.posted()).toEqual([
      { kind: "rpc.response", id: "1", success: true, result: { repos: [] } }
    ]);
  });

  it.each([false, 0, "", null])("treats the falsy result %j as a success", async (value) => {
    mocks.scan.mockResolvedValue(value);
    const fake = attachFake();
    await fake.receive(requestWith("1"));
    expect(fake.posted()).toStrictEqual([
      { kind: "rpc.response", id: "1", success: true, result: value }
    ]);
  });

  it.each([
    ["resolves", () => Promise.resolve(undefined)],
    ["returns", () => undefined]
  ])("sends null when the handler %s undefined, so the result survives JSON", async (_how, run) => {
    mocks.scan.mockImplementation(run);
    const fake = attachFake();
    await fake.receive(requestWith("1"));
    expect(fake.posted()).toStrictEqual([
      { kind: "rpc.response", id: "1", success: true, result: null }
    ]);
    expect(JSON.parse(JSON.stringify(fake.posted()[0]))).toHaveProperty("result", null);
  });

  it("logs neither a warning nor an error when the handler succeeds", async () => {
    mocks.scan.mockResolvedValue({ repos: [] });
    await attachFake().receive(requestWith("1"));
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("never logs params or results", async () => {
    mocks.scan.mockResolvedValue("secret result");
    await attachFake().receive(requestWith("1", "secret params"));
    const logged = JSON.stringify([mocks.debug, mocks.warn, mocks.error].map((m) => m.mock.calls));
    expect(logged).not.toContain("secret");
  });
});

describe("handler failures", () => {
  it("reports a synchronous throw like a rejection", async () => {
    mocks.scan.mockImplementation(() => {
      throw new Error("sync");
    });
    const fake = attachFake();
    await expect(fake.receive(requestWith("1"))).resolves.toBeUndefined();
    expect(fake.posted()).toEqual([failure("sync")]);
    expect(mocks.error).toHaveBeenCalledOnce();
  });

  const foreignError: unknown = runInNewContext('new Error("far")');

  it.each([
    ["a TypeError", new TypeError("tt"), "tt"],
    ["an AggregateError", new AggregateError([new Error("inner")], "agg"), "agg"],
    ["an Error without a message", new Error(""), ""],
    ["an Error from another realm", foreignError, "far"],
    ["a plain object with a message", { message: "x" }, "x"],
    ["an object whose message is not a string", { message: 5 }, "[object Object]"],
    ["a number", 42, "42"],
    ["null", null, "null"],
    ["undefined", undefined, "undefined"],
    ["a symbol", Symbol("s"), "Symbol(s)"],
    ["an object with its own toString", { toString: () => "custom" }, "custom"]
  ])("describes %s by its message or its string form", async (_name, thrown, text) => {
    mocks.scan.mockRejectedValue(thrown);
    const fake = attachFake();
    await fake.receive(requestWith("1"));
    expect(fake.posted()).toEqual([failure(text)]);
    expect(mocks.error).toHaveBeenCalledOnce();
    expect(mocks.error.mock.calls[0]?.[1]).toBe(thrown);
  });

  it("uses the message of an error from another realm, which is no local Error", () => {
    expect(foreignError instanceof Error).toBe(false);
    expect(String(foreignError)).toBe("Error: far");
  });

  it.each([
    [
      "a toString that throws",
      {
        toString: () => {
          throw new Error("no string");
        }
      }
    ],
    ["no toString at all", Object.create(null) as object]
  ])("answers Unknown error for a thrown value with %s", async (_name, thrown) => {
    mocks.scan.mockRejectedValue(thrown);
    const fake = attachFake();
    await expect(fake.receive(requestWith("x"))).resolves.toBeUndefined();
    expect(fake.posted()).toEqual([failure("Unknown error", "x")]);
    expect(mocks.error).toHaveBeenCalledOnce();
  });
});

describe("unknown methods", () => {
  it("writes a warning and no error entry", async () => {
    await attachFake().receive(request("repo.missing"));
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each(["constructor", "hasOwnProperty", "", "REPO.SCAN", " repo.scan"])(
    "refuses %j, matching names exactly",
    async (method) => {
      const fake = attachFake();
      await fake.receive(request(method));
      expect(fake.posted()).toEqual([failure(`Unknown RPC method: ${method}`)]);
      expect(mocks.scan).not.toHaveBeenCalled();
    }
  );
});

describe("which messages are requests", () => {
  const ignored: [string, unknown][] = [
    ["null", null],
    ["undefined", undefined],
    ["a number", 3],
    ["a string", "text"],
    ["an array", ["rpc.request"]],
    ["a legacy command", { command: "viewReady" }],
    ["a notification", { kind: "rpc.notify", id: "1", name: "repo.rescan", message: null }],
    ["a response", { kind: "rpc.response", id: "1", method: "repo.scan", params: null }],
    ["a bare kind", { kind: "rpc.request" }],
    ["a numeric id", { kind: "rpc.request", id: 1, method: "repo.scan", params: null }],
    ["a numeric method", { kind: "rpc.request", id: "1", method: 5, params: null }],
    ["a request without params", { kind: "rpc.request", id: "1", method: "repo.scan" }],
    ["a request whose fields are all inherited", Object.create(requestWith("1")) as object],
    [
      "a request whose params are inherited",
      Object.assign(Object.create({ params: null }) as object, {
        kind: "rpc.request",
        id: "1",
        method: "repo.scan"
      })
    ],
    [
      "a request whose id is inherited",
      Object.assign(Object.create({ id: "1" }) as object, {
        kind: "rpc.request",
        method: "repo.scan",
        params: null
      })
    ]
  ];

  it.each(ignored)("ignores %s without posting, calling or logging", async (_name, message) => {
    const fake = attachFake();
    await expect(fake.receive(message)).resolves.toBeUndefined();
    expect(fake.postMessage).not.toHaveBeenCalled();
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(mocks.debug).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it.each([
    ["an empty id", requestWith(""), ""],
    ["undefined params", requestWith("1", undefined), "1"],
    ["an extra property", { ...requestWith("1"), extra: true }, "1"]
  ])("answers a request with %s", async (_name, message, id) => {
    mocks.scan.mockResolvedValue("ok");
    const fake = attachFake();
    await fake.receive(message);
    expect(fake.posted()).toEqual([{ kind: "rpc.response", id, success: true, result: "ok" }]);
  });
});

describe("responses", () => {
  it("carry exactly the protocol's keys", async () => {
    mocks.scan.mockResolvedValueOnce("ok").mockRejectedValueOnce(new Error("no"));
    const fake = attachFake();
    await fake.receive(requestWith("1"));
    await fake.receive(requestWith("2"));
    await fake.receive(request("repo.missing"));
    expect(fake.posted().map((message) => Object.keys(message as object).toSorted())).toEqual([
      ["id", "kind", "result", "success"],
      ["error", "id", "kind", "success"],
      ["error", "id", "kind", "success"]
    ]);
  });

  it.each([
    ["a success", () => Promise.resolve("ok"), request("repo.scan")],
    ["a handler failure", () => Promise.reject(new Error("no")), request("repo.scan")],
    ["an unknown-method refusal", () => Promise.resolve("ok"), request("repo.missing")]
  ])("are followed by a debug entry once %s is posted", async (_name, run, message) => {
    mocks.scan.mockImplementation(run);
    const fake = attachFake();
    await fake.receive(message);
    expect(mocks.debug).toHaveBeenCalledTimes(2);
    const postedAt = fake.postMessage.mock.invocationCallOrder[0] ?? Infinity;
    expect(mocks.debug.mock.invocationCallOrder[1]).toBeGreaterThan(postedAt);
  });

  it("are posted in the order handlers finish", async () => {
    const slow = Promise.withResolvers<string>();
    mocks.scan.mockReturnValueOnce(slow.promise).mockResolvedValueOnce("fast");
    const fake = attachFake();
    const first = fake.receive(requestWith("1"));
    await fake.receive(requestWith("2"));
    expect(fake.posted()).toEqual([
      { kind: "rpc.response", id: "2", success: true, result: "fast" }
    ]);
    slow.resolve("slow");
    await first;
    expect(fake.posted()).toEqual([
      { kind: "rpc.response", id: "2", success: true, result: "fast" },
      { kind: "rpc.response", id: "1", success: true, result: "slow" }
    ]);
  });

  it("answer every request that shares an id", async () => {
    mocks.scan.mockResolvedValue("fast");
    const fake = attachFake();
    await Promise.all([fake.receive(requestWith("dup")), fake.receive(requestWith("dup"))]);
    expect(mocks.scan).toHaveBeenCalledTimes(2);
    expect(fake.posted()).toEqual([
      { kind: "rpc.response", id: "dup", success: true, result: "fast" },
      { kind: "rpc.response", id: "dup", success: true, result: "fast" }
    ]);
  });

  it("are not retried when the webview reports one undelivered", async () => {
    mocks.scan.mockResolvedValue("ok");
    const fake = attachFake(async () => false);
    await fake.receive(requestWith("f"));
    expect(fake.postMessage).toHaveBeenCalledOnce();
    expect(mocks.error).not.toHaveBeenCalled();
  });
});

/** A postMessage that fails the first time, by throwing or rejecting, then succeeds. */
function failFirstPost(fail: () => Promise<boolean>) {
  let calls = 0;
  return (_message: unknown) => {
    calls += 1;
    return calls === 1 ? fail() : Promise.resolve(true);
  };
}

describe("delivery failures", () => {
  it.each([
    ["rejects", () => Promise.reject(new Error("post failed"))],
    [
      "throws",
      () => {
        throw new Error("post failed");
      }
    ]
  ])(
    "replace an undeliverable result with a failure for the same id when the post %s",
    async (_how, fail) => {
      mocks.scan.mockResolvedValue("value");
      const fake = attachFake(failFirstPost(fail));
      await expect(fake.receive(requestWith("1"))).resolves.toBeUndefined();
      expect(fake.posted()).toEqual([
        { kind: "rpc.response", id: "1", success: true, result: "value" },
        failure("post failed")
      ]);
      expect(mocks.error).toHaveBeenCalledOnce();
      const [entry, detail] = mocks.error.mock.calls[0] ?? [];
      expect(entry).toMatch(/deliver/i);
      expect(entry).toContain("repo.scan");
      expect(detail).toEqual(new Error("post failed"));
    }
  );

  it("are logged, not thrown, when the fallback failure cannot be delivered either", async () => {
    mocks.scan.mockResolvedValue("value");
    const fake = attachFake(() => Promise.reject(new Error("post dead")));
    await expect(fake.receive(requestWith("1"))).resolves.toBeUndefined();
    expect(fake.postMessage).toHaveBeenCalledTimes(2);
    expect(mocks.error).toHaveBeenCalledTimes(2);
  });

  it("are logged, not thrown, when a handler failure cannot be delivered", async () => {
    mocks.scan.mockRejectedValue(new Error("x"));
    const fake = attachFake(() => Promise.reject(new Error("post dead")));
    await expect(fake.receive(requestWith("1"))).resolves.toBeUndefined();
    expect(fake.postMessage).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledTimes(2);
    expect(mocks.error.mock.calls[1]?.[1]).toEqual(new Error("post dead"));
  });

  it("are logged, not thrown, when an unknown-method refusal cannot be delivered", async () => {
    const fake = attachFake(() => Promise.reject(new Error("post dead")));
    await expect(fake.receive(request("repo.missing"))).resolves.toBeUndefined();
    expect(fake.postMessage).toHaveBeenCalledOnce();
    expect(mocks.warn).toHaveBeenCalledOnce();
    expect(mocks.error).toHaveBeenCalledOnce();
  });
});

describe("attachments", () => {
  it("register one listener at attach time and do nothing else", () => {
    expect(Object.keys(createRpcServer())).toEqual(["attach"]);
    const fake = attachFake();
    expect(fake.onDidReceiveMessage).toHaveBeenCalledOnce();
    expect(fake.onDidReceiveMessage.mock.calls[0]).toHaveLength(1);
    expect(fake.onDidReceiveMessage.mock.calls[0]?.[0]).toBeTypeOf("function");
    expect(fake.postMessage).not.toHaveBeenCalled();
    expect(mocks.debug).not.toHaveBeenCalled();
    expect(mocks.warn).not.toHaveBeenCalled();
    expect(mocks.error).not.toHaveBeenCalled();
  });

  it("return a disposable that removes the listener once", () => {
    const fake = attachFake();
    fake.attachment.dispose();
    fake.attachment.dispose();
    expect(fake.dispose).toHaveBeenCalledOnce();
  });

  it("ignore requests delivered after disposal", async () => {
    const fake = attachFake();
    fake.attachment.dispose();
    await expect(fake.receive(requestWith("1"))).resolves.toBeUndefined();
    expect(mocks.scan).not.toHaveBeenCalled();
    expect(fake.postMessage).not.toHaveBeenCalled();
  });

  it.each([
    ["resolves", (pending: PromiseWithResolvers<unknown>) => pending.resolve("late")],
    ["rejects", (pending: PromiseWithResolvers<unknown>) => pending.reject(new Error("late"))]
  ])("post nothing when an in-flight handler %s after disposal", async (_how, settle) => {
    const pending = Promise.withResolvers<unknown>();
    mocks.scan.mockReturnValue(pending.promise);
    const fake = attachFake();
    const answered = fake.receive(requestWith("1"));
    fake.attachment.dispose();
    settle(pending);
    await expect(answered).resolves.toBeUndefined();
    expect(mocks.scan).toHaveBeenCalledOnce();
    expect(fake.postMessage).not.toHaveBeenCalled();
  });

  it("of one server are independent", async () => {
    mocks.scan.mockResolvedValue("ok");
    const server = createRpcServer();
    const a = attachFake(async () => true, server);
    const b = attachFake(async () => true, server);
    await a.receive(requestWith("1"));
    expect(a.postMessage).toHaveBeenCalledOnce();
    expect(b.postMessage).not.toHaveBeenCalled();
    b.attachment.dispose();
    await a.receive(requestWith("2"));
    expect(a.postMessage).toHaveBeenCalledTimes(2);
  });
});
