import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  disposable: () => ({ dispose: () => {} }),
  registerCommand: vi.fn(),
  simpleGit: vi.fn(),
  folders: undefined as { uri: { scheme: string; fsPath: string } }[] | undefined
}));

vi.mock("simple-git", () => ({ simpleGit: mocks.simpleGit }));
vi.mock("vscode", () => {
  const { disposable } = mocks;
  return {
    commands: { registerCommand: mocks.registerCommand.mockImplementation(disposable) },
    window: {
      createOutputChannel: () => ({
        info: () => {},
        warn: () => {},
        error: () => {},
        debug: () => {},
        dispose: () => {}
      }),
      createStatusBarItem: () => ({ show: () => {}, dispose: () => {} })
    },
    workspace: {
      get workspaceFolders() {
        return mocks.folders;
      },
      getConfiguration: () => ({
        get: (_key: string, value: unknown) => value,
        inspect: () => undefined
      }),
      registerTextDocumentContentProvider: disposable,
      onDidCloseTextDocument: disposable
    },
    extensions: { getExtension: () => undefined },
    EventEmitter: class {
      event = disposable;
      dispose() {}
    },
    StatusBarAlignment: { Left: 1 },
    ConfigurationTarget: { Global: 1, Workspace: 2 },
    Uri: { file: (fsPath: string) => ({ fsPath }) },
    l10n: { t: (message: string) => message, bundle: undefined }
  };
});

let storage: string;

beforeEach(() => {
  vi.clearAllMocks();
  storage = mkdtempSync(path.join(os.tmpdir(), "ngg-activation-"));
});

afterEach(() => rmSync(storage, { recursive: true, force: true }));

function memento(values: Record<string, unknown>) {
  return {
    get: (key: string, fallback: unknown) => values[key] ?? fallback,
    update: vi.fn(async () => {})
  };
}

function context(saved: Record<string, unknown>) {
  return {
    subscriptions: [] as { dispose(): void }[],
    extensionUri: { fsPath: "/extension" },
    globalStoragePath: storage,
    globalState: memento({}),
    workspaceState: memento(saved)
  } as unknown as import("vscode").ExtensionContext;
}

const COMMANDS = [
  "branchwise.view",
  "branchwise.fileHistory",
  "branchwise.showBranches",
  "branchwise.goTo",
  "branchwise.openDocumentation",
  "branchwise.openWalkthrough"
];

async function activate(saved: Record<string, unknown> = {}) {
  const { activate: run } = await import("@/main");
  run(context(saved));
  return mocks.registerCommand.mock.calls.map(([command]) => command as string).toSorted();
}

it("registers every contributed command in a window without a folder", async () => {
  mocks.folders = undefined;
  expect(await activate()).toEqual(COMMANDS.toSorted());
  expect(mocks.simpleGit).not.toHaveBeenCalled();
});

it("activates without running Git when the saved last repository was deleted", async () => {
  mocks.folders = [{ uri: { scheme: "file", fsPath: path.join(storage, "workspace") } }];
  const deleted = path.join(storage, "deleted repository");
  const commands = await activate({
    lastActiveRepo: deleted,
    repoStates: { [deleted]: { columnWidths: null } }
  });
  expect(commands).toEqual(COMMANDS.toSorted());
  expect(mocks.simpleGit).not.toHaveBeenCalled();
});

it("removes the avatar cache that earlier versions kept", async () => {
  mocks.folders = undefined;
  const avatars = path.join(storage, "avatars");
  mkdirSync(avatars);
  writeFileSync(path.join(avatars, "author.png"), "");
  const globalState = memento({ avatarCache: { "a@example.com": {} } });
  const { activate: run } = await import("@/main");
  run({ ...context({}), globalState } as unknown as import("vscode").ExtensionContext);
  await vi.waitFor(() => expect(existsSync(avatars)).toBe(false));
  expect(globalState.update).toHaveBeenCalledWith("avatarCache", undefined);
});

it("binds Go to only while the graph is the active editor and nothing else has focus", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as { contributes: { keybindings: Array<Record<string, string>> } };
  expect(manifest.contributes.keybindings).toEqual([
    {
      command: "branchwise.goTo",
      key: "ctrl+alt+g",
      mac: "cmd+alt+g",
      when: "activeWebviewPanelId == 'branchwise' && !sideBarFocus && !panelFocus && !auxiliaryBarFocus"
    }
  ]);
});

it("declares that virtual and untrusted workspaces are unsupported", () => {
  const manifest = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
  ) as { capabilities: Record<string, { supported: boolean; description: string }> };
  expect(manifest.capabilities.virtualWorkspaces).toMatchObject({ supported: false });
  expect(manifest.capabilities.untrustedWorkspaces).toMatchObject({ supported: false });
});
