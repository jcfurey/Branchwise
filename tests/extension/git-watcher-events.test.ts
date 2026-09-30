import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { watchGitDir } from "@/extension/watchers/git.watcher";

type Listener = (value: unknown) => void;
type Handle = { dispose: ReturnType<typeof vi.fn> };

const host = vi.hoisted(() => ({
  steps: [] as string[],
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
        const watcher = {
          onDidCreate: subscribe("gitCreated"),
          onDidDelete: subscribe("gitDeleted"),
          dispose: vi.fn()
        };
        host.handles.set("watcher", watcher);
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
vi.mock("@/extension/util/logger", () => ({
  logger: { info: (message: string) => host.steps.push(`info ${message}`) }
}));
vi.mock("@/extension/workspace-scan", () => ({
  invalidateWorkspaceScan: () => host.steps.push("invalidate")
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
  host.watcherArgs = [];
  host.listeners.clear();
  host.handles.clear();
  subscription = watchGitDir();
});
afterEach(() => {
  subscription.dispose();
  vi.useRealTimers();
});

const RESCAN = ["invalidate", "notify repo.rescan null"];

it("watches for .git entries being created or deleted, but not changed", () => {
  expect(host.watcherArgs).toEqual([["**/.git", false, true, false]]);
  expect([...host.listeners.keys()].toSorted()).toEqual(["folders", "gitCreated", "gitDeleted"]);
});

it("rescans once for a burst of events on one .git entry", () => {
  const entry = gitEntry("/ws/a/.git");
  host.listeners.get("gitCreated")!(entry);
  vi.advanceTimersByTime(50);
  host.listeners.get("gitCreated")!(entry);
  vi.advanceTimersByTime(50);
  host.listeners.get("gitCreated")!(entry);
  vi.advanceTimersByTime(99);
  expect(host.steps).toEqual([]);
  vi.advanceTimersByTime(1);
  expect(host.steps).toEqual(["info Git directory created: /ws/a/.git", ...RESCAN]);
});

it("rescans for each .git entry and each kind of event", () => {
  host.listeners.get("gitCreated")!(gitEntry("/ws/a/.git"));
  host.listeners.get("gitCreated")!(gitEntry("/ws/b/.git"));
  host.listeners.get("gitDeleted")!(gitEntry("/ws/a/.git"));
  vi.advanceTimersByTime(100);
  expect(host.steps).toEqual([
    "info Git directory created: /ws/a/.git",
    ...RESCAN,
    "info Git directory created: /ws/b/.git",
    ...RESCAN,
    "info Git directory deleted: /ws/a/.git",
    ...RESCAN
  ]);
});

it("logs the entry before it forgets the scan and asks for a new one", () => {
  host.listeners.get("gitDeleted")!(gitEntry("/ws/gone/.git"));
  vi.advanceTimersByTime(100);
  expect(host.steps).toEqual(["info Git directory deleted: /ws/gone/.git", ...RESCAN]);
});

it("rescans at once when the workspace folders change", () => {
  host.listeners.get("folders")!({ added: [], removed: [] });
  expect(host.steps).toEqual(["info Workspace folders changed", ...RESCAN]);
});

it("disposes everything it started and cancels waiting rescans", () => {
  host.listeners.get("gitCreated")!(gitEntry("/ws/a/.git"));
  subscription.dispose();
  vi.advanceTimersByTime(1000);
  expect(host.steps).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
  for (const name of ["watcher", "gitCreated", "gitDeleted", "folders"]) {
    expect(host.handles.get(name)!.dispose, name).toHaveBeenCalledOnce();
  }
});
