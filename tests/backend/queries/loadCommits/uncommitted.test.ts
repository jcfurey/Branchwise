import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadCommits } from "@/backend/queries/loadCommits";

import {
  commit,
  defaults,
  git,
  repoA,
  repoB,
  repoI,
  useTempDirs
} from "@tests/backend/queries/loadCommits/fixtures";

const tempDir = useTempDirs();

const EMPTY = {
  commits: [],
  head: null,
  moreCommitsAvailable: false,
  hard: false,
  uncommittedChanges: 0
};

describe("uncommitted changes row", () => {
  it("counts each changed entry, whatever the user's untracked-files setting", async () => {
    const { repo } = repoI(tempDir());
    const write = (file: string, text = "") => {
      fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
      fs.writeFileSync(path.join(repo, file), text);
    };
    write("g", "g");
    git(repo, ["add", "g"]);
    commit(repo, "add g", 1_700_000_100);
    git(repo, ["config", "status.showUntrackedFiles", "no"]);
    const count = async () =>
      (await loadCommits(createGit(repo, "git"), defaults)).uncommittedChanges;

    expect(await count()).toBe(0);
    write("f", "modified");
    expect(await count()).toBe(1);
    git(repo, ["add", "f"]);
    expect(await count()).toBe(1);
    write("f", "modified again");
    expect(await count()).toBe(1);
    git(repo, ["mv", "g", "g2"]);
    expect(await count()).toBe(2);
    write("d/e/1");
    write("d/2");
    expect(await count()).toBe(4);
    write(".gitignore", "ignored\n");
    write("ignored");
    expect(await count()).toBe(5);
    // Windows allows neither tabs, double quotes nor newlines in file names.
    write(process.platform === "win32" ? "a 'quoted' name" : 'a "quoted"\tname\n');
    expect(await count()).toBe(6);
  });

  it("counts a conflicted file once", async () => {
    const { repo } = repoI(tempDir());
    git(repo, ["checkout", "-q", "-b", "other"]);
    fs.writeFileSync(path.join(repo, "f"), "other\n");
    git(repo, ["commit", "-q", "-am", "other"]);
    git(repo, ["checkout", "-q", "main"]);
    fs.writeFileSync(path.join(repo, "f"), "main\n");
    git(repo, ["commit", "-q", "-am", "main"]);
    expect(() => git(repo, ["merge", "other"])).toThrow();
    const result = await loadCommits(createGit(repo, "git"), defaults);
    expect(result.uncommittedChanges).toBe(1);
    expect(result.commits[0]).toMatchObject({ hash: "*", parentHashes: [result.head] });
  });

  it("counts only the changes of the worktree it reads", async () => {
    const { repo, I } = repoI(tempDir());
    const linked = path.join(tempDir(), "linked");
    git(repo, ["worktree", "add", "-q", "-b", "side", linked]);
    fs.writeFileSync(path.join(linked, "new"), "");
    const main = await loadCommits(createGit(repo, "git"), defaults);
    expect(main.commits.map((entry) => entry.hash)).toEqual([I]);
    expect(main.uncommittedChanges).toBe(0);
    const side = await loadCommits(createGit(linked, "git"), defaults);
    expect(side.commits.map((entry) => entry.hash)).toEqual(["*", I]);
    expect(side.uncommittedChanges).toBe(1);
  });

  it("skips the row, and status, when HEAD's commit is below the page", async () => {
    const { repo, M2, F1 } = repoB(tempDir());
    const client = createGit(repo, "git");
    const status = vi.spyOn(client, "status");
    const result = await loadCommits(client, { ...defaults, maxCommits: 1 });
    expect(result).toEqual({
      commits: [expect.objectContaining({ hash: F1 })],
      head: M2,
      moreCommitsAvailable: true,
      hard: false,
      uncommittedChanges: 0
    });
    expect(status).not.toHaveBeenCalled();
  });

  it("skips the row, and status, when the branch filter leaves HEAD out", async () => {
    const { repo, I, M2, F1 } = repoB(tempDir());
    const client = createGit(repo, "git");
    const status = vi.spyOn(client, "status");
    const result = await loadCommits(client, { ...defaults, branchName: "feature" });
    expect(result.commits.map((entry) => entry.hash)).toEqual([F1, I]);
    expect(result).toMatchObject({ head: M2, uncommittedChanges: 0 });
    expect(status).not.toHaveBeenCalled();
  });

  it("does not read the working tree when the row is turned off", async () => {
    const { repo, S } = repoA(tempDir());
    fs.writeFileSync(path.join(repo, "untracked"), "");
    const client = createGit(repo, "git");
    vi.spyOn(client, "status").mockRejectedValue(new Error("index unreadable"));
    const result = await loadCommits(client, { ...defaults, showUncommittedChanges: false });
    expect(result.commits.map((entry) => entry.hash)[0]).toBe(S);
    expect(result.uncommittedChanges).toBe(0);
  });

  it("shows no row on an orphan branch, even with staged files", async () => {
    const { repo, I } = repoI(tempDir());
    git(repo, ["checkout", "-q", "--orphan", "fresh"]);
    const client = createGit(repo, "git");
    const status = vi.spyOn(client, "status");
    const result = await loadCommits(client, defaults);
    expect(result).toEqual({
      commits: [
        expect.objectContaining({ hash: I, refs: [{ hash: I, name: "main", type: "head" }] })
      ],
      head: null,
      moreCommitsAvailable: false,
      hard: false,
      uncommittedChanges: 0
    });
    expect(status).not.toHaveBeenCalled();
  });

  it.each([true, false])(
    "returns an empty graph for a repository without commits, remote branches %s",
    async (showRemoteBranches) => {
      const repo = tempDir();
      git(repo, ["init", "-q", "-b", "main"]);
      fs.writeFileSync(path.join(repo, "untracked"), "");
      const client = createGit(repo, "git");
      const status = vi.spyOn(client, "status");
      expect(await loadCommits(client, { ...defaults, showRemoteBranches })).toEqual(EMPTY);
      expect(status).not.toHaveBeenCalled();
    }
  );

  it.each([true, false])(
    "loads a bare repository without a row, uncommitted changes %s",
    async (showUncommittedChanges) => {
      const { repo: source, I, S } = repoA(tempDir());
      const bare = tempDir();
      git(bare, ["clone", "-q", "--bare", source, "."]);
      const result = await loadCommits(createGit(bare, "git"), {
        ...defaults,
        showUncommittedChanges
      });
      expect(result.commits.map((entry) => entry.hash)).toEqual([S, I]);
      expect(result).toMatchObject({ head: S, uncommittedChanges: 0 });
    }
  );

  it("passes on a status failure in a repository with a work tree", async () => {
    const { repo } = repoI(tempDir());
    const client = createGit(repo, "git");
    const failure = new Error("index unreadable");
    vi.spyOn(client, "status").mockRejectedValue(failure);
    // The failure comes back while the read of signatures may still be running Git in the folder,
    // which Windows then cannot remove. Without the signature marks nothing else is running.
    await expect(loadCommits(client, { ...defaults, showSignatures: false })).rejects.toBe(failure);
  });

  it("dates the row at the current second, never later", async () => {
    const { repo } = repoI(tempDir());
    fs.writeFileSync(path.join(repo, "untracked"), "");
    const before = Math.floor(Date.now() / 1000);
    const result = await loadCommits(createGit(repo, "git"), defaults);
    const after = Date.now() / 1000;
    const date = result.commits[0]?.date ?? Number.NaN;
    expect(Number.isInteger(date)).toBe(true);
    expect(date).toBeGreaterThanOrEqual(before);
    expect(date).toBeLessThanOrEqual(after);
  });

  it("rounds the row's date down to whole seconds", async () => {
    const { repo } = repoI(tempDir());
    fs.writeFileSync(path.join(repo, "untracked"), "");
    const client = createGit(repo, "git");
    vi.useFakeTimers({ toFake: ["Date"], now: 1_750_000_000_900 });
    try {
      const result = await loadCommits(client, { ...defaults, dateType: "Commit Date" });
      expect(result.commits[0]).toMatchObject({ hash: "*", date: 1_750_000_000 });
    } finally {
      vi.useRealTimers();
    }
  });
});
