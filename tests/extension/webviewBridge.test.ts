import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { Disposable, Webview } from "vscode";

import {
  muteGitRepoWatcher,
  selectWatchedRepo,
  unmuteGitRepoWatcher,
  watchGitRepo
} from "@/extension/watchers/git-repo.watcher";
import { webviewBridgeFactory } from "@/old-extension/webviewBridge";
import type { RequestMessage } from "@/types";

type FileEvent = { fsPath: string };

const host = vi.hoisted(() => ({
  /** Every file-system watcher the code under test created, in order. */
  watchers: [] as { base: string; fireChange?: (event: FileEvent) => void }[],
  notify: vi.fn(),
  debug: vi.fn(),
  warn: vi.fn()
}));

vi.mock("vscode", () => ({
  workspace: {
    createFileSystemWatcher: (pattern: { base: string }) => {
      const watcher: (typeof host.watchers)[number] = { base: pattern.base };
      host.watchers.push(watcher);
      return {
        onDidCreate: () => {},
        onDidChange: (listener: (event: FileEvent) => void) => {
          watcher.fireChange = listener;
        },
        onDidDelete: () => {},
        dispose: () => {}
      };
    }
  },
  RelativePattern: class {
    readonly base: string;
    readonly pattern: string;
    constructor(base: string, pattern: string) {
      this.base = base;
      this.pattern = pattern;
    }
  }
}));
vi.mock("@/extension/rpc/rpc-notify", () => ({ rpcNotify: { notify: host.notify } }));
vi.mock("@/extension/util/logger", () => ({ logger: { debug: host.debug, warn: host.warn } }));

// Every path belongs to this file: a new folder, and inside it a repository folder that is never
// created. Git cannot look the missing folder up, so only its work tree is watched.
let scratch = "";
let repo = "";
beforeAll(() => {
  scratch = mkdtempSync(join(tmpdir(), "bw-bridge-"));
  repo = join(scratch, "absent-repo");
});
afterAll(() => {
  rmSync(scratch, { recursive: true, force: true });
});

let lifetime: Disposable;
beforeEach(async () => {
  vi.clearAllMocks();
  host.watchers.length = 0;
  lifetime = watchGitRepo();
  selectWatchedRepo(repo, "git");
  // The failed lookup is reported a few microtasks later; wait for it with the real clock.
  await new Promise((resolve) => setImmediate(resolve));
  expect(host.watchers.map((watcher) => watcher.base)).toEqual([repo]);
  expect(host.warn).toHaveBeenCalledExactlyOnceWith(
    expect.stringContaining(repo),
    expect.anything()
  );
  host.warn.mockClear();
  // The watcher times its delays with setTimeout and its quiet periods with performance.now().
  vi.useFakeTimers();
});
afterEach(() => {
  // Every test finishes its actions; ending the lifetime clears their quiet periods.
  lifetime.dispose();
  vi.useRealTimers();
});

function changeAFile() {
  host.watchers[0]!.fireChange!({ fsPath: join(repo, "file") });
}

/** A change is reported 250 ms later, once and for the watched repository. */
function expectRefresh() {
  changeAFile();
  vi.advanceTimersByTime(249);
  expect(host.notify).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1);
  expect(host.notify).toHaveBeenCalledExactlyOnceWith("repo.updated", { path: repo });
  host.notify.mockClear();
}

/** A change goes unreported. */
function expectSilence() {
  changeAFile();
  vi.advanceTimersByTime(250);
  expect(host.notify).not.toHaveBeenCalled();
}

/** A bridge over a stand-in page that the test speaks for. */
function openPage() {
  let listener: ((message: unknown) => unknown) | undefined;
  const unsubscribe = vi.fn();
  const postMessage = vi.fn((_message: unknown) => Promise.resolve(false));
  const webview = {
    onDidReceiveMessage: (received: (message: unknown) => unknown) => {
      listener = received;
      return { dispose: unsubscribe };
    },
    postMessage
  };
  const bridge = webviewBridgeFactory(webview as unknown as Webview);
  /** What the bridge's listener returns for `message`. */
  const deliver = (message: unknown) => listener!(message);
  return { bridge, deliver, postMessage, unsubscribe };
}

const selectRepo = (): RequestMessage => ({ command: "selectRepo", repo });

