import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, expect, it, vi } from "vitest";

import { MIGRATED_SETTINGS, migrateSettings } from "@/extension/migrate-settings";

const mocks = vi.hoisted(() => ({
  /** Saved settings by scope, keyed by section and name, as in settings.json. */
  settings: { global: {}, workspace: {} } as Record<
    "global" | "workspace",
    Record<string, unknown>
  >,
  folders: undefined as unknown[] | undefined,
  update: vi.fn(),
  warn: vi.fn()
}));

vi.mock("vscode", () => {
  const Global = 1;
  return {
    ConfigurationTarget: { Global, Workspace: 2, WorkspaceFolder: 3 },
    workspace: {
      get workspaceFolders() {
        return mocks.folders;
      },
      getConfiguration: (section: string) => ({
        inspect: (key: string) => ({
          key: `${section}.${key}`,
          globalValue: mocks.settings.global[`${section}.${key}`],
          workspaceValue: mocks.settings.workspace[`${section}.${key}`]
        }),
        update: mocks.update.mockImplementation(async (key: string, value: unknown, target) => {
          mocks.settings[target === Global ? "global" : "workspace"][`${section}.${key}`] = value;
        })
      })
    }
  };
});
vi.mock("@/extension/util/logger", () => ({ logger: { info: vi.fn(), warn: mocks.warn } }));

function memento() {
  const values: Record<string, unknown> = {};
  return {
    get: (key: string, fallback: unknown) => values[key] ?? fallback,
    update: async (key: string, value: unknown) => {
      values[key] = value;
    }
  };
}

let ctx: import("vscode").ExtensionContext;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings = { global: {}, workspace: {} };
  mocks.folders = [{ uri: { fsPath: "/repo" } }];
  ctx = {
    globalState: memento(),
    workspaceState: memento()
  } as unknown as import("vscode").ExtensionContext;
});

it("copies user and workspace settings to the new names, keeping ones already set", async () => {
  mocks.settings.global = {
    "neo-git-graph.graphStyle": "angular",
    "neo-git-graph.dateFormat": "Relative",
    "branchwise.dateFormat": "Date Only"
  };
  mocks.settings.workspace = { "neo-git-graph.initialLoadCommits": 50 };

  await migrateSettings(ctx);

  expect(mocks.settings.global).toEqual({
    "neo-git-graph.graphStyle": "angular",
    "neo-git-graph.dateFormat": "Relative",
    "branchwise.dateFormat": "Date Only",
    "branchwise.graphStyle": "angular"
  });
  expect(mocks.settings.workspace).toEqual({
    "neo-git-graph.initialLoadCommits": 50,
    "branchwise.initialLoadCommits": 50
  });
});

it("copies once, so a setting reset under the new name stays reset", async () => {
  mocks.settings.global = { "neo-git-graph.graphStyle": "angular" };
  await migrateSettings(ctx);
  delete mocks.settings.global["branchwise.graphStyle"];

  await migrateSettings(ctx);

  expect(mocks.settings.global["branchwise.graphStyle"]).toBeUndefined();
});

it("copies a workspace's settings when a folder is first opened", async () => {
  mocks.folders = undefined;
  mocks.settings.workspace = { "neo-git-graph.graphStyle": "angular" };
  await migrateSettings(ctx);
  expect(mocks.settings.workspace["branchwise.graphStyle"]).toBeUndefined();

  mocks.folders = [{ uri: { fsPath: "/repo" } }];
  await migrateSettings(ctx);

  expect(mocks.settings.workspace["branchwise.graphStyle"]).toBe("angular");
  expect(mocks.update).toHaveBeenCalledTimes(1);
});

it("reports a failed copy instead of failing activation", async () => {
  mocks.settings.global = { "neo-git-graph.graphStyle": "angular" };
  mocks.update.mockRejectedValueOnce(new Error("settings.json is read-only"));

  await expect(migrateSettings(ctx)).resolves.toBeUndefined();

  expect(mocks.warn).toHaveBeenCalledWith(
    "Unable to copy the neo-git-graph settings",
    expect.objectContaining({ message: "settings.json is read-only" })
  );
});

it("copies every declared setting except the one without an effect and the new ones", () => {
  const manifest = JSON.parse(
    readFileSync(path.join(__dirname, "..", "..", "package.json"), "utf8")
  ) as { contributes: { configuration: { properties: Record<string, unknown> } } };
  const declared = Object.keys(manifest.contributes.configuration.properties).map((key) =>
    key.replace(/^branchwise\./, "")
  );
  // The old extension never had `nestedRepoSearchDepth`, `conflictForecast`, `showSignatures`,
  // `singleKeyShortcuts`, `dragAndDrop`, `issueLinks` or `dateSeparators`.
  const notCopied = new Set([
    "fetchAvatars",
    "nestedRepoSearchDepth",
    "conflictForecast",
    "showSignatures",
    "singleKeyShortcuts",
    "dragAndDrop",
    "issueLinks",
    "dateSeparators"
  ]);
  expect(MIGRATED_SETTINGS).toEqual(declared.filter((key) => !notCopied.has(key)));
});
