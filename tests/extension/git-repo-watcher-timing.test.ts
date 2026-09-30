import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  muteGitRepoWatcher as muteWatcher,
  selectWatchedRepo,
  unmuteGitRepoWatcher,
  watchGitRepo
} from "@/extension/watchers/git-repo.watcher";

type Kind = "created" | "changed" | "deleted";
type FileHandler = (uri: { fsPath: string }) => void;

const host = vi.hoisted(() => {
  const watchers: {
    base: string;
    handlers: Partial<Record<string, FileHandler>>;
    live: boolean;
  }[] = [];
  const createFileSystemWatcher = vi.fn((pattern: { base: string }) => {
    const entry = {
      base: pattern.base,
      handlers: {} as Partial<Record<string, FileHandler>>,
      live: true
    };
    watchers.push(entry);
    const on = (kind: string) => (handler: FileHandler) => {
      entry.handlers[kind] = handler;
    };
    return {
      onDidCreate: on("created"),
      onDidChange: on("changed"),
      onDidDelete: on("deleted"),
      dispose: () => {
        entry.live = false;
      }
    };
  });
  return {
    watchers,
    createFileSystemWatcher,
    /** Milliseconds after the test started at which each notification went out. */
    sent: [] as { at: number; name: string; payload: unknown }[],
    debug: vi.fn(),
    warn: vi.fn(),
    start: 0
  };
});
vi.mock("vscode", () => ({
  workspace: { createFileSystemWatcher: host.createFileSystemWatcher },
  // The watcher reads only the base of its pattern.
  RelativePattern: class {
    readonly base: string;
    constructor(base: string) {
      this.base = base;
    }
  }
}));
vi.mock("@/extension/rpc/rpc-notify", () => ({
  rpcNotify: {
    notify: (name: string, payload: unknown) =>
      void host.sent.push({ at: Date.now() - host.start, name, payload })
  }
}));
vi.mock("@/extension/util/logger", () => ({ logger: { debug: host.debug, warn: host.warn } }));

/** Its Git directory lookup fails, so only its work tree is watched. */
const REPO = "/nonexistent/repo";

const live = (base: string) =>
  host.watchers.filter((watcher) => watcher.live && watcher.base === base);

/** Report `relative`, below the watched work tree, as the file system would. */
function touch(relative = "file", kind: Kind = "changed", base = REPO) {
  const [watcher] = live(base);
  watcher!.handlers[kind]!({ fsPath: path.join(base, relative) });
}

const refreshes = () => host.sent.filter(({ name }) => name === "repo.updated");

let lifetime: ReturnType<typeof watchGitRepo>;
const mutes: string[] = [];
function muteGitRepoWatcher(repo: string) {
  mutes.push(repo);
  muteWatcher(repo);
}
beforeEach(() => {
  vi.useFakeTimers();
  host.start = Date.now();
  host.watchers.length = 0;
  host.sent = [];
  vi.clearAllMocks();
  lifetime = watchGitRepo();
  selectWatchedRepo(REPO, "git");
});
afterEach(() => {
  // Test actions must finish too: closing their page no longer ends their mutes.
  for (const repo of mutes.splice(0)) {
    unmuteGitRepoWatcher(repo);
  }
  lifetime.dispose();
  // Some cases already disposed their lifetime before the simulated action ended.
  watchGitRepo().dispose();
  vi.useRealTimers();
});

describe("refresh timing", () => {
  it("waits until events have stopped for 250 ms", () => {
    touch();
    vi.advanceTimersByTime(200);
    touch();
    vi.advanceTimersByTime(249);
    expect(refreshes()).toEqual([]);
    vi.advanceTimersByTime(1);
    expect(refreshes()).toEqual([{ at: 450, name: "repo.updated", payload: { path: REPO } }]);
  });

  it("logs each counted event and the refresh at debug level", () => {
    touch("file", "changed");
    vi.advanceTimersByTime(250);
    expect(host.debug.mock.calls).toEqual([
      [`Repository file changed: ${path.join(REPO, "file")}`],
      [`Sending repo.updated notification: ${REPO}`]
    ]);
  });

  it.each<Kind>(["created", "changed", "deleted"])("treats a %s file like any other", (kind) => {
    touch("file", kind);
    vi.advanceTimersByTime(250);
    expect(host.debug).toHaveBeenCalledWith(`Repository file ${kind}: ${path.join(REPO, "file")}`);
    expect(refreshes()).toHaveLength(1);
  });

  it("refreshes at least every 2 seconds while events keep coming", () => {
    for (let at = 0; at < 4000; at += 200) {
      touch();
      vi.advanceTimersByTime(200);
    }
    vi.advanceTimersByTime(1000);
    expect(refreshes().map(({ at }) => at)).toEqual([2000, 4000]);
  });

  it("measures the longest wait from the first change not yet reported", () => {
    for (let at = 0; at <= 3000; at += 200) {
      touch();
      vi.advanceTimersByTime(200);
    }
    vi.advanceTimersByTime(1000);
    expect(refreshes().map(({ at }) => at)).toEqual([2000, 3250]);
  });
});

