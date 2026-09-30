import { beforeEach, describe, expect, it, vi } from "vitest";

import { registerMessageHandlers } from "@/old-extension/messageHandler";

const backend = vi.hoisted(() => ({
  addTag: vi.fn(),
  deleteTag: vi.fn(),
  pushTag: vi.fn(),
  createBranch: vi.fn(),
  deleteBranch: vi.fn(),
  renameBranch: vi.fn(),
  checkoutBranch: vi.fn(),
  checkoutCommit: vi.fn(),
  cherrypickCommit: vi.fn(),
  revertCommit: vi.fn(),
  resetToCommit: vi.fn(),
  mergeBranch: vi.fn(),
  mergeCommit: vi.fn(),
  pushBranch: vi.fn(),
  pullBranch: vi.fn(),
  fetchRemote: vi.fn(),
  runRepositoryAction: vi.fn()
}));

vi.mock("vscode", () => ({
  l10n: { t: (message: string) => message },
  workspace: { textDocuments: [] }
}));
vi.mock("@/backend/gitClient", () => ({
  gitClientFactory: (repo: string) => ({ getInstance: () => ({ repo }) })
}));
vi.mock("@/backend/actions/tag", () => backend);
vi.mock("@/backend/actions/branch", () => backend);
vi.mock("@/backend/actions/commit", () => backend);
vi.mock("@/backend/actions/merge", () => backend);
vi.mock("@/backend/actions/remote", () => backend);
vi.mock("@/backend/actions/repository", () => backend);
vi.mock("@/extension/watchers/git-repo.watcher", () => ({
  selectWatchedRepo: vi.fn(),
  muteGitRepoWatcher: vi.fn(),
  unmuteGitRepoWatcher: vi.fn()
}));

const BUSY = "Another Git operation is running in this repository. Wait for it to finish.";

function register() {
  const handlers = new Map<string, (message: unknown) => Promise<void>>();
  const post = vi.fn();
  registerMessageHandlers(
    {
      post,
      onMessage: (command: string, handler: (message: unknown) => Promise<void>) =>
        handlers.set(command, handler)
    } as unknown as Parameters<typeof registerMessageHandlers>[0],
    {
      config: { gitPath: () => "/usr/bin/git" },
      repoManager: { getRepos: () => ({}), updateHiddenRemotes: vi.fn() }
    } as unknown as Parameters<typeof registerMessageHandlers>[1]
  );
  const send = (command: string, repo: string, fields: Record<string, unknown> = {}) =>
    handlers.get(command)!({ command, repo, requestId: `${command}-${repo}`, ...fields });
  return { post, send };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const action of Object.values(backend)) {
    action.mockResolvedValue(undefined);
  }
});

describe("action dispatch", () => {
  it.each<[string, keyof typeof backend, boolean]>([
    ["addTag", "addTag", false],
    ["deleteTag", "deleteTag", false],
    ["pushTag", "pushTag", false],
    ["createBranch", "createBranch", false],
    ["deleteBranch", "deleteBranch", false],
    ["renameBranch", "renameBranch", false],
    ["checkoutBranch", "checkoutBranch", false],
    ["checkoutCommit", "checkoutCommit", false],
    ["cherrypickCommit", "cherrypickCommit", false],
    ["revertCommit", "revertCommit", false],
    ["resetToCommit", "resetToCommit", false],
    ["mergeBranch", "mergeBranch", true],
    ["mergeCommit", "mergeCommit", true],
    ["pushBranch", "pushBranch", false],
    ["pullBranch", "pullBranch", false],
    ["fetchRemote", "fetchRemote", false]
  ])("runs %s with %s in the requested repository", async (command, action, binary) => {
    const { post, send } = register();
    await send(command, "/repo", { field: "value" });
    const message = { command, repo: "/repo", requestId: `${command}-/repo`, field: "value" };
    expect(backend[action]).toHaveBeenCalledExactlyOnceWith(
      { repo: "/repo" },
      message,
      ...(binary ? ["/usr/bin/git"] : [])
    );
    expect(post).toHaveBeenCalledWith({
      command,
      status: null,
      requestId: `${command}-/repo`,
      repo: "/repo"
    });
    const others = Object.entries(backend).filter(([name]) => name !== action);
    expect(others.every(([, other]) => other.mock.calls.length === 0)).toBe(true);
  });

  it("runs a repository action with its action and Git path", async () => {
    const { send } = register();
    const action = { kind: "removeRemote", name: "origin" };
    await send("repositoryAction", "/repo", { action });
    expect(backend.runRepositoryAction).toHaveBeenCalledExactlyOnceWith(
      { repo: "/repo" },
      action,
      "/usr/bin/git"
    );
  });

  it("reports a backend failure as the action's status", async () => {
    const { post, send } = register();
    backend.deleteBranch.mockRejectedValueOnce(new Error("not fully merged"));
    await send("deleteBranch", "/repo");
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ command: "deleteBranch", status: "not fully merged" })
    );
  });
});

