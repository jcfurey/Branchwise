import { beforeEach, expect, it, vi } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { muteGitRepoWatcher } from "@/extension/watchers/git-repo.watcher";

import { legacyPage } from "@tests/extension/legacy-page";

const editor = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  showInformationMessage: vi.fn()
}));

vi.mock("vscode", () => ({
  l10n: {
    t: (message: string, ...values: string[]) =>
      values.reduce((sentence, value, index) => sentence.replace(`{${index}}`, value), message)
  },
  workspace: { textDocuments: [] },
  window: { showInformationMessage: editor.showInformationMessage },
  commands: { executeCommand: editor.executeCommand },
  Uri: { from: (parts: object) => parts }
}));
vi.mock("@/backend/gitClient", () => ({
  gitClientFactory: (repo: string) => ({ getInstance: () => ({ client: repo }) })
}));
vi.mock("@/backend/actions/repository", () => ({ runRepositoryAction: vi.fn() }));
vi.mock("@/extension/workspace-scan", () => ({
  listRepos: vi.fn(),
  invalidateWorkspaceScan: vi.fn()
}));
vi.mock("@/extension/watchers/git-repo.watcher", () => ({
  selectWatchedRepo: vi.fn(),
  muteGitRepoWatcher: vi.fn(),
  unmuteGitRepoWatcher: vi.fn()
}));

const HASH = "0123456789abcdef0123456789abcdef01234567";
const BASE = "89abcdef0123456789abcdef0123456789abcdef";
const ABSENT = "0".repeat(40);

/** A branchwise document of `path` at `commit` in /repo, as the diff provider encodes it. */
const document = (path: string, commit: string) => ({
  scheme: "branchwise",
  path,
  query: `commit=${encodeURIComponent(commit)}&repo=%2Frepo`
});

/** Answer one repository action in /repo with `effect`, as its backend call would. */
async function produce(
  effect: unknown,
  action: unknown = { kind: "viewCommitChanges", hash: HASH }
) {
  vi.mocked(runRepositoryAction).mockResolvedValueOnce(effect as never);
  const page = legacyPage();
  await page.send({ command: "repositoryAction", repo: "/repo", requestId: "all", action });
  return page;
}

beforeEach(() => {
  vi.clearAllMocks();
});

it("opens a commit's files in one multi-file diff editor, with the documents single diffs use", async () => {
  const page = await produce({
    kind: "changes",
    title: "Changes in 01234567",
    files: [
      { left: `${HASH}^`, right: HASH, before: "src/a.ts", after: "src/a.ts" },
      { left: `${HASH}^`, right: HASH, before: "old name.txt", after: "new name.txt" },
      { left: `${HASH}^`, right: HASH, before: "gone.txt", after: "gone.txt" }
    ]
  });

  expect(editor.executeCommand).toHaveBeenCalledExactlyOnceWith(
    "vscode.changes",
    "Changes in 01234567",
    [
      [document("src/a.ts", HASH), document("src/a.ts", `${HASH}^`), document("src/a.ts", HASH)],
      [
        document("new name.txt", HASH),
        document("old name.txt", `${HASH}^`),
        document("new name.txt", HASH)
      ],
      [document("gone.txt", HASH), document("gone.txt", `${HASH}^`), document("gone.txt", HASH)]
    ]
  );
  expect(editor.showInformationMessage).not.toHaveBeenCalled();
  expect(page.received).toEqual([
    { command: "repositoryAction", status: null, requestId: "all", repo: "/repo" }
  ]);
  // Opening editors holds no lock and leaves the repository watcher alone.
  expect(muteGitRepoWatcher).not.toHaveBeenCalled();
});

it("gives a compared file that is missing on one side an empty document there", async () => {
  await produce(
    {
      kind: "changes",
      title: "89abcdef ↔ 01234567",
      files: [
        { left: null, right: HASH, before: "added.txt", after: "added.txt" },
        { left: BASE, right: null, before: "deleted.txt", after: "deleted.txt" }
      ]
    },
    { kind: "viewRangeChanges", base: BASE, right: HASH, files: [] }
  );

  expect(editor.executeCommand).toHaveBeenCalledExactlyOnceWith(
    "vscode.changes",
    "89abcdef ↔ 01234567",
    [
      [document("added.txt", HASH), document("added.txt", ABSENT), document("added.txt", HASH)],
      [
        document("deleted.txt", ABSENT),
        document("deleted.txt", BASE),
        document("deleted.txt", ABSENT)
      ]
    ]
  );
});

it("falls back to the first file's diff, and says why, when VS Code cannot open them together", async () => {
  editor.executeCommand.mockImplementation((command: string) =>
    command === "vscode.changes"
      ? Promise.reject(new Error("command 'vscode.changes' not found"))
      : Promise.resolve()
  );
  const page = await produce({
    kind: "changes",
    title: "Changes in 01234567",
    files: [
      { left: `${HASH}^`, right: HASH, before: "src/a.ts", after: "src/a.ts" },
      { left: `${HASH}^`, right: HASH, before: "b.txt", after: "b.txt" }
    ]
  });

  expect(editor.executeCommand).toHaveBeenLastCalledWith(
    "vscode.diff",
    document("src/a.ts", `${HASH}^`),
    document("src/a.ts", HASH),
    "a.ts (Changes in 01234567)",
    { preview: true }
  );
  expect(editor.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
    "VS Code could not show all the changes in one editor, so only the first file's changes are open: command 'vscode.changes' not found"
  );
  expect(page.received).toEqual([expect.objectContaining({ status: null })]);
  editor.executeCommand.mockReset();
});

it("says so when there is nothing to open", async () => {
  const page = await produce({ kind: "changes", title: "Changes in 01234567", files: [] });

  expect(editor.executeCommand).not.toHaveBeenCalled();
  expect(editor.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
    "There are no changed files to show."
  );
  expect(page.received).toEqual([expect.objectContaining({ status: null })]);
});

it("reports a failure when even the single diff cannot open", async () => {
  editor.executeCommand.mockRejectedValue(new Error("no editor"));
  const page = await produce({
    kind: "changes",
    title: "Changes in 01234567",
    files: [{ left: `${HASH}^`, right: HASH, before: "a.txt", after: "a.txt" }]
  });

  expect(page.received).toEqual([expect.objectContaining({ status: "no editor" })]);
  editor.executeCommand.mockReset();
});
