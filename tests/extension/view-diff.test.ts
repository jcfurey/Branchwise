import { expect, it, vi } from "vitest";

import { registerMessageHandlers } from "@/old-extension/messageHandler";

const mocks = vi.hoisted(() => ({ executeCommand: vi.fn() }));
vi.mock("vscode", () => ({
  commands: { executeCommand: mocks.executeCommand },
  l10n: { t: (message: string) => message },
  Uri: { from: (parts: unknown) => parts }
}));
vi.mock("@/extension/watchers/git-repo.watcher", () => ({
  selectWatchedRepo: vi.fn(),
  muteGitRepoWatcher: vi.fn(),
  unmuteGitRepoWatcher: vi.fn()
}));

const request = {
  command: "viewDiff",
  repo: "/repo",
  commitHash: "a".repeat(40),
  oldFilePath: "a.txt",
  newFilePath: "a.txt",
  type: "M"
};

function attach() {
  const handlers = new Map<string, (message: unknown) => void | Promise<void>>();
  const post = vi.fn();
  registerMessageHandlers(
    {
      post,
      onMessage: (command: string, handler: (message: unknown) => void | Promise<void>) =>
        handlers.set(command, handler)
    } as unknown as Parameters<typeof registerMessageHandlers>[0],
    { config: { gitPath: () => "git" } } as unknown as Parameters<typeof registerMessageHandlers>[1]
  );
  return { handlers, post };
}

it("confirms a diff that VS Code opened", async () => {
  mocks.executeCommand.mockResolvedValueOnce(undefined);
  const { handlers, post } = attach();
  await handlers.get("viewDiff")!(request);
  expect(post).toHaveBeenCalledWith({ command: "viewDiff", success: true });
});

it("reports a diff that VS Code refused to open", async () => {
  mocks.executeCommand.mockRejectedValueOnce(new Error("no such document"));
  const { handlers, post } = attach();
  await handlers.get("viewDiff")!(request);
  expect(post).toHaveBeenCalledWith({ command: "viewDiff", success: false });
});
