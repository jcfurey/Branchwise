import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { watchGitDir } from "@/extension/watchers/git.watcher";

type Listener = (value: unknown) => void;
type Handle = { dispose: ReturnType<typeof vi.fn> };

const host = vi.hoisted(() => ({
  steps: [] as string[],
  offered: [] as string[],
  /** The folders that hold a `.git` entry, and how many were asked about. */
  repositories: [] as string[],
  asked: [] as string[],
  watcherArgs: [] as unknown[][],
  listeners: new Map<string, Listener>(),
  handles: new Map<string, Handle>()
}));

vi.mock("vscode", () => {
  const subscribe = (name: string) => (listener: Listener) => {
    host.listeners.set(name, listener);
    const handle = { dispose: vi.fn() };
    host.handles.set(name, handle);
    return handle;
  };
  return {
    workspace: {
      createFileSystemWatcher: (...args: unknown[]) => {
        host.watcherArgs.push(args);
        // The first watcher is the one for `.git` entries, the second the one for anything else.
        const entries = args[0] === "**/.git";
        const watcher = {
          onDidCreate: subscribe(entries ? "gitCreated" : "anythingCreated"),
          onDidDelete: subscribe(entries ? "gitDeleted" : "anythingDeleted"),
          dispose: vi.fn()
        };
        host.handles.set(entries ? "watcher" : "anything", watcher);
        return watcher;
      },
      onDidChangeWorkspaceFolders: subscribe("folders")
    },
    // Unlike VS Code's, this one keeps nothing alive after its own disposal.
    Disposable: {
      from: (...items: { dispose(): unknown }[]) => ({
        dispose: () => items.forEach((item) => item.dispose())
      })
    }
  };
});
vi.mock("node:fs/promises", () => ({
  lstat: (entry: string) => {
    host.asked.push(entry);
    // On Windows the path arrives with its separators turned around.
    const asked = entry.replaceAll("\\", "/");
    return host.repositories.some((repo) => asked === `${repo}/.git`)
      ? Promise.resolve({})
      : Promise.reject(new Error("ENOENT"));
  }
}));
vi.mock("@/extension/util/logger", () => ({
  logger: { info: (message: string) => host.steps.push(`info ${message}`) }
}));
vi.mock("@/extension/workspace-scan", () => ({
  invalidateWorkspaceScan: (changed?: string[]) =>
    host.steps.push(changed ? `invalidate ${changed.join(" ")}` : "invalidate everything"),
  holdsOfferedRepo: (folder: string) => host.offered.some((repo) => repo.startsWith(folder))
}));
vi.mock("@/extension/rpc/rpc-notify", () => ({
  rpcNotify: {
    notify: (name: string, payload: unknown) =>
      host.steps.push(`notify ${name} ${JSON.stringify(payload)}`)
  }
}));

function gitEntry(fsPath: string) {
  return { fsPath, toString: () => `file://${fsPath}` };
}

let subscription: ReturnType<typeof watchGitDir>;
beforeEach(() => {
  vi.useFakeTimers();
  host.steps = [];
  host.offered = [];
  host.repositories = [];
  host.asked = [];
  host.watcherArgs = [];
  host.listeners.clear();
  host.handles.clear();
  subscription = watchGitDir();
});
afterEach(() => {
  subscription.dispose();
  vi.useRealTimers();
});

/** A rescan that was told where something came or went, or with no place, that anything may have. */
const rescanAt = (...places: string[]) => [
  places.length > 0 ? `invalidate ${places.join(" ")}` : "invalidate everything",
  "notify repo.rescan null"
];
/** How long the watcher waits for the workspace to go quiet. */
const QUIET = 250;

it("watches for .git entries, and for anything else, being created or deleted", () => {
  expect(host.watcherArgs).toEqual([
    ["**/.git", false, true, false],
    ["**", false, true, false]
  ]);
  expect([...host.listeners.keys()].toSorted()).toEqual([
    "anythingCreated",
    "anythingDeleted",
    "folders",
    "gitCreated",
    "gitDeleted"
  ]);
});

it("rescans once for a burst of events on one .git entry", () => {
  const entry = gitEntry("/ws/a/.git");
  host.listeners.get("gitCreated")!(entry);
  vi.advanceTimersByTime(100);
  host.listeners.get("gitCreated")!(entry);
  vi.advanceTimersByTime(100);
  host.listeners.get("gitCreated")!(entry);
  vi.advanceTimersByTime(QUIET - 1);
  expect(host.steps).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(host.steps).toEqual([
    "info Git directory created: /ws/a/.git",
    ...rescanAt("/ws/a/.git", "/ws/a/.git", "/ws/a/.git")
  ]);
});

it("rescans once for many .git entries that change together", () => {
  // A clone that brings its submodules creates one after another. One walk finds them all.
  host.listeners.get("gitCreated")!(gitEntry("/ws/a/.git"));
  host.listeners.get("gitCreated")!(gitEntry("/ws/b/.git"));
  vi.advanceTimersByTime(120);
  host.listeners.get("gitDeleted")!(gitEntry("/ws/c/.git"));
  vi.advanceTimersByTime(QUIET - 1);
  expect(host.steps).toEqual([]);
  vi.advanceTimersByTime(1);
  // The scan is told every place, so that it knows which repositories to look into again.
  expect(host.steps).toEqual([
    "info Git directory deleted: /ws/c/.git",
    ...rescanAt("/ws/a/.git", "/ws/b/.git", "/ws/c/.git")
  ]);
  vi.advanceTimersByTime(5000);
  expect(host.steps).toHaveLength(3);
});

