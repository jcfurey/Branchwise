import { beforeEach, describe, expect, it, vi } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { openConflict } from "@/extension/conflicts";
import { muteGitRepoWatcher, unmuteGitRepoWatcher } from "@/extension/watchers/git-repo.watcher";
import { invalidateWorkspaceScan } from "@/extension/workspace-scan";

import { legacyPage } from "@tests/extension/legacy-page";

const editor = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  openTextDocument: vi.fn(),
  showTextDocument: vi.fn(),
  showInformationMessage: vi.fn()
}));

vi.mock("vscode", () => ({
  l10n: {
    t: (message: string, ...values: string[]) =>
      values.reduce((sentence, value, index) => sentence.replace(`{${index}}`, value), message)
  },
  workspace: { textDocuments: [], openTextDocument: editor.openTextDocument },
  window: {
    showTextDocument: editor.showTextDocument,
    showInformationMessage: editor.showInformationMessage
  },
  commands: { executeCommand: editor.executeCommand },
  Uri: {
    file: (fsPath: string) => ({ scheme: "file", fsPath }),
    // Enough of a URI for the diff provider's encoders: its parts, and `with` to change one.
    from: (parts: object) => ({
      ...parts,
      with(change: object) {
        return { ...this, ...change };
      }
    })
  }
}));
vi.mock("@/backend/gitClient", () => ({
  gitClientFactory: (repo: string) => ({ getInstance: () => ({ client: repo }) })
}));
vi.mock("@/backend/actions/repository", () => ({ runRepositoryAction: vi.fn() }));
vi.mock("@/extension/conflicts", () => ({ openConflict: vi.fn() }));
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
const ABSENT = "0".repeat(40);

/** A branchwise document of `path` at `commit` in /repo, as the diff provider encodes it. */
const document = (path: string, commit: string, blob = false) =>
  expect.objectContaining({
    scheme: "branchwise",
    path,
    query: `commit=${commit}&repo=%2Frepo${blob ? "&blob=1" : ""}`
  });

