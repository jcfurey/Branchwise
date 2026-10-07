import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { createGit } from "@/backend/gitClient";
import { loadWorktrees, repositoryQuery } from "@/backend/queries/repository";
import { loadWorktreeChanges } from "@/backend/queries/worktrees";
import { normalizeRepoPath } from "@/backend/utils/repoPath";

import { git, gitOutput } from "@tests/backend/helpers";
import { onWindows, sandbox } from "@tests/backend/sandbox";

const box = sandbox();

/** Every file and folder under `root`, with each file's size, modification time and contents. */
function snapshot(root: string, into = new Map<string, string>(), prefix = "") {
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    const name = prefix + entry.name;
    if (entry.isDirectory()) {
      into.set(name, "folder");
      snapshot(full, into, name + "/");
    } else {
      const { size, mtimeMs } = fs.statSync(full);
      const digest = createHash("sha1").update(fs.readFileSync(full)).digest("hex");
      into.set(name, `${size} ${mtimeMs} ${digest}`);
    }
  }
  return into;
}

/** A newer modification time without new contents, which makes a plain status rewrite the index. */
function touch(file: string) {
  const later = new Date(Date.now() + 60_000);
  fs.utimesSync(file, later, later);
}

/** A worktree of `repo` in a new folder named `name`, made by `git worktree add` with `args`. */
function addWorktree(repo: string, name: string, ...args: string[]) {
  const folder = path.join(box.folder("wt"), name);
  git(["worktree", "add", "-q", ...args, folder, ...(args.includes("-b") ? [] : ["HEAD"])], repo);
  return folder;
}

const changes = async (repo: string, limit?: number, timeout?: number) =>
  (await loadWorktreeChanges(createGit(repo, "git"), limit, timeout)).toSorted((a, b) =>
    a.path.localeCompare(b.path)
  );

const key = (folder: string) => normalizeRepoPath(folder);