describe("repository lock", () => {
  /** Start an action that runs until `finish` is called. */
  function hold(action: keyof typeof backend) {
    const pending = Promise.withResolvers<void>();
    backend[action].mockImplementationOnce(() => pending.promise);
    return pending;
  }

  it("refuses a second action in the same repository until the first settles", async () => {
    const { post, send } = register();
    const first = hold("resetToCommit");
    const running = send("resetToCommit", "/repo");
    await send("deleteTag", "/repo");
    expect(backend.deleteTag).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ command: "deleteTag", status: BUSY })
    );

    await send("deleteTag", "/other");
    expect(backend.deleteTag).toHaveBeenCalledOnce();

    first.resolve();
    await running;
    await send("deleteTag", "/repo");
    expect(backend.deleteTag).toHaveBeenCalledTimes(2);
  });

  it("releases the lock after a failed action", async () => {
    const { post, send } = register();
    backend.mergeBranch.mockRejectedValueOnce(new Error("conflict"));
    await send("mergeBranch", "/repo");
    await send("deleteTag", "/repo");
    expect(backend.deleteTag).toHaveBeenCalledOnce();
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ status: BUSY }));
  });

  it("locks submodules below a running submodule action", async () => {
    const { post, send } = register();
    const submodule = hold("runRepositoryAction");
    const running = send("repositoryAction", "/repo", {
      action: { kind: "submodule", path: "sub" }
    });
    await send("deleteTag", "/repo/sub");
    await send("deleteTag", "/repo/sub/nested");
    expect(backend.deleteTag).not.toHaveBeenCalled();
    expect(post.mock.calls.filter(([message]) => message.status === BUSY)).toHaveLength(2);

    await send("deleteTag", "/repository-sibling");
    expect(backend.deleteTag).toHaveBeenCalledOnce();
    submodule.resolve();
    await running;
  });

  it("runs file views and previews alongside each other and alongside a mutation", async () => {
    const { post, send } = register();
    const reset = hold("resetToCommit");
    const running = send("resetToCommit", "/repo");
    const firstView = hold("runRepositoryAction");
    const view = send("repositoryAction", "/repo", {
      action: { kind: "viewWorkingTreeFile", path: "a", group: "unstaged" }
    });
    // Overlapping views, all while the reset and the first view run.
    await Promise.all(
      ["viewWorkingTreeFile", "viewRangeFile", "viewHistoricalFile", "previewFileRestore"].map(
        (kind) =>
          send("repositoryAction", "/repo", { action: { kind, plan: { destination: "a" } } })
      )
    );
    expect(backend.runRepositoryAction).toHaveBeenCalledTimes(5);
    expect(post).not.toHaveBeenCalledWith(expect.objectContaining({ status: BUSY }));

    // A view does not hold the repository either.
    reset.resolve();
    await running;
    await send("deleteTag", "/repo");
    expect(backend.deleteTag).toHaveBeenCalledOnce();
    firstView.resolve();
    await view;
  });

  it("refuses a submodule action while a submodule below it is busy", async () => {
    const { post, send } = register();
    const child = hold("resetToCommit");
    const running = send("resetToCommit", "/repo/sub");
    await send("repositoryAction", "/repo", { action: { kind: "submodulePointer", path: "sub" } });
    expect(backend.runRepositoryAction).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({ command: "repositoryAction", status: BUSY })
    );

    // An ordinary action in the parent repository does not touch the submodule.
    await send("deleteTag", "/repo");
    expect(backend.deleteTag).toHaveBeenCalledOnce();
    child.resolve();
    await running;
  });
});
