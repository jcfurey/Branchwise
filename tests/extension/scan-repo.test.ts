import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeRepoPath } from "@/backend/utils/repoPath";
import { scanRepos } from "@/extension/handlers/scan-repo";

import { git, makeRepo } from "@tests/backend/helpers";

const workspace = vi.hoisted(() => ({
  workspaceFolders: [] as { uri: { scheme: string; fsPath: string } }[],
  getConfiguration: () => ({ get: (_key: string, defaultValue: unknown) => defaultValue })
}));

vi.mock("vscode", () => ({ workspace }));

let parent: string;
let childSource: string;
let child: string;

beforeAll(() => {
  parent = makeRepo();
  childSource = makeRepo();
  git(
    ["-c", "protocol.file.allow=always", "submodule", "add", childSource, "src/child module"],
    parent
  );
  child = path.join(parent, "src/child module").split(path.sep).join("/");
});

beforeEach(() => {
  workspace.workspaceFolders = [{ uri: { scheme: "file", fsPath: parent } }];
});

afterAll(() => {
  for (const repo of [parent, childSource]) {
    if (repo) {
      fs.rmSync(repo, { recursive: true, force: true });
    }
  }
});

describe("repository picker scan", () => {
  it("offers the parent and submodule at the default search depth", async () => {
    expect(await scanRepos()).toEqual({
      repos: [
        { name: path.basename(parent), path: normalizeRepoPath(parent) },
        { name: "child module", path: normalizeRepoPath(child) }
      ].toSorted((a, b) => a.path.localeCompare(b.path))
    });
  });

  it("offers each repository once when workspace folders overlap", async () => {
    workspace.workspaceFolders.push({ uri: { scheme: "file", fsPath: child } });
    const { repos } = await scanRepos();
    expect(repos.map((repo) => repo.path).toSorted()).toEqual(
      [parent, child].map(normalizeRepoPath).toSorted()
    );
  });

  it("skips missing and virtual folders without hiding other repositories", async () => {
    workspace.workspaceFolders = [
      { uri: { scheme: "file", fsPath: path.join(parent, "..", "deleted folder") } },
      { uri: { scheme: "vscode-vfs", fsPath: "/github/owner/repo" } },
      { uri: { scheme: "file", fsPath: parent } }
    ];
    const { repos } = await scanRepos();
    expect(repos.map((repo) => repo.path).toSorted()).toEqual(
      [parent, child].map(normalizeRepoPath).toSorted()
    );
  });

  it("offers the repository of a subfolder or symlinked workspace folder once", async () => {
    const outside = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-link-")));
    try {
      const link = path.join(outside, "linked");
      fs.symlinkSync(parent, link, "junction");
      workspace.workspaceFolders = [
        { uri: { scheme: "file", fsPath: path.join(parent, "src") } },
        { uri: { scheme: "file", fsPath: link } }
      ];
      const { repos } = await scanRepos();
      expect(repos).toEqual(
        [
          { name: path.basename(parent), path: normalizeRepoPath(parent) },
          { name: "child module", path: normalizeRepoPath(child) }
        ].toSorted((a, b) => a.path.localeCompare(b.path))
      );
    } finally {
      fs.rmSync(outside, { recursive: true, force: true });
    }
  });

  it("returns an empty picker when there are no workspace folders", async () => {
    workspace.workspaceFolders = [];
    expect(await scanRepos()).toEqual({ repos: [] });
  });
});
