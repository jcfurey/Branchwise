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
  executeCommand: vi.fn()
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
  const send = async (kind: "restoreFile" | "previewFileRestore") =>
    handlers.get("repositoryAction")!({
      command: "repositoryAction",
      repo,
      requestId: kind,
      action: { kind, plan: await loadRestorePlan(createGit(repo, "git"), historical, "f", "f") }
    });
  return { post, send };
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
