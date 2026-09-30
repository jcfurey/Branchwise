import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { registerMessageHandlers } from "@/old-extension/messageHandler";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

vi.mock("vscode", () => ({ l10n: { t: (message: string) => message } }));
vi.mock("@/extension/watchers/git-repo.watcher", () => ({
  selectWatchedRepo: vi.fn(),
  muteGitRepoWatcher: vi.fn(),
  unmuteGitRepoWatcher: vi.fn()
}));

let repo: string;
let marker: string;

beforeEach(() => {
  repo = makeRepo();
  marker = path.join(repo, ".git", "ssh-started");
  git(["remote", "add", "origin", "ssh://git@example.invalid/repository.git"], repo);
  git(
    ["config", "core.sshCommand", `touch "${marker.split(path.sep).join("/")}"; sleep 20; :`],
    repo
  );
  git(["tag", "v1"], repo);
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 20, retryDelay: 250 }));

it("stops a stalled push on request and releases the repository", async () => {
  const handlers = new Map<string, (message: unknown) => Promise<void> | void>();
  const post = vi.fn();
  registerMessageHandlers(
    {
      post,
      onMessage: (command: string, handler: (message: unknown) => Promise<void>) =>
        handlers.set(command, handler)
    } as unknown as Parameters<typeof registerMessageHandlers>[0],
    {
      config: { gitPath: () => "git" },
      repoManager: { getRepos: () => ({}), updateHiddenRemotes: vi.fn() }
    } as unknown as Parameters<typeof registerMessageHandlers>[1]
  );
  const send = (message: Record<string, unknown>) =>
    handlers.get(message.command as string)!({ repo, ...message });

  const push = send({
    command: "pushBranch",
    requestId: "push",
    branchName: "main",
    remote: "origin",
    remoteBranch: "main",
    setUpstream: false
  });
  await vi.waitFor(() => expect(fs.existsSync(marker)).toBe(true), { timeout: 5000 });

  // Another request for a different action does not stop it.
  await send({ command: "cancelAction", requestId: "other" });
  await send({ command: "deleteTag", requestId: "busy", tagName: "v1" });
  expect(post).toHaveBeenLastCalledWith(
    expect.objectContaining({ requestId: "busy", status: expect.stringMatching(/Another Git/) })
  );

  const stoppedAt = Date.now();
  await send({ command: "cancelAction", requestId: "push" });
  await push;
  expect(Date.now() - stoppedAt).toBeLessThan(5000);
  expect(post).toHaveBeenLastCalledWith({
    command: "pushBranch",
    requestId: "push",
    repo,
    status: "The Git operation was cancelled."
  });

  await send({ command: "deleteTag", requestId: "after", tagName: "v1" });
  expect(post).toHaveBeenLastCalledWith(
    expect.objectContaining({ requestId: "after", status: null })
  );
  expect(gitOutput(["tag"], repo)).toBe("");
}, 20_000);