/** Run one repository action in /repo whose backend call produces `effect`. */
async function produce(effect: unknown, action: unknown = { kind: "stash" }) {
  vi.mocked(runRepositoryAction).mockResolvedValueOnce(effect as never);
  const page = legacyPage();
  await page.send({ command: "repositoryAction", repo: "/repo", requestId: "fx", action });
  return page;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("what a repository action opens", () => {
  it("opens a worktree folder in a new window before answering", async () => {
    const page = await produce(
      { kind: "worktree", path: "/wt" },
      { kind: "openWorktree", path: "/wt" }
    );

    expect(editor.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "vscode.openFolder",
      { scheme: "file", fsPath: "/wt" },
      true
    );
    expect(page.received).toEqual([
      { command: "repositoryAction", status: null, requestId: "fx", repo: "/repo" }
    ]);
    expect(editor.executeCommand.mock.invocationCallOrder[0]).toBeLessThan(
      page.post.mock.invocationCallOrder[0]!
    );
  });

  it("hands a conflict to the conflict opener", async () => {
    const page = await produce({ kind: "conflict", path: "/repo/c.txt", status: "UU" });

    expect(openConflict).toHaveBeenCalledExactlyOnceWith("/repo/c.txt", "UU");
    expect(page.received).toEqual([expect.objectContaining({ status: null })]);
  });

  it("shows a text document as a diff preview", async () => {
    const opened = { uri: "untitled:diff" };
    editor.openTextDocument.mockResolvedValueOnce(opened);
    const page = await produce({ kind: "document", text: "diff text" });

    expect(editor.openTextDocument).toHaveBeenCalledExactlyOnceWith({
      language: "diff",
      content: "diff text"
    });
    expect(editor.showTextDocument).toHaveBeenCalledExactlyOnceWith(opened, { preview: true });
    expect(editor.showTextDocument.mock.invocationCallOrder[0]).toBeLessThan(
      page.post.mock.invocationCallOrder[0]!
    );
  });

  it("compares two revisions, marking a missing side with an empty set sign", async () => {
    await produce({ kind: "diff", left: HASH, right: null, before: "a.txt", after: "b.txt" });

    expect(editor.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "vscode.diff",
      document("a.txt", HASH),
      document("b.txt", ABSENT),
      "b.txt (01234567 ↔ ∅)",
      { preview: true }
    );
  });

  it("compares an unstaged file with the file on disk", async () => {
    await produce({
      kind: "workingTreeDiff",
      before: "o.txt",
      after: "n.txt",
      left: null,
      right: null,
      workingPath: "/repo/n.txt",
      staged: false
    });

    expect(editor.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "vscode.diff",
      document("o.txt", ABSENT, true),
      { scheme: "file", fsPath: "/repo/n.txt" },
      "n.txt (Working Tree Changes)",
      { preview: true }
    );
  });

  it("compares a staged file between two index blobs", async () => {
    await produce({
      kind: "workingTreeDiff",
      before: "o.txt",
      after: "n.txt",
      left: HASH,
      right: HASH,
      workingPath: null,
      staged: true
    });

    expect(editor.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "vscode.diff",
      document("o.txt", HASH, true),
      document("n.txt", HASH, true),
      "n.txt (Staged Changes)",
      { preview: true }
    );
  });

  it("opens a file as it was in a commit", async () => {
    await produce({ kind: "historicalFile", hash: HASH, path: "dir/h.txt" });

    expect(editor.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "vscode.open",
      document("dir/h.txt", HASH),
      { preview: true }
    );
  });

  it.each([
    [false, document("s.txt", ABSENT)],
    [true, { scheme: "file", fsPath: "/repo/d.txt" }]
  ])("previews a restore whose destination exists: %s", async (exists, left) => {
    await produce({
      kind: "restoreDiff",
      hash: HASH,
      sourcePath: "s.txt",
      destination: "/repo/d.txt",
      exists
    });

    expect(editor.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "vscode.diff",
      left,
      document("s.txt", HASH),
      "/repo/d.txt ↔ 0123456789ab",
      { preview: true }
    );
  });

  it("reports an editor that refuses to open as the action's failure", async () => {
    editor.executeCommand.mockRejectedValueOnce(new Error("editor refused"));
    const page = await produce({ kind: "historicalFile", hash: HASH, path: "dir/h.txt" });

    expect(page.received).toEqual([
      { command: "repositoryAction", status: "editor refused", requestId: "fx", repo: "/repo" }
    ]);
    expect(muteGitRepoWatcher).toHaveBeenCalledExactlyOnceWith("/repo");
    expect(unmuteGitRepoWatcher).toHaveBeenCalledExactlyOnceWith("/repo");
  });

  it("opens nothing for an action without an effect", async () => {
    const page = await produce(undefined);

    expect(editor.executeCommand).not.toHaveBeenCalled();
    expect(editor.showInformationMessage).not.toHaveBeenCalled();
    expect(page.received).toEqual([expect.objectContaining({ status: null })]);
  });
});

describe("submodule actions", () => {
  it("drop the cached workspace scan only when they succeed", async () => {
    const submodule = { kind: "submodule", path: "sub", operation: "update", recorded: HASH };
    vi.mocked(runRepositoryAction)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("update failed"));
    const page = legacyPage();

    await page.send({
      command: "repositoryAction",
      repo: "/repo",
      requestId: "1",
      action: submodule
    });
    await page.send({
      command: "repositoryAction",
      repo: "/repo",
      requestId: "2",
      action: submodule
    });

    expect(invalidateWorkspaceScan).toHaveBeenCalledOnce();
    expect(page.received.map((message) => "status" in message && message.status)).toEqual([
      null,
      "update failed"
    ]);
  });
});
