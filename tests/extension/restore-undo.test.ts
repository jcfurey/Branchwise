import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadRestorePlan } from "@/backend/queries/history";
import { registerMessageHandlers } from "@/old-extension/messageHandler";

import { gitOutput, makeRepo } from "@tests/backend/helpers";

const mocks = vi.hoisted(() => ({
  documents: [] as { isDirty: boolean; uri: { scheme: string; fsPath: string } }[],
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  executeCommand: vi.fn(),
  notify: vi.fn()
}));

vi.mock("vscode", () => ({
  l10n: {
    t: (message: string, ...args: string[]) =>
      args.reduce((text, arg, index) => text.replace(`{${index}}`, arg), message)
  },
  workspace: {
    get textDocuments() {
      return mocks.documents;
    }
  },
  window: {
    showInformationMessage: mocks.info,
    showWarningMessage: mocks.warning,
    showErrorMessage: mocks.error
  },
  commands: { executeCommand: mocks.executeCommand },
  Uri: {
    file: (fsPath: string) => ({ fsPath }),
    from: (parts: Record<string, string>) => parts
  }
}));
vi.mock("@/extension/rpc/rpc-notify", () => ({ rpcNotify: { notify: mocks.notify } }));
vi.mock("@/extension/watchers/git-repo.watcher", () => ({
  selectWatchedRepo: vi.fn(),
  muteGitRepoWatcher: vi.fn(),
  unmuteGitRepoWatcher: vi.fn()
}));

let repo: string;
let historical: string;
const local = Buffer.from([0, 13, 10, 255, 42]);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.documents = [];
  repo = makeRepo();
  fs.writeFileSync(path.join(repo, "f"), "historical");
  gitOutput(["commit", "-qam", "historical"], repo);
  historical = gitOutput(["rev-parse", "HEAD"], repo);
  fs.writeFileSync(path.join(repo, "f"), local);
});
afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

function register() {
  const handlers = new Map<string, (message: unknown) => Promise<void>>();
  const post = vi.fn();
  const registered = registerMessageHandlers(
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
  const send = async (kind: "restoreFile" | "previewFileRestore") =>
    handlers.get("repositoryAction")!({
      command: "repositoryAction",
      repo,
      requestId: kind,
      action: { kind, plan: await loadRestorePlan(createGit(repo, "git"), historical, "f", "f") }
    });
  return { post, send, handlers: registered };
}

const dirtyEditor = () =>
  mocks.documents.push({ isDirty: true, uri: { scheme: "file", fsPath: path.join(repo, "f") } });

it("refuses to restore over unsaved editor changes", async () => {
  dirtyEditor();
  const { post, send } = register();
  await send("restoreFile");
  expect(post).toHaveBeenCalledWith(
    expect.objectContaining({ requestId: "restoreFile", status: expect.stringMatching(/unsaved/) })
  );
  expect(fs.readFileSync(path.join(repo, "f"))).toEqual(local);
  expect(mocks.info).not.toHaveBeenCalled();
});

it("refuses to restore over unsaved changes in an editor that reached the file through a link", async () => {
  // A workspace opened through a symbolic link names its files by the link, Git by the folder.
  const link = repo + "-link";
  fs.symlinkSync(repo, link, "junction");
  try {
    mocks.documents.push({
      isDirty: true,
      uri: { scheme: "file", fsPath: path.join(link, "f") }
    });
    const { post, send } = register();
    await send("restoreFile");
    expect(post).toHaveBeenCalledWith(
      expect.objectContaining({
        requestId: "restoreFile",
        status: expect.stringMatching(/unsaved/)
      })
    );
    expect(fs.readFileSync(path.join(repo, "f"))).toEqual(local);
  } finally {
    fs.rmSync(link, { force: true });
  }
});

it("restores beside unsaved changes to another file of the same name", async () => {
  const elsewhere = fs.mkdtempSync(repo + "-other-");
  try {
    mocks.documents.push({
      isDirty: true,
      uri: { scheme: "file", fsPath: path.join(elsewhere, "f") }
    });
    const { send } = register();
    await send("restoreFile");
    expect(fs.readFileSync(path.join(repo, "f"), "utf8")).toBe("historical");
  } finally {
    fs.rmSync(elsewhere, { recursive: true, force: true });
  }
});

it("tells the graph open now when an action ends after its own panel has closed", async () => {
  // The panel is closed, and perhaps opened again, while the action runs. Its answer goes to
  // the panel that is gone, and the watcher is kept quiet for the action's own writes, so
  // without this the graph showing now would never learn that the repository changed.
  const { send, handlers } = register();
  const running = send("restoreFile");
  handlers.dispose();
  await running;

  expect(fs.readFileSync(path.join(repo, "f"), "utf8")).toBe("historical");
  expect(mocks.notify).toHaveBeenCalledExactlyOnceWith("repo.updated", { path: repo });
});

it("leaves the refresh to its own page while that is open", async () => {
  const { send } = register();
  await send("restoreFile");
  expect(mocks.notify).not.toHaveBeenCalled();
});

it("warns that a preview shows unsaved changes", async () => {
  dirtyEditor();
  const { post, send } = register();
  await send("previewFileRestore");
  expect(mocks.warning).toHaveBeenCalledOnce();
  expect(mocks.executeCommand).toHaveBeenCalledWith(
    "vscode.diff",
    expect.anything(),
    expect.anything(),
    expect.anything(),
    expect.anything()
  );
  expect(post).toHaveBeenCalledWith(expect.objectContaining({ status: null }));
});

it("offers Undo Restore, which puts back the replaced bytes", async () => {
  mocks.info.mockResolvedValue("Undo Restore");
  const { post, send } = register();
  await send("restoreFile");
  expect(fs.readFileSync(path.join(repo, "f"), "utf8")).toBe("historical");
  expect(mocks.info).toHaveBeenCalledWith(expect.stringContaining("Restored f."), "Undo Restore");
  await vi.waitFor(() => expect(post).toHaveBeenCalledWith({ command: "refresh" }));
  expect(fs.readFileSync(path.join(repo, "f"))).toEqual(local);
  expect(mocks.error).not.toHaveBeenCalled();
});

it("leaves the restore in place when Undo is dismissed", async () => {
  mocks.info.mockResolvedValue(undefined);
  const { post, send } = register();
  await send("restoreFile");
  await Promise.resolve();
  expect(post).not.toHaveBeenCalledWith({ command: "refresh" });
  expect(fs.readFileSync(path.join(repo, "f"), "utf8")).toBe("historical");
});
