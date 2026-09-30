import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";

import { openConflict } from "@/extension/conflicts";

const mocks = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  showInformationMessage: vi.fn(),
  git: undefined as
    | { isActive: boolean; exports: { enabled: boolean; getAPI: () => unknown } }
    | undefined,
  tracked: true
}));

vi.mock("vscode", () => ({
  Uri: { file: (fsPath: string) => ({ fsPath }) },
  commands: { executeCommand: mocks.executeCommand },
  window: { showInformationMessage: mocks.showInformationMessage },
  extensions: { getExtension: () => mocks.git },
  l10n: { t: (message: string, ...args: string[]) => message.replace("{0}", args[0] ?? "") }
}));

let dir: string;
let present: string;
let missing: string;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "ngg-conflict-"));
  present = path.join(dir, "present.txt");
  missing = path.join(dir, "missing.txt");
  fs.writeFileSync(present, "<<<<<<<\n");
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tracked = true;
  mocks.git = {
    isActive: true,
    exports: {
      enabled: true,
      getAPI: () => ({ getRepository: () => (mocks.tracked ? {} : null) })
    }
  };
});

it.each(["UU", "AA"])("opens a tracked %s conflict in the merge editor", async (status) => {
  await openConflict(present, status);
  expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith("git.openMergeEditor", {
    fsPath: present
  });
});

it.each([
  ["an untracked repository", () => (mocks.tracked = false)],
  ["a disabled Git extension", () => (mocks.git!.exports.enabled = false)],
  ["no Git extension", () => (mocks.git = undefined)]
])("opens the file itself for %s", async (_name, setup) => {
  setup();
  await openConflict(present, "UU");
  expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith("vscode.open", { fsPath: present });
});

it.each(["UD", "DU", "AU", "UA"])(
  "opens the remaining file of a %s conflict, which the merge editor cannot show",
  async (status) => {
    await openConflict(present, status);
    expect(mocks.executeCommand).toHaveBeenCalledExactlyOnceWith("vscode.open", {
      fsPath: present
    });
  }
);

it("explains a conflict where both sides deleted the file", async () => {
  await openConflict(missing, "DD");
  expect(mocks.executeCommand).not.toHaveBeenCalled();
  expect(mocks.showInformationMessage).toHaveBeenCalledExactlyOnceWith(
    "Both sides deleted missing.txt. Stage its deletion to resolve the conflict."
  );
});
