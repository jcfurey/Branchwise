import { beforeEach, expect, it, vi } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { deleteTag } from "@/backend/actions/tag";
import type { RepositoryAction, RestoreBackup } from "@/backend/types";

import { legacyPage } from "@tests/extension/legacy-page";

const host = vi.hoisted(() => ({
  /** What happened, in order: posts, messages shown and errors shown. */
  timeline: [] as string[],
  documents: [] as { isDirty: boolean; uri: { scheme: string; fsPath: string } }[],
  info: vi.fn(),
  error: vi.fn()
}));

vi.mock("vscode", () => ({
  l10n: {
    t: (message: string, ...values: string[]) =>
      values.reduce((sentence, value, index) => sentence.replace(`{${index}}`, value), message)
  },
  workspace: {
    get textDocuments() {
      return host.documents;
    }
  },
  window: {
    showInformationMessage: (...args: unknown[]) => {
      host.timeline.push(`info ${String(args[0])}`);
      return host.info(...args);
    },
    showErrorMessage: (message: string) => {
      host.timeline.push(`error ${message}`);
      return host.error(message);
    }
  }
}));
vi.mock("@/backend/gitClient", () => ({
  gitClientFactory: () => ({ getInstance: () => ({}) })
}));
vi.mock("@/backend/actions/repository", () => ({ runRepositoryAction: vi.fn() }));
vi.mock("@/backend/actions/tag", () => ({
  addTag: vi.fn(),
  deleteTag: vi.fn(),
  pushTag: vi.fn()
}));
vi.mock("@/extension/watchers/git-repo.watcher", () => ({
  selectWatchedRepo: vi.fn(),
  muteGitRepoWatcher: vi.fn(),
  unmuteGitRepoWatcher: vi.fn()
}));

const BUSY = "Another Git operation is running in this repository. Wait for it to finish.";
const backup: RestoreBackup = {
  path: "f.txt",
  blob: "b".repeat(40),
  mode: 0o100644,
  symlink: false,
  after: "a".repeat(40)
};

/** Restores give `backup`; undos run `undo`. */
function backend(undo: () => Promise<void>) {
  vi.mocked(runRepositoryAction).mockImplementation(async (_git, action: RepositoryAction) => {
    if (action.kind === "undoRestore") {
      return undo();
    }
    return { kind: "restored", backup };
  });
}

/** A page whose posts also land on the shared timeline. */
function page() {
  const opened = legacyPage();
  opened.post.mockImplementation(async (message) => {
    opened.received.push(message);
    const status = "status" in message ? ` ${String(message.status)}` : "";
    const id = "requestId" in message ? ` ${message.requestId}` : "";
    host.timeline.push(`post ${message.command}${id}${status}`);
    return true;
  });
  return opened;
}

const restore = (requestId: string) =>
  ({
    command: "repositoryAction",
    repo: "/repo",
    requestId,
    action: { kind: "restoreFile", plan: { destination: "f.txt" } }
  }) as const;

beforeEach(() => {
  vi.clearAllMocks();
  host.timeline.length = 0;
  host.documents = [];
});

it("reports a failed undo to the page and to the user, after reloading the page", async () => {
  backend(async () => {
    throw new Error("undo failed");
  });
  host.info.mockResolvedValue("Undo Restore");
  const graph = page();

  await graph.send(restore("restore"));
  await vi.waitFor(() => expect(host.error).toHaveBeenCalled());

  expect(host.timeline).toEqual([
    "post repositoryAction restore null",
    "info Restored f.txt. Its previous contents are kept in Git until its next garbage collection.",
    "post repositoryAction undo-restore-1 undo failed",
    "post refresh",
    "error undo failed"
  ]);
  expect(host.info).toHaveBeenCalledWith(expect.any(String), "Undo Restore");
});

it("refuses the undo while another action holds the repository", async () => {
  backend(async () => {});
  const choice = Promise.withResolvers<string>();
  host.info.mockReturnValue(choice.promise);
  const tagDeletion = Promise.withResolvers<void>();
  vi.mocked(deleteTag).mockReturnValueOnce(tagDeletion.promise);
  const graph = page();

  await graph.send(restore("restore"));
  const deletion = graph.send({
    command: "deleteTag",
    repo: "/repo",
    requestId: "tag",
    tagName: "v"
  });
  choice.resolve("Undo Restore");
  await vi.waitFor(() => expect(host.error).toHaveBeenCalledWith(BUSY));

  expect(graph.postsOf("repositoryAction").at(-1)).toEqual({
    command: "repositoryAction",
    status: BUSY,
    requestId: "undo-restore-1",
    repo: "/repo"
  });
  expect(graph.postsOf("refresh")).toHaveLength(1);
  expect(vi.mocked(runRepositoryAction).mock.calls.map(([, action]) => action.kind)).toEqual([
    "restoreFile"
  ]);

  tagDeletion.resolve();
  await deletion;
  expect(graph.postsOf("deleteTag")).toEqual([
    { command: "deleteTag", status: null, requestId: "tag", repo: "/repo" }
  ]);
});

it("numbers the undo requests of one page from one", async () => {
  backend(async () => {});
  host.info.mockResolvedValue("Undo Restore");
  const graph = page();

  await graph.send(restore("first"));
  await vi.waitFor(() => expect(graph.postsOf("refresh")).toHaveLength(1));
  await graph.send(restore("second"));
  await vi.waitFor(() => expect(graph.postsOf("refresh")).toHaveLength(2));

  expect(
    graph.postsOf("repositoryAction").map((message) => "requestId" in message && message.requestId)
  ).toEqual(["first", "undo-restore-1", "second", "undo-restore-2"]);
  expect(host.error).not.toHaveBeenCalled();
});

it("will not undo over unsaved edits to the restored file", async () => {
  backend(async () => {});
  const choice = Promise.withResolvers<string>();
  host.info.mockReturnValue(choice.promise);
  const graph = page();

  await graph.send(restore("restore"));
  host.documents.push({ isDirty: true, uri: { scheme: "file", fsPath: "/repo/f.txt" } });
  choice.resolve("Undo Restore");
  await vi.waitFor(() => expect(host.error).toHaveBeenCalled());

  const refusal =
    "Save or revert the unsaved changes to f.txt in the editor first; saving them later would undo the restore.";
  expect(host.error).toHaveBeenCalledWith(refusal);
  expect(graph.postsOf("repositoryAction").at(-1)).toMatchObject({ status: refusal });
  expect(runRepositoryAction).toHaveBeenCalledOnce();
});

it("offers nothing after a restore that kept no backup", async () => {
  vi.mocked(runRepositoryAction).mockResolvedValue({ kind: "restored", backup: null });
  const graph = page();

  await graph.send(restore("restore"));

  expect(host.info).not.toHaveBeenCalled();
  expect(graph.received).toEqual([
    { command: "repositoryAction", status: null, requestId: "restore", repo: "/repo" }
  ]);
});