it("does not wait for the end of changes that never pause", () => {
  for (let elapsed = 0; elapsed < 1900; elapsed += 100) {
    host.listeners.get("gitCreated")!(gitEntry(`/ws/${elapsed}/.git`));
    vi.advanceTimersByTime(100);
  }
  expect(host.steps).toEqual([]);
  host.listeners.get("gitCreated")!(gitEntry("/ws/last/.git"));
  vi.advanceTimersByTime(100);
  expect(host.steps[0]).toBe("info Git directory created: /ws/last/.git");
  expect(host.steps[1]).toMatch(/^invalidate \/ws\/0\/\.git .* \/ws\/last\/\.git$/);
  expect(host.steps[2]).toBe("notify repo.rescan null");
  expect(host.steps).toHaveLength(3);

  // What comes afterwards starts a wait of its own.
  host.listeners.get("gitCreated")!(gitEntry("/ws/later/.git"));
  vi.advanceTimersByTime(QUIET);
  expect(host.steps).toHaveLength(6);
});

it("rescans when a folder that holds an offered repository is deleted, renamed or moved", () => {
  // VS Code reports such a folder alone, and nothing for the `.git` entry inside it.
  host.offered = ["/ws/libs/a", "/ws/b"];
  host.listeners.get("anythingDeleted")!(gitEntry("/ws/libs"));
  vi.advanceTimersByTime(QUIET);
  expect(host.steps).toEqual(["info Repository folder deleted: /ws/libs", ...rescanAt("/ws/libs")]);
});

it("leaves the scan alone when what was deleted holds no offered repository", () => {
  host.offered = ["/ws/b"];
  host.listeners.get("anythingDeleted")!(gitEntry("/ws/dist"));
  host.listeners.get("anythingDeleted")!(gitEntry("/ws/notes.txt"));
  vi.advanceTimersByTime(5000);
  expect(host.steps).toEqual([]);
});

it("rescans when a folder arrives with a repository in it", async () => {
  // A folder moved into the workspace is reported alone, and on Linux so is a new clone, whose
  // `.git` folder is made before VS Code watches the folder around it.
  host.repositories = ["/ws/cloned"];
  host.listeners.get("anythingCreated")!(gitEntry("/ws/cloned"));
  host.listeners.get("anythingCreated")!(gitEntry("/ws/notes.txt"));
  host.listeners.get("anythingCreated")!(gitEntry("/ws/empty"));
  await vi.advanceTimersByTimeAsync(QUIET);
  expect(host.steps).toEqual([
    "info Repository folder created: /ws/cloned",
    ...rescanAt("/ws/cloned")
  ]);
});

it("looks into nothing that the scan never lists or that reports itself", async () => {
  host.repositories = ["/ws/node_modules/dep", "/ws/a/.git/modules/sub", "/ws/bower_components"];
  for (const created of [
    "/ws/node_modules/dep",
    "/ws/node_modules",
    "/ws/a/.git",
    "/ws/a/.git/modules/sub",
    "/ws/bower_components",
    "C:\\ws\\node_modules\\dep"
  ]) {
    host.listeners.get("anythingCreated")!(gitEntry(created));
  }
  await vi.advanceTimersByTimeAsync(5000);
  expect(host.asked).toEqual([]);
  expect(host.steps).toEqual([]);
});

it("looks into a few new paths at a time, and leaves the rest of a flood alone", async () => {
  for (let index = 0; index < 500; index++) {
    host.listeners.get("anythingCreated")!(gitEntry(`/ws/dist/chunk-${index}.js`));
  }
  expect(host.asked).toHaveLength(32);
  await vi.advanceTimersByTimeAsync(0);

  // Once those are answered, the next new folder is looked into again.
  host.repositories = ["/ws/later"];
  host.listeners.get("anythingCreated")!(gitEntry("/ws/later"));
  await vi.advanceTimersByTimeAsync(QUIET);
  expect(host.steps).toEqual([
    "info Repository folder created: /ws/later",
    ...rescanAt("/ws/later")
  ]);
});

it("starts no rescan for a folder it was still looking into when it was disposed", async () => {
  host.repositories = ["/ws/cloned"];
  host.listeners.get("anythingCreated")!(gitEntry("/ws/cloned"));
  subscription.dispose();
  await vi.advanceTimersByTimeAsync(5000);
  expect(host.steps).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it("logs the entry before it forgets the scan and asks for a new one", () => {
  host.listeners.get("gitDeleted")!(gitEntry("/ws/gone/.git"));
  vi.advanceTimersByTime(QUIET);
  expect(host.steps).toEqual([
    "info Git directory deleted: /ws/gone/.git",
    ...rescanAt("/ws/gone/.git")
  ]);
});

it("rescans at once when the workspace folders change", () => {
  host.listeners.get("folders")!({ added: [], removed: [] });
  expect(host.steps).toEqual(["info Workspace folders changed", ...rescanAt()]);
});

it("disposes everything it started and cancels waiting rescans", () => {
  host.listeners.get("gitCreated")!(gitEntry("/ws/a/.git"));
  subscription.dispose();
  vi.advanceTimersByTime(1000);
  expect(host.steps).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
  for (const name of [
    "watcher",
    "anything",
    "gitCreated",
    "gitDeleted",
    "anythingCreated",
    "anythingDeleted",
    "folders"
  ]) {
    expect(host.handles.get(name)!.dispose, name).toHaveBeenCalledOnce();
  }
});
