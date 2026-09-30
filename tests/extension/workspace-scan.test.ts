import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeRepoPath } from "@/backend/utils/repoPath";
import {
  addSessionRepo,
  invalidateWorkspaceScan,
  listRepos,
  scanWorkspaceRepos
} from "@/extension/workspace-scan";

const mocks = vi.hoisted(() => ({
  findGitRepos: vi.fn(),
  folders: [{ uri: { scheme: "file", fsPath: "/ws" } }]
}));
vi.mock("vscode", () => ({
  workspace: {
    get workspaceFolders() {
      return mocks.folders;
    }
  }
}));
vi.mock("@/backend/queries/repoSearch", () => ({ findGitRepos: mocks.findGitRepos }));

beforeEach(() => {
  invalidateWorkspaceScan();
  mocks.findGitRepos.mockReset();
  mocks.folders = [{ uri: { scheme: "file", fsPath: "/ws" } }];
});

it("walks the workspace once until the folders, Git path or depth change", async () => {
  mocks.findGitRepos.mockResolvedValue(["/ws/a"]);
  await expect(scanWorkspaceRepos("git", 1)).resolves.toEqual(["/ws/a"]);
  await scanWorkspaceRepos("git", 1);
  expect(mocks.findGitRepos).toHaveBeenCalledTimes(1);
  expect(mocks.findGitRepos).toHaveBeenCalledWith(["/ws"], "git", 1);

  await scanWorkspaceRepos("git", 2);
  await scanWorkspaceRepos("/usr/bin/git", 2);
  mocks.folders = [{ uri: { scheme: "file", fsPath: "/other" } }];
  await scanWorkspaceRepos("/usr/bin/git", 2);
  expect(mocks.findGitRepos).toHaveBeenCalledTimes(4);
  expect(mocks.findGitRepos).toHaveBeenLastCalledWith(["/other"], "/usr/bin/git", 2);
});

it("walks again after a repository appears or vanishes", async () => {
  mocks.findGitRepos.mockResolvedValue([]);
  await scanWorkspaceRepos("git", 0);
  invalidateWorkspaceScan();
  await scanWorkspaceRepos("git", 0);
  expect(mocks.findGitRepos).toHaveBeenCalledTimes(2);
});

it("does not keep a failed walk", async () => {
  mocks.findGitRepos.mockRejectedValueOnce(new Error("boom")).mockResolvedValueOnce(["/ws/b"]);
  await expect(scanWorkspaceRepos("git", 0)).rejects.toThrow("boom");
  await expect(scanWorkspaceRepos("git", 0)).resolves.toEqual(["/ws/b"]);
  expect(mocks.findGitRepos).toHaveBeenCalledTimes(2);
});

describe("repositories offered by the picker and the Workspace pane", () => {
  let root: string;
  beforeEach(() => {
    root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-session-")));
  });
  afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

  function repository(name: string) {
    const repo = normalizeRepoPath(path.join(root, name));
    fs.mkdirSync(path.join(repo, ".git"), { recursive: true });
    return repo;
  }

  it("adds this session's other repositories while they exist", async () => {
    const scanned = repository("scanned");
    const opened = repository("opened from source control");
    mocks.findGitRepos.mockResolvedValue([scanned]);
    addSessionRepo(opened);
    addSessionRepo(scanned);
    expect(await listRepos("git", 1)).toEqual([opened, scanned].toSorted());

    fs.rmSync(path.join(opened, ".git"), { recursive: true });
    expect(await listRepos("git", 1)).toEqual([scanned]);
    fs.mkdirSync(path.join(opened, ".git"));
    expect(await listRepos("git", 1)).toEqual([scanned]);
  });
});
