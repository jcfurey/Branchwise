import { expect, it, vi } from "vitest";

import { registerMessageHandlers } from "@/old-extension/messageHandler";

const mocks = vi.hoisted(() => ({
  factory: vi.fn(),
  push: vi.fn(),
  run: vi.fn(),
  mute: vi.fn(),
  unmute: vi.fn()
}));
vi.mock("vscode", () => ({
  window: {
    createOutputChannel: () => ({
      appendLine: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    })
  }
}));
vi.mock("@/backend/gitClient", () => ({ gitClientFactory: mocks.factory }));
vi.mock("@/backend/actions/remote", () => ({
  pushBranch: mocks.push,
  pullBranch: vi.fn(),
  fetchRemote: vi.fn()
}));
vi.mock("@/backend/actions/repository", () => ({ runRepositoryAction: mocks.run }));
vi.mock("@/extension/watchers/git-repo.watcher", () => ({
  selectWatchedRepo: vi.fn(),
  muteGitRepoWatcher: mocks.mute,
  unmuteGitRepoWatcher: mocks.unmute
}));

function register() {
  const handlers = new Map<string, (msg: unknown) => void | Promise<void>>();
  const post = vi.fn();
  const bridge = {
    post,
    onMessage: (command: string, handler: (msg: unknown) => void | Promise<void>) =>
      handlers.set(command, handler)
  };
  const deps = {
    config: { gitPath: () => "git" },
    gitClient: { getInstance: () => ({ repo: "/another-repo" }), setRepo: vi.fn() },
    repoManager: { getRepos: () => ({}) },
    extensionState: { setLastActiveRepo: vi.fn() },
    repoFileWatcher: { start: vi.fn() }
  };
  registerMessageHandlers(
    bridge as unknown as Parameters<typeof registerMessageHandlers>[0],
    deps as unknown as Parameters<typeof registerMessageHandlers>[1]
  );
  return { handlers, post };
}

it("runs an action against its requested repository even if the selected repository changes", async () => {
  const { handlers, post } = register();
  const boundGit = { repo: "/original-repo" };
  mocks.factory.mockReturnValue({ getInstance: () => boundGit });
  let finish!: () => void;
  mocks.push.mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      })
  );
  const request = {
    command: "pushBranch",
    repo: "/original-repo",
    requestId: "push-1",
    branchName: "main",
    remote: "origin",
    remoteBranch: "main",
    setUpstream: false
  };
  const pending = handlers.get("pushBranch")!(request);
  handlers.get("selectRepo")!({ command: "selectRepo", repo: "/another-repo" });
  // The push changes its own repository, whichever one the graph shows.
  expect(mocks.mute).toHaveBeenCalledExactlyOnceWith("/original-repo");
  expect(mocks.unmute).not.toHaveBeenCalled();
  finish();
  await pending;
  expect(mocks.unmute).toHaveBeenCalledExactlyOnceWith("/original-repo");
  expect(mocks.factory).toHaveBeenCalledWith("/original-repo", "git", expect.any(AbortSignal));
  expect(mocks.push).toHaveBeenCalledWith(boundGit, request);
  expect(post).toHaveBeenCalledWith({
    command: "pushBranch",
    repo: "/original-repo",
    requestId: "push-1",
    status: null
  });
});

it("leaves the watcher running while an action only opens an editor", async () => {
  vi.clearAllMocks();
  const { handlers, post } = register();
  mocks.factory.mockReturnValue({ getInstance: () => ({}) });
  mocks.run.mockResolvedValue(undefined);
  await handlers.get("repositoryAction")!({
    command: "repositoryAction",
    repo: "/repo",
    requestId: "view-1",
    action: { kind: "viewWorkingTreeFile", path: "f", group: "unstaged" }
  });
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ status: null }));
  expect(mocks.mute).not.toHaveBeenCalled();
  expect(mocks.unmute).not.toHaveBeenCalled();
});
