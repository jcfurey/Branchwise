import { expect, it, vi } from "vitest";

import { scanRepos } from "@/extension/handlers/scan-repo";
import { getSourceControlRepo } from "@/extension/repoSelection";

vi.mock("node:path", async () => {
  const { win32 } = await vi.importActual<typeof import("node:path")>("node:path");
  return { ...win32, default: win32 };
});
vi.mock("vscode", () => ({
  workspace: {
    workspaceFolders: [
      { uri: { scheme: "file", fsPath: "C:\\workspace" } },
      { uri: { scheme: "file", fsPath: "c:\\workspace\\child module" } }
    ],
    getConfiguration: () => ({ get: (_key: string, defaultValue: unknown) => defaultValue })
  }
}));
// The Windows folders do not exist on the test machine.
const directory = vi.hoisted(() => async () => ({ isDirectory: () => true }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, stat: directory, default: { ...actual, stat: directory } };
});
vi.mock("@/backend/utils/git", () => ({
  workTreeRoot: async (folder: string) => folder,
  getSubmodulePaths: async (repo: string) =>
    repo === "c:/workspace" ? ["C:/workspace/child module"] : []
}));

it("uses matching Windows paths for workspace folders, submodules and SCM clicks", async () => {
  const { repos } = await scanRepos();
  expect(repos).toEqual([
    { name: "workspace", path: "c:/workspace" },
    { name: "child module", path: "c:/workspace/child module" }
  ]);
  const selected = getSourceControlRepo({
    rootUri: { fsPath: "C:\\workspace\\child module" } as import("vscode").Uri
  });
  expect(repos.filter((repo) => repo.path === selected)).toHaveLength(1);
});
