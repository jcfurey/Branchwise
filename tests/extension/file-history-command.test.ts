import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { normalizeRepoPath } from "@/backend/utils/repoPath";
import { registerFileHistoryCommand } from "@/old-extension/fileHistoryCommand";

import { makeRepo } from "@tests/backend/helpers";

const mocks = vi.hoisted(() => ({
  commands: new Map<string, (uri?: unknown) => Promise<void>>(),
  showErrorMessage: vi.fn()
}));

vi.mock("vscode", () => ({
  commands: {
    registerCommand: (name: string, handler: (uri?: unknown) => Promise<void>) =>
      mocks.commands.set(name, handler)
  },
  window: { activeTextEditor: undefined, showErrorMessage: mocks.showErrorMessage },
  workspace: { getConfiguration: () => ({ get: (_key: string, value: unknown) => value }) },
  extensions: { getExtension: () => undefined },
  l10n: { t: (message: string) => message }
}));

let repo: string;
let outside: string;

beforeAll(() => {
  repo = makeRepo();
  fs.mkdirSync(path.join(repo, "sub dir"));
  fs.writeFileSync(path.join(repo, "sub dir", "file #1.txt"), "x");
  outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-history-link-")));
  fs.symlinkSync(repo, path.join(outside, "link"), "junction");
});

afterAll(() => {
  // Windows can briefly keep a folder busy after a Git process in it exits.
  fs.rmSync(outside, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

it.each([
  ["the repository", () => repo],
  ["a symlink to the repository", () => path.join(outside, "link")]
])("opens the history of a file reached through %s", async (_name, base) => {
  const open = vi.fn();
  registerFileHistoryCommand(
    { subscriptions: [] } as unknown as import("vscode").ExtensionContext,
    open
  );
  await mocks.commands.get("branchwise.fileHistory")!({
    scheme: "file",
    fsPath: path.join(base(), "sub dir", "file #1.txt")
  });
  expect(mocks.showErrorMessage).not.toHaveBeenCalled();
  expect(open).toHaveBeenCalledExactlyOnceWith(normalizeRepoPath(repo), "sub dir/file #1.txt");
});

it("reports a file outside any repository", async () => {
  const open = vi.fn();
  registerFileHistoryCommand(
    { subscriptions: [] } as unknown as import("vscode").ExtensionContext,
    open
  );
  await mocks.commands.get("branchwise.fileHistory")!({
    scheme: "file",
    fsPath: path.join(outside, "loose.txt")
  });
  expect(open).not.toHaveBeenCalled();
  expect(mocks.showErrorMessage).toHaveBeenCalledOnce();
});
