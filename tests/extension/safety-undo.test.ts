import * as fs from "node:fs";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";
import { legacyPage } from "@tests/extension/legacy-page";

const host = vi.hoisted(() => ({ info: vi.fn(), error: vi.fn() }));

vi.mock("vscode", () => ({
  l10n: {
    t: (message: string, ...values: string[]) =>
      values.reduce((sentence, value, index) => sentence.replace(`{${index}}`, value), message)
  },
  workspace: { textDocuments: [] },
  window: { showInformationMessage: host.info, showErrorMessage: host.error }
}));
vi.mock("@/extension/watchers/git-repo.watcher", () => ({
  selectWatchedRepo: vi.fn(),
  muteGitRepoWatcher: vi.fn(),
  unmuteGitRepoWatcher: vi.fn()
}));

let repo: string;

beforeEach(() => {
  vi.clearAllMocks();
  repo = makeRepo();
  git(["branch", "topic"], repo);
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

const branches = () =>
  gitOutput(["for-each-ref", "--format=%(refname:short)", "refs/heads/"], repo);
/** Sent with the running test's `repo`. */
const deleteTopic = {
  command: "deleteBranch",
  requestId: "delete",
  branchName: "topic",
  forceDelete: false
} as const;

it("offers Undo once a destructive action is done, and puts the branch back when chosen", async () => {
  host.info.mockResolvedValue("Undo");
  const page = legacyPage();
  await page.send({ ...deleteTopic, repo });
  await vi.waitFor(() => expect(page.postsOf("refresh")).toHaveLength(1));

  expect(host.info).toHaveBeenCalledWith(
    "Deletion of Branch topic is done. The Safety Net kept what it replaced, so it can be undone.",
    "Undo"
  );
  expect(page.postsOf("deleteBranch")).toEqual([
    { command: "deleteBranch", status: null, requestId: "delete", repo }
  ]);
  expect(page.postsOf("repositoryAction")).toEqual([
    { command: "repositoryAction", status: null, requestId: "undo-action-1", repo }
  ]);
  expect(branches()).toBe("main\ntopic");
  expect(host.error).not.toHaveBeenCalled();
});

it("leaves the action done when Undo is not chosen, and reports an Undo that is refused", async () => {
  const choice = Promise.withResolvers<string | undefined>();
  host.info.mockReturnValue(choice.promise);
  const page = legacyPage();
  await page.send({ ...deleteTopic, repo });
  expect(branches()).toBe("main");

  // A branch of the same name, made meanwhile, must not be replaced.
  git(["branch", "topic"], repo);
  choice.resolve("Undo");
  await vi.waitFor(() => expect(host.error).toHaveBeenCalled());
  expect(host.error.mock.calls[0]![0]).toMatch(/topic changed after the Deletion of Branch topic/);
  expect(page.postsOf("refresh")).toHaveLength(1);
});

it("offers nothing for an action that is not destructive", async () => {
  const page = legacyPage();
  await page.send({
    command: "createBranch",
    repo,
    requestId: "create",
    branchName: "other",
    commitHash: gitOutput(["rev-parse", "HEAD"], repo)
  });
  expect(page.postsOf("createBranch")[0]).toMatchObject({ status: null });
  expect(host.info).not.toHaveBeenCalled();
});
