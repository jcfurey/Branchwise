import { beforeEach, expect, it, vi } from "vitest";
import type * as vscode from "vscode";

import type {
  GitRepo,
  RepoUpdate,
  RpcNotification,
  RpcNotificationMap,
  RpcNotificationName,
  WebviewConfig
} from "@/types";

const mocks = vi.hoisted(() => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

// Callers import the module under VS Code mocks that lack most of the API, so it must need none.
vi.mock("vscode", () => ({}));
vi.mock("@/extension/util/logger", () => ({ logger: mocks.logger }));

type Module = typeof import("@/extension/rpc/rpc-notify");
let mod: Module;
let initRpcNotify: Module["initRpcNotify"];
let rpcNotify: Module["rpcNotify"];

beforeEach(async () => {
  vi.clearAllMocks();
  // The attachment is module state, so each test starts from a fresh, detached copy.
  vi.resetModules();
  mod = await import("@/extension/rpc/rpc-notify");
  ({ initRpcNotify, rpcNotify } = mod);
});

/** A stand-in for the graph webview; `post` decides what `postMessage` returns. */
function fakeWebview(post: (message: unknown) => unknown = async () => true) {
  return { postMessage: vi.fn(post) };
}
type FakeWebview = ReturnType<typeof fakeWebview>;

const attach = (fake: FakeWebview) => initRpcNotify(fake as unknown as vscode.Webview);

/** Everything a fake webview received, in order. */
const received = (fake: FakeWebview) =>
  fake.postMessage.mock.calls.map(([message]) => message as RpcNotification);

/** The one message a fake webview received, passed as the only argument. */
function onlyMessage(fake: FakeWebview) {
  expect(fake.postMessage).toHaveBeenCalledTimes(1);
  expect(fake.postMessage.mock.calls[0]).toHaveLength(1);
  return (fake.postMessage.mock.calls[0]?.[0] ?? {}) as RpcNotification;
}

/** Let pending promise callbacks and rejection tracking run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Report whether `promise` has settled yet. */
function watch(promise: Promise<unknown>) {
  const state = { settled: false };
  const done = () => {
    state.settled = true;
  };
  void promise.then(done, done);
  return state;
}

const otherLevels = () => [mocks.logger.info, mocks.logger.warn, mocks.logger.error];

it("exports only the notifier and the function that attaches a webview", () => {
  expect(Object.keys(mod).toSorted()).toEqual(["initRpcNotify", "rpcNotify"]);
  expect(Object.keys(rpcNotify)).toEqual(["notify"]);
  expect(rpcNotify.notify).toHaveLength(2);
  expect(initRpcNotify).toHaveLength(1);
});

it("does nothing on import", async () => {
  for (const level of [mocks.logger.debug, ...otherLevels()]) {
    expect(level).not.toHaveBeenCalled();
  }
  await expect(rpcNotify.notify("repo.rescan", null)).resolves.toBeUndefined();
});

it("drops a notification while no webview is attached, with one debug entry", async () => {
  const webview = fakeWebview();

  await expect(rpcNotify.notify("repo.rescan", null)).resolves.toBeUndefined();

  expect(webview.postMessage).not.toHaveBeenCalled();
  expect(mocks.logger.debug).toHaveBeenCalledTimes(1);
  expect(mocks.logger.debug.mock.calls[0]).toEqual([expect.stringContaining("repo.rescan")]);
  otherLevels().forEach((level) => expect(level).not.toHaveBeenCalled());
});

it("posts one envelope that carries the payload itself", async () => {
  const webview = fakeWebview();
  attach(webview);
  const payload = { path: "/repo" };

  await expect(rpcNotify.notify("repo.updated", payload)).resolves.toBeUndefined();

  const notification = onlyMessage(webview);
  expect(Object.keys(notification).toSorted()).toEqual(["id", "kind", "message", "name"]);
  expect(notification.kind).toBe("rpc.notify");
  expect(notification.name).toBe("repo.updated");
  expect(notification.message).toBe(payload);
  expect(notification.id).toEqual(expect.any(String));
  expect(notification.id).not.toBe("");
});

it("keeps a null payload", async () => {
  const webview = fakeWebview();
  attach(webview);

  await rpcNotify.notify("repo.rescan", null);

  const notification = onlyMessage(webview);
  expect("message" in notification).toBe(true);
  expect(notification.message).toBeNull();
});

it("sends an undefined payload as null, so the webview still sees the message key", async () => {
  const webview = fakeWebview((message) => JSON.parse(JSON.stringify(message)));
  attach(webview);

  await rpcNotify.notify("repo.rescan", undefined as unknown as null);
  await rpcNotify.notify("repo.updated", undefined as unknown as RepoUpdate);

  const wire = webview.postMessage.mock.results.map(({ value }) => value);
  expect(wire).toEqual([
    { kind: "rpc.notify", id: expect.any(String), name: "repo.rescan", message: null },
    { kind: "rpc.notify", id: expect.any(String), name: "repo.updated", message: null }
  ]);
});

it("gives every notification in the session an id that no other uses", async () => {
  const first = fakeWebview();
  const second = fakeWebview();
  const burst = () => Array.from({ length: 50 }, () => rpcNotify.notify("repo.rescan", null));

  attach(first);
  await Promise.all(burst());
  const handle = attach(second);
  await Promise.all(burst());
  handle.dispose();
  attach(first);
  await Promise.all(burst());

  const ids = [...received(first), ...received(second)].map(({ id }) => id);
  expect(ids).toHaveLength(150);
  ids.forEach((id) => expect(id).toEqual(expect.any(String)));
  expect(new Set(ids).size).toBe(150);
});

it("posts before notify returns", () => {
  const webview = fakeWebview();
  attach(webview);

  void rpcNotify.notify("repo.rescan", null);

  expect(webview.postMessage).toHaveBeenCalledTimes(1);
});

it("keeps call order, ahead of a message the caller posts directly afterwards", async () => {
  const webview = fakeWebview();
  attach(webview);

  void rpcNotify.notify("repo.rescan", null);
  void rpcNotify.notify("repo.updated", { path: "/p" });
  void webview.postMessage({ command: "fileHistory" });
  await settle();

  expect(webview.postMessage.mock.calls.map(([message]) => message)).toEqual([
    expect.objectContaining({ kind: "rpc.notify", name: "repo.rescan" }),
    expect.objectContaining({ kind: "rpc.notify", name: "repo.updated" }),
    { command: "fileHistory" }
  ]);
});

it("sends only to the webview attached last", async () => {
  const first = fakeWebview();
  const second = fakeWebview();
  attach(first);
  attach(second);

  await rpcNotify.notify("repo.rescan", null);

  expect(second.postMessage).toHaveBeenCalledTimes(1);
  expect(first.postMessage).not.toHaveBeenCalled();
});

it("ignores the handle of a webview that another has replaced", async () => {
  const first = fakeWebview();
  const second = fakeWebview();
  const handle = attach(first);
  attach(second);

  handle.dispose();
  await rpcNotify.notify("view.showPane", { pane: "refs" });

  expect(second.postMessage).toHaveBeenCalledTimes(1);
  expect(first.postMessage).not.toHaveBeenCalled();
});

it("drops notifications once the attached webview's handle is disposed", async () => {
  const webview = fakeWebview();
  attach(webview).dispose();

  await expect(rpcNotify.notify("repo.rescan", null)).resolves.toBeUndefined();

  expect(webview.postMessage).not.toHaveBeenCalled();
  expect(mocks.logger.debug).toHaveBeenCalledTimes(1);
});

it("does not fall back to an earlier webview when the newest one detaches", async () => {
  const first = fakeWebview();
  const second = fakeWebview();
  attach(first);
  attach(second).dispose();

  await rpcNotify.notify("repo.rescan", null);

  expect(first.postMessage).not.toHaveBeenCalled();
  expect(second.postMessage).not.toHaveBeenCalled();
});

it("tolerates disposing a handle more than once", async () => {
  const webview = fakeWebview();
  const handle = attach(webview);

  handle.dispose();
  expect(() => handle.dispose()).not.toThrow();
  await rpcNotify.notify("repo.rescan", null);

  expect(webview.postMessage).not.toHaveBeenCalled();
});

it("ends only its own attachment when the same webview is attached twice", async () => {
  const webview = fakeWebview();
  const first = attach(webview);
  const second = attach(webview);

  await rpcNotify.notify("repo.rescan", null);
  expect(webview.postMessage).toHaveBeenCalledTimes(1);

  first.dispose();
  await rpcNotify.notify("repo.rescan", null);
  expect(webview.postMessage).toHaveBeenCalledTimes(2);

  second.dispose();
  await rpcNotify.notify("repo.rescan", null);
  expect(webview.postMessage).toHaveBeenCalledTimes(2);
});

it("ignores an old handle disposed again after the same webview is reattached", async () => {
  const webview = fakeWebview();
  const old = attach(webview);
  old.dispose();
  const current = attach(webview);

  old.dispose();
  await rpcNotify.notify("repo.rescan", null);
  expect(webview.postMessage).toHaveBeenCalledTimes(1);

  current.dispose();
  await rpcNotify.notify("repo.rescan", null);
  expect(webview.postMessage).toHaveBeenCalledTimes(1);
});

it("attaches and detaches silently", () => {
  const webview = fakeWebview();
  attach(webview).dispose();

  expect(webview.postMessage).not.toHaveBeenCalled();
  for (const level of [mocks.logger.debug, ...otherLevels()]) {
    expect(level).not.toHaveBeenCalled();
  }
});

it("writes one debug entry for a delivered notification", async () => {
  attach(fakeWebview());

  await rpcNotify.notify("repo.rescan", null);

  expect(mocks.logger.debug).toHaveBeenCalledTimes(1);
  otherLevels().forEach((level) => expect(level).not.toHaveBeenCalled());
});

it("logs a notification that VS Code reports as undelivered, and still resolves", async () => {
  attach(fakeWebview(async () => false));

  await expect(rpcNotify.notify("repo.rescan", null)).resolves.toBeUndefined();

  expect(mocks.logger.debug).toHaveBeenCalledTimes(2);
  expect(mocks.logger.debug.mock.lastCall).toEqual([expect.stringContaining("repo.rescan")]);
  otherLevels().forEach((level) => expect(level).not.toHaveBeenCalled());
});

it("resolves when postMessage returns something other than a promise", async () => {
  const webview = fakeWebview(() => undefined);
  attach(webview);

  await expect(rpcNotify.notify("repo.rescan", null)).resolves.toBeUndefined();

  expect(webview.postMessage).toHaveBeenCalledTimes(1);
  expect(mocks.logger.debug).toHaveBeenCalledTimes(1);
});

it("logs a rejected post as an error and resolves", async () => {
  const failure = new Error("boom");
  attach(
    fakeWebview(async () => {
      throw failure;
    })
  );

  await expect(rpcNotify.notify("repo.rescan", null)).resolves.toBeUndefined();

  expect(mocks.logger.error).toHaveBeenCalledTimes(1);
  expect(mocks.logger.error).toHaveBeenCalledWith(expect.stringContaining("repo.rescan"), failure);
});

it("turns a post that throws into an error entry, without throwing or rejecting", async () => {
  const failure = new Error("sync");
  attach(
    fakeWebview(() => {
      throw failure;
    })
  );

  let result: Promise<void> | undefined;
  expect(() => {
    result = rpcNotify.notify("config.changed", {} as WebviewConfig);
  }).not.toThrow();

  await expect(result).resolves.toBeUndefined();
  expect(mocks.logger.error).toHaveBeenCalledTimes(1);
  expect(mocks.logger.error).toHaveBeenCalledWith(
    expect.stringContaining("config.changed"),
    failure
  );
});

it("lets callers fire and forget without an unhandled rejection", async () => {
  const unhandled = vi.fn();
  process.on("unhandledRejection", unhandled);
  try {
    attach(
      fakeWebview(async () => {
        throw new Error("rejected");
      })
    );
    void rpcNotify.notify("repo.rescan", null);
    attach(
      fakeWebview(() => {
        throw new Error("thrown");
      })
    );
    void rpcNotify.notify("repo.rescan", null);
    await settle();
    await settle();
  } finally {
    process.off("unhandledRejection", unhandled);
  }

  expect(unhandled).not.toHaveBeenCalled();
  expect(mocks.logger.error).toHaveBeenCalledTimes(2);
});

it("keeps sending to the same webview after a failed post", async () => {
  let fail = true;
  const webview = fakeWebview(async () => {
    if (fail) {
      fail = false;
      throw new Error("once");
    }
    return true;
  });
  attach(webview);

  await rpcNotify.notify("repo.rescan", null);
  await rpcNotify.notify("repo.updated", { path: "/p" });

  expect(received(webview).map(({ name }) => name)).toEqual(["repo.rescan", "repo.updated"]);
  expect(mocks.logger.error).toHaveBeenCalledTimes(1);
});

it("settles only after the post settles, even if the webview detaches meanwhile", async () => {
  const post = Promise.withResolvers<boolean>();
  const handle = attach(fakeWebview(() => post.promise));

  const result = rpcNotify.notify("repo.rescan", null);
  const state = watch(result);
  await settle();
  expect(state.settled).toBe(false);

  handle.dispose();
  await settle();
  expect(state.settled).toBe(false);

  post.resolve(true);
  await expect(result).resolves.toBeUndefined();
});

it("returns a native promise whether or not a webview is attached", async () => {
  const detached = rpcNotify.notify("repo.rescan", null);
  attach(fakeWebview());
  const attached = rpcNotify.notify("repo.rescan", null);

  expect(detached).toBeInstanceOf(Promise);
  expect(attached).toBeInstanceOf(Promise);
  await Promise.all([detached, attached]);
});

it("works when notify is called without its object", async () => {
  const webview = fakeWebview();
  attach(webview);
  const { notify } = rpcNotify;

  await notify("repo.rescan", null);

  expect(webview.postMessage).toHaveBeenCalledTimes(1);
});

it("logs the notification's name but not its payload", async () => {
  attach(fakeWebview());

  await rpcNotify.notify("repo.updated", { path: "/secret/path" });

  expect(mocks.logger.debug).toHaveBeenCalledTimes(1);
  const [entry] = mocks.logger.debug.mock.calls[0] ?? [];
  expect(entry).toContain("repo.updated");
  expect(entry).not.toContain("/secret/path");
});

it("delivers every notification in the form the webview accepts", async () => {
  const config: WebviewConfig = {
    autoCenterCommitDetailsView: true,
    conflictForecast: "localAndRemote",
    dateFormat: "Date & Time",
    dragAndDrop: true,
    graphColours: ["#0085d9"],
    graphStyle: "rounded",
    initialLoadCommits: 300,
    loadMoreCommits: 100,
    locale: "en",
    showCurrentBranchByDefault: false,
    singleKeyShortcuts: true
  };
  const repo: GitRepo = { name: "app", path: "/work/app" };
  const cases: { [N in RpcNotificationName]: RpcNotificationMap[N] } = {
    "view.showPane": { pane: "workspace" },
    "view.goTo": null,
    "view.reveal": { repo: "/work/app", hash: "a".repeat(40) },
    "repo.select": repo,
    "repo.rescan": null,
    "config.changed": config,
    "repo.updated": { path: "/work/app" }
  };
  const webview = fakeWebview((message) => JSON.parse(JSON.stringify(message)));
  attach(webview);

  const names = Object.keys(cases) as RpcNotificationName[];
  await Promise.all(names.map((name) => rpcNotify.notify(name, cases[name])));

  expect(webview.postMessage.mock.results.map(({ value }) => value)).toEqual(
    Object.entries(cases).map(([name, message]) => ({
      kind: "rpc.notify",
      id: expect.any(String),
      name,
      message
    }))
  );
});

it("rejects a payload that does not match its name at compile time", async () => {
  // Nothing is attached, so these only log; the point is that `tsc` refuses each call.
  // @ts-expect-error: repo.rescan carries no payload.
  await rpcNotify.notify("repo.rescan", {});
  // @ts-expect-error: repo.updated needs a path.
  await rpcNotify.notify("repo.updated", null);
  // @ts-expect-error: the name is not a notification.
  await rpcNotify.notify("repo.unknown", null);

  expect(mocks.logger.debug).toHaveBeenCalledTimes(3);
});
