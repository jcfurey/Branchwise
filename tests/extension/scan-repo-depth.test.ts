import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, expect, test, vi } from "vitest";

import { normalizeRepoPath } from "@/backend/utils/repoPath";
import { scanRepos } from "@/extension/handlers/scan-repo";

import { git } from "@tests/backend/helpers";

const search = vi.hoisted(() => ({
  depth: 0,
  folders: [] as { uri: { scheme: string; fsPath: string } }[]
}));

vi.mock("vscode", () => ({
  workspace: {
    get workspaceFolders() {
      return search.folders;
    },
    getConfiguration: () => ({
      get: (key: string, fallback?: unknown) =>
        key === "maxDepthOfRepoSearch" ? search.depth : fallback
    })
  }
}));

let outer: string;

beforeAll(() => {
  outer = realpathSync.native(mkdtempSync(join(tmpdir(), "branchwise depth ")));
  for (const repo of [join(outer, "a repo"), join(outer, "deep", "b")]) {
    mkdirSync(repo, { recursive: true });
    git(["init", "--quiet"], repo);
  }
  search.folders = [{ uri: { scheme: "file", fsPath: outer } }];
});

afterAll(() => rmSync(outer, { recursive: true, force: true }));

test.each([
  [0, []],
  [1, ["a repo"]],
  [2, ["a repo", "deep/b"]]
])("finds the repositories at most %d levels below the folder", async (depth, found) => {
  search.depth = depth;
  expect(await scanRepos()).toEqual({
    repos: found.map((relative) => ({
      name: relative.split("/").at(-1),
      path: normalizeRepoPath(join(outer, relative))
    }))
  });
});