describe("the page connection", () => {
  it("ends its subscription to the page when disposed", () => {
    const page = openPage();
    expect(page.unsubscribe).not.toHaveBeenCalled();

    page.bridge.dispose();

    expect(page.unsubscribe).toHaveBeenCalledOnce();
  });

  it("hands a message to the page and returns the page's answer", async () => {
    const page = openPage();
    const message = { command: "fileHistory", repo, path: "f" } as const;

    await expect(page.bridge.post(message)).resolves.toBe(false);

    expect(page.postMessage).toHaveBeenCalledExactlyOnceWith(message);
  });

  it("logs a handler's rejection with its command instead of passing it on", async () => {
    const page = openPage();
    const failure = new Error("failed");
    page.bridge.onMessage("selectRepo", () => Promise.reject(failure));

    await expect(page.deliver(selectRepo())).resolves.toBeUndefined();

    expect(host.warn).toHaveBeenCalledOnce();
    expect(host.warn.mock.calls[0]![0]).toContain("selectRepo");
    expect(host.warn.mock.calls[0]![1]).toBe(failure);
  });

  it("logs a handler that throws before returning in the same way", async () => {
    const page = openPage();
    const failure = new Error("failed at once");
    page.bridge.onMessage("selectRepo", () => {
      throw failure;
    });

    await expect(page.deliver(selectRepo())).resolves.toBeUndefined();

    expect(host.warn).toHaveBeenCalledOnce();
    expect(host.warn.mock.calls[0]![0]).toContain("selectRepo");
    expect(host.warn.mock.calls[0]![1]).toBe(failure);
  });

  it("settles messages it has no handler for, and a pending refresh still arrives", async () => {
    const page = openPage();
    const handler = vi.fn();
    page.bridge.onMessage("selectRepo", handler);

    changeAFile();
    vi.advanceTimersByTime(100);
    await expect(page.deliver({ command: "loadBranches", repo })).resolves.toBeUndefined();
    await expect(page.deliver({ kind: "rpc.request", id: "r1" })).resolves.toBeUndefined();
    await expect(page.deliver("selectRepo")).resolves.toBeUndefined();
    vi.advanceTimersByTime(149);
    expect(host.notify).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);

    expect(host.notify).toHaveBeenCalledExactlyOnceWith("repo.updated", { path: repo });
    expect(handler).not.toHaveBeenCalled();
    expect(host.warn).not.toHaveBeenCalled();
  });
});

describe("requests routed through the connection", () => {
  it("leave the watcher unmuted while they run and after they end", async () => {
    const page = openPage();
    const request = Promise.withResolvers<void>();
    page.bridge.onMessage("selectRepo", () => request.promise);

    const delivered = page.deliver(selectRepo());
    expectRefresh();
    request.resolve();
    await delivered;
    // A mute would still hold here: its quiet period lasts 1500 ms after it ends.
    vi.advanceTimersByTime(1000);
    expectRefresh();
  });

  it("leave the watcher unmuted when they fail", async () => {
    const page = openPage();
    const request = Promise.withResolvers<void>();
    page.bridge.onMessage("selectRepo", () => request.promise);

    const delivered = page.deliver(selectRepo());
    request.reject(new Error("request failed"));
    await expect(delivered).resolves.toBeUndefined();

    expectRefresh();
  });
});

describe("mutes of the watched repository", () => {
  it("ignore changes during an action and for 1500 ms after it", () => {
    muteGitRepoWatcher(repo);
    expectSilence();
    unmuteGitRepoWatcher(repo);
    vi.advanceTimersByTime(1000);
    expectSilence(); // a change 1000 ms after the action
    vi.advanceTimersByTime(500);
    expectRefresh(); // a change 1750 ms after the action
  });

  it("count changes again from exactly 1500 ms after the action", () => {
    muteGitRepoWatcher(repo);
    unmuteGitRepoWatcher(repo);
    vi.advanceTimersByTime(1499);
    expectSilence(); // a change 1499 ms after the action
    expectRefresh(); // a change 1749 ms after the action
  });

  it("need one unmute per mute, and time the quiet period from the last", () => {
    muteGitRepoWatcher(repo);
    muteGitRepoWatcher(repo);
    unmuteGitRepoWatcher(repo);
    vi.advanceTimersByTime(2000);
    expectSilence(); // one action is still running
    unmuteGitRepoWatcher(repo);
    vi.advanceTimersByTime(1500);
    expectRefresh(); // a change exactly 1500 ms after the last action
  });

  it("apply to repositories inside or around the watched one, not beside it", () => {
    const beside = join(scratch, "elsewhere");
    const inside = join(repo, "submodule");

    muteGitRepoWatcher(beside);
    expectRefresh();
    unmuteGitRepoWatcher(beside);

    muteGitRepoWatcher(inside);
    expectSilence();
    unmuteGitRepoWatcher(inside);
    vi.advanceTimersByTime(1500);

    muteGitRepoWatcher(scratch);
    expectSilence();
    unmuteGitRepoWatcher(scratch);
    vi.advanceTimersByTime(1500);
    expectRefresh();
  });
});