describe("which work tree files count", () => {
  it.each([
    ["the work tree itself", ""],
    ["a file", "src/main.ts"],
    ["an ignore file", ".gitignore"],
    ["a folder whose name starts with .git", ".github/workflows/ci.yml"],
    ["a nested repository's Git directory", "sub/.git/index"],
    ["an ignored file", "node_modules/x/y"],
    // Lock files are ignored only in Git directories; here they are the user's files.
    ["a lock file", "yarn.lock"],
    ["a nested lock file", "crates/Cargo.lock"],
    ["a file named .lock", "sub/.lock"]
  ])("counts %s", (_name, relative) => {
    touch(relative);
    vi.advanceTimersByTime(250);
    expect(refreshes()).toHaveLength(1);
  });

  it.each([
    ["the .git entry", ".git"],
    ["a file in the Git directory", ".git/index"],
    ["the parent directory", ".."],
    ["a file outside", "../outside"],
    ["a lock file in the Git directory", ".git/index.lock"]
  ])("ignores %s", (_name, relative) => {
    touch(relative);
    vi.advanceTimersByTime(250);
    expect(refreshes()).toEqual([]);
    expect(host.debug).not.toHaveBeenCalled();
  });
});

describe("selection", () => {
  it("echoes the selected path exactly", () => {
    const slash = "/nonexistent/slash/";
    selectWatchedRepo(slash, "git");
    touch("file", "changed", slash);
    vi.advanceTimersByTime(250);
    expect(refreshes().map(({ payload }) => payload)).toEqual([{ path: slash }]);
  });

  it("keeps the watcher and its pending refresh when the same path is selected again", () => {
    touch();
    selectWatchedRepo(REPO, "other-git");
    vi.advanceTimersByTime(250);
    expect(refreshes()).toHaveLength(1);
    expect(host.createFileSystemWatcher).toHaveBeenCalledOnce();
  });

  it("drops the previous repository's pending refresh on a switch", () => {
    touch();
    selectWatchedRepo("/nonexistent/other", "git");
    vi.advanceTimersByTime(1000);
    expect(refreshes()).toEqual([]);
    expect(live(REPO)).toEqual([]);
    expect(live("/nonexistent/other")).toHaveLength(1);
  });

  it("ignores selections after its lifetime ends", () => {
    lifetime.dispose();
    expect(live(REPO)).toEqual([]);
    selectWatchedRepo("/nonexistent/after", "git");
    expect(host.createFileSystemWatcher).toHaveBeenCalledOnce();
  });

  it("cancels a pending refresh when its lifetime ends", () => {
    touch();
    lifetime.dispose();
    vi.advanceTimersByTime(1000);
    expect(refreshes()).toEqual([]);
  });

  it("gives selections to the newest lifetime until any lifetime ends", () => {
    const newer = watchGitRepo();
    selectWatchedRepo("/nonexistent/two", "git");
    lifetime.dispose();
    touch("file", "changed", "/nonexistent/two");
    vi.advanceTimersByTime(250);
    expect(refreshes().map(({ payload }) => payload)).toEqual([{ path: "/nonexistent/two" }]);
    selectWatchedRepo("/nonexistent/three", "git");
    expect(live("/nonexistent/three")).toEqual([]);
    newer.dispose();
    expect(live("/nonexistent/two")).toEqual([]);
  });

  it("does nothing when a lifetime is disposed a second time", () => {
    lifetime.dispose();
    const next = watchGitRepo();
    muteGitRepoWatcher(REPO);
    lifetime.dispose();
    // The newer lifetime still receives selections, and the mute still holds.
    selectWatchedRepo(REPO, "git");
    expect(live(REPO)).toHaveLength(1);
    touch();
    vi.advanceTimersByTime(250);
    expect(refreshes()).toEqual([]);
    next.dispose();
  });
});