describe("worktree changes", () => {
  it("tells changed worktrees from clean ones and missing ones, and changes nothing", async () => {
    const repo = box.repo();
    const named = addWorktree(repo, "feature with spaces", "-b", "feature");
    const detached = addWorktree(repo, "detached", "--detach");
    const locked = addWorktree(repo, "locked", "-b", "held");
    const gone = addWorktree(repo, "gone", "-b", "gone");
    git(["worktree", "lock", "--reason", "on a removable drive", locked], repo);
    fs.rmSync(gone, { recursive: true, force: true });

    // A change to a tracked file, a staged change, and an untracked file, which does not count.
    fs.writeFileSync(path.join(named, "f"), "edited");
    fs.writeFileSync(path.join(locked, "g"), "new");
    git(["add", "g"], locked);
    fs.writeFileSync(path.join(detached, "untracked"), "left alone");
    for (const folder of [repo, named, detached, locked]) {
      touch(path.join(folder, "f"));
    }
    const before = [repo, named, detached, locked].map((folder) => snapshot(folder));
    const refs = gitOutput(["for-each-ref"], repo);

    expect(await changes(repo)).toEqual(
      [
        { path: key(named), state: "dirty" },
        { path: key(detached), state: "clean" },
        { path: key(locked), state: "dirty" },
        { path: key(gone), state: "missing" }
      ].toSorted((a, b) => a.path.localeCompare(b.path))
    );
    expect([repo, named, detached, locked].map((folder) => snapshot(folder))).toEqual(before);
    expect(gitOutput(["for-each-ref"], repo)).toBe(refs);

    // A plain `git status` rewrites the index it refreshed, which the snapshot would notice.
    git(["status", "--porcelain"], detached);
    expect(snapshot(repo)).not.toEqual(before[0]);
  });

  it("reads each worktree's branch, lock and missing folder from Git's porcelain list", async () => {
    const repo = box.repo();
    const named = addWorktree(repo, "feature with spaces", "-b", "feature");
    const detached = addWorktree(repo, "detached", "--detach");
    const gone = addWorktree(repo, "gone", "-b", "gone");
    git(["worktree", "lock", "--reason", "kept\nfor later", named], repo);
    fs.rmSync(gone, { recursive: true, force: true });
    const head = gitOutput(["rev-parse", "HEAD"], repo);

    const [main, ...linked] = await loadWorktrees(createGit(repo, "git"));
    // The main worktree comes first; Git orders the linked ones itself.
    expect(main).toEqual({
      path: key(repo),
      head,
      branch: "main",
      bare: false,
      locked: false,
      prunable: false
    });
    expect(linked.toSorted((a, b) => a.branch.localeCompare(b.branch))).toEqual([
      { path: key(detached), head, branch: "", bare: false, locked: false, prunable: false },
      { path: key(named), head, branch: "feature", bare: false, locked: true, prunable: false },
      { path: key(gone), head, branch: "gone", bare: false, locked: false, prunable: true }
    ]);
  });

  it("checks the main worktree from a linked one, and leaves out the one shown", async () => {
    const repo = box.repo();
    const linked = addWorktree(repo, "linked", "-b", "linked");
    fs.writeFileSync(path.join(repo, "f"), "edited");

    expect(await changes(linked)).toEqual([{ path: key(repo), state: "dirty" }]);
    const answer = await repositoryQuery(createGit(linked, "git"), { kind: "worktreeChanges" });
    expect(answer).toEqual({
      kind: "worktreeChanges",
      worktrees: [{ path: key(repo), state: "dirty" }]
    });
  });

  it("leaves out a bare repository, which has no work tree", async () => {
    const bare = box.bare();
    const source = box.repo();
    git(["push", "-q", bare, "main"], source);
    const linked = path.join(box.folder("wt"), "linked");
    git(["worktree", "add", "-q", linked, "main"], bare);

    expect((await loadWorktrees(createGit(linked, "git")))[0]).toMatchObject({
      path: key(bare),
      bare: true
    });
    expect(await changes(linked)).toEqual([]);
  });

  it("checks only as many worktrees as the limit allows, and reports the rest unchecked", async () => {
    const repo = box.repo();
    const first = addWorktree(repo, "first", "-b", "first");
    const second = addWorktree(repo, "second", "-b", "second");
    const gone = addWorktree(repo, "gone", "-b", "gone");
    fs.rmSync(gone, { recursive: true, force: true });
    fs.writeFileSync(path.join(first, "f"), "edited");
    fs.writeFileSync(path.join(second, "f"), "edited");

    const found = await changes(repo, 1);
    // A missing folder is never checked, so it does not count against the limit.
    expect(found.find((entry) => entry.path === key(gone))?.state).toBe("missing");
    expect(found.map((entry) => entry.state).toSorted()).toEqual(["dirty", "missing", "unchecked"]);
  });

  // A shell script stands in for the file system monitor, which Git on Windows does not run.
  it.skipIf(onWindows)("gives up on a worktree that takes too long", async () => {
    const repo = box.repo();
    const slow = addWorktree(repo, "slow", "-b", "slow");
    const hook = path.join(box.folder("hook"), "fsmonitor");
    fs.writeFileSync(hook, "#!/bin/sh\nexec sleep 30\n", { mode: 0o755 });
    git(["config", "core.fsmonitor", hook], repo);
    touch(path.join(slow, "f"));

    const started = Date.now();
    expect(await changes(repo, undefined, 1000)).toEqual([{ path: key(slow), state: "unchecked" }]);
    expect(Date.now() - started).toBeLessThan(10_000);
  });
});

describe("worktree folder actions", () => {
  it("opens or reveals a worktree whose folder is there", async () => {
    const repo = box.repo();
    const named = addWorktree(repo, "feature with spaces", "-b", "feature");
    const client = createGit(repo, "git");

    expect(await runRepositoryAction(client, { kind: "revealWorktree", path: named })).toEqual({
      kind: "reveal",
      path: key(named)
    });
    expect(await runRepositoryAction(client, { kind: "openWorktree", path: named })).toEqual({
      kind: "worktree",
      path: key(named)
    });
  });

  it("refuses a worktree whose folder is gone", async () => {
    const repo = box.repo();
    const gone = addWorktree(repo, "gone", "-b", "gone");
    fs.rmSync(gone, { recursive: true, force: true });
    const client = createGit(repo, "git");

    await expect(
      runRepositoryAction(client, { kind: "revealWorktree", path: gone })
    ).rejects.toThrow(/no longer available/);
    await expect(runRepositoryAction(client, { kind: "openWorktree", path: gone })).rejects.toThrow(
      /no longer available/
    );
  });
});
