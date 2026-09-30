import { beforeEach, expect, it, vi } from "vitest";

import { watchGitDir } from "@/extension/watchers/git.watcher";

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  invalidate: vi.fn(),
  listeners: {} as Record<string, (value: unknown) => void>
}));

vi.mock("vscode", () => {
  const listen = (name: string) => (listener: (value: unknown) => void) => {
    mocks.listeners[name] = listener;
    return { dispose: () => {} };
  };
  return {
    workspace: {
      createFileSystemWatcher: () => ({
        onDidCreate: listen("create"),
        onDidDelete: listen("delete"),
        dispose: () => {}
      }),
      onDidChangeWorkspaceFolders: listen("folders")
    },
    Disposable: { from: () => ({ dispose: () => {} }) }
  };
});
vi.mock("@/extension/rpc/rpc-notify", () => ({ rpcNotify: { notify: mocks.notify } }));
vi.mock("@/extension/workspace-scan", () => ({ invalidateWorkspaceScan: mocks.invalidate }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  watchGitDir();
});

it("rescans when the workspace folders change", () => {
  mocks.listeners.folders!({ added: [], removed: [] });
  expect(mocks.invalidate).toHaveBeenCalledOnce();
  expect(mocks.notify).toHaveBeenCalledExactlyOnceWith("repo.rescan", null);
});

it.each(["create", "delete"])(
  "lets the depth-limited scan decide what a .git %s event changes",
  async (event) => {
    const uri = { fsPath: "/ws/a/b/c/d/e/.git", toString: () => "file:///ws/a/b/c/d/e/.git" };
    mocks.listeners[event]!(uri);
    await vi.runAllTimersAsync();
    expect(mocks.invalidate).toHaveBeenCalledOnce();
    expect(mocks.notify.mock.calls).toEqual([["repo.rescan", null]]);
  }
);
