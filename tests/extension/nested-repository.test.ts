import { expect, it, vi } from "vitest";

import { registerMessageHandlers } from "@/old-extension/messageHandler";

const mocks = vi.hoisted(() => ({
  info: vi.fn(async () => "Open Its Graph"),
  executeCommand: vi.fn()
}));

vi.mock("vscode", () => ({
  l10n: { t: (message: string, value = "") => message.replace("{0}", value) },
  workspace: { textDocuments: [] },
  window: { showInformationMessage: mocks.info },
  commands: { executeCommand: mocks.executeCommand },
  Uri: { file: (fsPath: string) => ({ fsPath }) }
}));
vi.mock("@/backend/gitClient", () => ({
  gitClientFactory: () => ({ getInstance: () => ({}) })
}));
vi.mock("@/backend/actions/repository", () => ({
  runRepositoryAction: async () => ({ kind: "nestedRepository", path: "/repo/nested" })
}));
vi.mock("@/extension/watchers/git-repo.watcher", () => ({
  selectWatchedRepo: vi.fn(),
  muteGitRepoWatcher: vi.fn(),
  unmuteGitRepoWatcher: vi.fn()
}));

it("explains a nested repository and offers its graph", async () => {
  const handlers = new Map<string, (message: unknown) => Promise<void>>();
  registerMessageHandlers(
    {
      post: vi.fn(),
      onMessage: (command: string, handler: (message: unknown) => Promise<void>) =>
        handlers.set(command, handler)
    } as unknown as Parameters<typeof registerMessageHandlers>[0],
    {
      config: { gitPath: () => "git" },
      repoManager: { getRepos: () => ({}), updateHiddenRemotes: vi.fn() }
    } as unknown as Parameters<typeof registerMessageHandlers>[1]
  );
  await handlers.get("repositoryAction")!({
    command: "repositoryAction",
    repo: "/repo",
    requestId: "view",
    action: { kind: "viewWorkingTreeFile", path: "nested/", group: "untracked" }
  });
  expect(mocks.info).toHaveBeenCalledWith(
    expect.stringContaining("/repo/nested is a separate Git repository"),
    "Open Its Graph"
  );
  await vi.waitFor(() =>
    expect(mocks.executeCommand).toHaveBeenCalledWith("branchwise.view", {
      rootUri: { fsPath: "/repo/nested" }
    })
  );
});
