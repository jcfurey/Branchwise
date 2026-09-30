import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadBranches } from "@/backend/queries/loadBranches";

import { git } from "@tests/backend/helpers";

let empty = "";

beforeEach(() => {
  empty = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-unborn-")));
  git(["init", "-q"], empty);
});
afterEach(() => {
  fs.rmSync(empty, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

it("lists nothing and names no head before the first commit", async () => {
  const listing = await loadBranches(createGit(empty, "git"), {
    showRemoteBranches: true,
    hard: true,
    repo: empty,
    gitPath: "git"
  });

  expect(listing).toStrictEqual({
    repo: empty,
    branches: [],
    head: null,
    hard: true,
    isRepo: true
  });
});