/** Give a counted event time to become a refresh. */
const settle = () => vi.advanceTimersByTime(250);

describe("mutes", () => {
  it("ignores events until 1500 ms after the action ends", () => {
    muteGitRepoWatcher(REPO);
    unmuteGitRepoWatcher(REPO);
    vi.advanceTimersByTime(1499);
    touch();
    settle();
    expect(refreshes()).toEqual([]);
  });

  it("counts events again 1500 ms after the action ends", () => {
    muteGitRepoWatcher(REPO);
    unmuteGitRepoWatcher(REPO);
    vi.advanceTimersByTime(1500);
    touch();
    settle();
    expect(refreshes()).toHaveLength(1);
  });

  it("drops muted events instead of reporting them later", () => {
    muteGitRepoWatcher(REPO);
    touch();
    unmuteGitRepoWatcher(REPO);
    vi.advanceTimersByTime(5000);
    expect(refreshes()).toEqual([]);
  });

  it("restarts the quiet period with each action that ends", () => {
    muteGitRepoWatcher(REPO);
    unmuteGitRepoWatcher(REPO);
    vi.advanceTimersByTime(1000);
    muteGitRepoWatcher(REPO);
    unmuteGitRepoWatcher(REPO);
    vi.advanceTimersByTime(1000);
    touch();
    settle();
    expect(refreshes()).toEqual([]);
    vi.advanceTimersByTime(250);
    touch();
    settle();
    expect(refreshes()).toHaveLength(1);
  });

  it("opens no quiet period for an unmute without a mute", () => {
    unmuteGitRepoWatcher(REPO);
    touch();
    settle();
    expect(refreshes()).toHaveLength(1);
  });

  it("is not muted by a sibling whose path merely starts the same way", () => {
    muteGitRepoWatcher(`${REPO}-other`);
    touch();
    settle();
    expect(refreshes()).toHaveLength(1);
  });

  it("still sends a refresh scheduled before the mute began", () => {
    touch();
    vi.advanceTimersByTime(100);
    muteGitRepoWatcher(REPO);
    vi.advanceTimersByTime(150);
    expect(refreshes()).toHaveLength(1);
  });

  it("honours a mute from before the lifetime started", () => {
    lifetime.dispose();
    muteGitRepoWatcher(REPO);
    lifetime = watchGitRepo();
    selectWatchedRepo(REPO, "git");
    touch();
    settle();
    expect(refreshes()).toEqual([]);
  });

  it("keeps an action muted across reopening until it actually ends", () => {
    muteGitRepoWatcher(REPO);
    lifetime.dispose();
    lifetime = watchGitRepo();
    selectWatchedRepo(REPO, "git");
    touch();
    settle();
    expect(refreshes()).toEqual([]);
    unmuteGitRepoWatcher(REPO);
    vi.advanceTimersByTime(1500);
    touch();
    settle();
    expect(refreshes()).toHaveLength(1);
  });

  it("matches an unmute to its mute by the exact string", () => {
    muteGitRepoWatcher(REPO);
    unmuteGitRepoWatcher(`${REPO}/`);
    vi.advanceTimersByTime(5000);
    touch();
    settle();
    expect(refreshes()).toEqual([]);
  });
});

it("ignores selections, and mutes without VS Code, before any lifetime starts", async () => {
  vi.resetModules();
  const create = vi.fn();
  vi.doMock("vscode", () => ({ workspace: { createFileSystemWatcher: create } }));
  try {
    const fresh = await import("@/extension/watchers/git-repo.watcher");
    expect(() => {
      fresh.selectWatchedRepo("/nonexistent/x", "git");
      fresh.muteGitRepoWatcher("/nonexistent/x");
      fresh.unmuteGitRepoWatcher("/nonexistent/x");
    }).not.toThrow();
    expect(create).not.toHaveBeenCalled();
  } finally {
    vi.doUnmock("vscode");
  }
});
