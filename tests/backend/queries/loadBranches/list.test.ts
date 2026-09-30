import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadBranches } from "@/backend/queries/loadBranches";

import { freshRepo, git, gitOutput, makeRepo } from "@tests/backend/helpers";

function removeFolder(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

function newFolder(prefix: string) {
  return fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

/**
 * Runs `body` with Git kept from looking above `folder` for a repository, and from being told
 * where one is, then restores the environment.
 */
async function confined<T>(folder: string, body: () => Promise<T>) {
  const names = ["GIT_CEILING_DIRECTORIES", "GIT_DIR", "GIT_WORK_TREE"] as const;
  const saved = names.map((name) => [name, process.env[name]] as const);
  process.env["GIT_CEILING_DIRECTORIES"] = path.dirname(folder);
  delete process.env["GIT_DIR"];
  delete process.env["GIT_WORK_TREE"];
  try {
    return await body();
  } finally {
    for (const [name, value] of saved) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
}

/** The branch list of `folder`, which is also the request's `repo`, with remotes off by default. */
function branches(folder: string, options: { showRemoteBranches?: boolean; hard?: boolean } = {}) {
  return loadBranches(createGit(folder, "git"), {
    showRemoteBranches: options.showRemoteBranches ?? false,
    hard: options.hard ?? false,
    repo: folder,
    gitPath: "git"
  });
}

/** Folders a group of tests shares; they are only read, and deleted once the group is done. */
function sharedFolders() {
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made.splice(0)) {
      removeFolder(dir);
    }
  });
  return (dir: string) => {
    made.push(dir);
    return dir;
  };
}

describe("a repository with a second local branch", () => {
  const keep = sharedFolders();
  let repo = "";
  beforeAll(() => {
    repo = keep(makeRepo());
    git(["branch", "feature/foo"], repo);
  });

  it("lists the checked-out branch first, then the others, and names it as the head", async () => {
    expect(await branches(repo)).toStrictEqual({
      repo,
      branches: ["main", "feature/foo"],
      head: "main",
      hard: false,
      isRepo: true
    });
  });

  it("returns the request's hard flag unchanged", async () => {
    expect(await branches(repo, { hard: true })).toStrictEqual({
      repo,
      branches: ["main", "feature/foo"],
      head: "main",
      hard: true,
      isRepo: true
    });
  });
});

/** A clone, so it has `origin/main` and the symbolic `origin/HEAD`. */
describe("a clone", () => {
  const keep = sharedFolders();
  let repo = "";
  beforeAll(() => {
    const upstream = keep(makeRepo());
    repo = keep(newFolder("ngg-clone-"));
    git(["clone", "-q", upstream, "."], repo);
  });

  it("lists only local branches while remotes are off", async () => {
    expect(await branches(repo)).toStrictEqual({
      repo,
      branches: ["main"],
      head: "main",
      hard: false,
      isRepo: true
    });
  });

  it("adds remote-tracking branches, but no symbolic ref, while remotes are on", async () => {
    expect(gitOutput(["symbolic-ref", "refs/remotes/origin/HEAD"], repo)).toBe(
      "refs/remotes/origin/main"
    );
    expect(await branches(repo, { showRemoteBranches: true })).toStrictEqual({
      repo,
      branches: ["main", "remotes/origin/main"],
      head: "main",
      hard: false,
      isRepo: true
    });
  });
});

/**
 * Each test gets its own repository whose `git branch` output would be coloured, with a `topic`
 * branch and a lightweight tag `v1` at `init`, and a remote `origin` (itself) fetched, whose
 * `HEAD` points at `origin/main`. Git's human-readable listing would add lines for the states
 * these tests create; the branch list must not.
 */
describe("while HEAD is detached or an operation is under way", () => {
  const repo = freshRepo((dir) => {
    git(["config", "color.ui", "always"], dir);
    git(["config", "color.branch", "always"], dir);
    git(["branch", "topic"], dir);
    git(["tag", "v1"], dir);
    git(["remote", "add", "origin", dir], dir);
    git(["fetch", "-q", "origin"], dir);
    git(["remote", "set-head", "origin", "main"], dir);
  });

  const localOnly = () => ({
    repo: repo(),
    branches: ["main", "topic"],
    head: null,
    hard: false,
    isRepo: true
  });

  it.each(["main", "v1", "HEAD"])(
    "has no head, and lists every branch, after checking out %s detached",
    async (target) => {
      git(["checkout", "-q", "--detach", target], repo());
      expect(await branches(repo())).toStrictEqual(localOnly());
      expect(await branches(repo(), { showRemoteBranches: true })).toStrictEqual({
        ...localOnly(),
        branches: ["main", "topic", "remotes/origin/main", "remotes/origin/topic"]
      });
    }
  );

  it("has no head in a rebase stopped by a conflict", async () => {
    fs.writeFileSync(path.join(repo(), "f"), "main side");
    git(["commit", "-q", "-am", "main side"], repo());
    git(["checkout", "-q", "topic"], repo());
    fs.writeFileSync(path.join(repo(), "f"), "topic side");
    git(["commit", "-q", "-am", "topic side"], repo());
    expect(() => git(["rebase", "main"], repo())).toThrow();
    expect(await branches(repo())).toStrictEqual(localOnly());
  });

  it("has no head during a bisect, and main again after it", async () => {
    const base = gitOutput(["rev-parse", "HEAD"], repo());
    git(["commit", "-q", "--allow-empty", "-m", "middle"], repo());
    git(["commit", "-q", "--allow-empty", "-m", "last"], repo());
    git(["bisect", "start", "main", base], repo());
    expect(await branches(repo())).toStrictEqual(localOnly());
    git(["bisect", "reset"], repo());
    expect(await branches(repo())).toStrictEqual({ ...localOnly(), head: "main" });
  });
});

describe("a folder that is no repository", () => {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0)) {
      removeFolder(dir);
    }
  });

  it("rejects", async () => {
    const folder = newFolder("ngg-plain-");
    made.push(folder);
    await confined(folder, async () => {
      await expect(branches(folder)).rejects.toBeInstanceOf(Error);
    });
  });

  it("cannot even get a client when it does not exist", () => {
    const parent = newFolder("ngg-parent-");
    made.push(parent);
    expect(() => createGit(path.join(parent, "missing"), "git")).toThrow();
  });
});
