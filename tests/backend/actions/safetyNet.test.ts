import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { deleteBranch, renameBranch } from "@/backend/actions/branch";
import { resetToCommit } from "@/backend/actions/commit";
import { mergeBranch } from "@/backend/actions/merge";
import { pushBranch } from "@/backend/actions/remote";
import { runRepositoryAction } from "@/backend/actions/repository";
import { recordedAction } from "@/backend/actions/safetyNet";
import { deleteTag } from "@/backend/actions/tag";
import { createGit } from "@/backend/gitClient";
import { loadAbsorbPlan } from "@/backend/queries/absorb";
import { loadAmendPlan, loadRewordPlan } from "@/backend/queries/editCommit";
import { loadBatchPlan, loadReflog } from "@/backend/queries/history";
import { loadBranches } from "@/backend/queries/loadBranches";
import { loadCommits } from "@/backend/queries/loadCommits";
import {
  loadRebasePlan,
  loadRepositoryState,
  loadStashes,
  squashRebasePlan
} from "@/backend/queries/repository";
import {
  loadSafetyNet,
  loadSafetyUndo,
  readSafetyJournal,
  safetyJournalFile,
  SAFETY_NET_LIMIT
} from "@/backend/queries/safetyNet";
import { loadCleanupPlan, loadFastForwardPlan } from "@/backend/queries/workflows";
import type { ActionRequest, RepositoryAction, SafetyRecord } from "@/backend/types";

import { makeRepo } from "@tests/backend/helpers";

let repo = "";
let dirs: string[] = [];
const read = (args: string[], cwd = repo) =>
  execFileSync("git", args, { cwd, stdio: "pipe" }).toString().trim();
const git = () => createGit(repo, "git");
const hash = (ref: string) => read(["rev-parse", ref]);

function write(file: string, contents: string) {
  fs.writeFileSync(path.join(repo, file), contents);
}
function commit(file: string, contents: string, message = contents) {
  write(file, contents);
  read(["add", "--", file]);
  read(["commit", "-q", "-m", message]);
  return hash("HEAD");
}

/** A request as a test spells it, every kind without its repository. */
type TestRequest = ActionRequest extends infer R
  ? R extends unknown
    ? Omit<R, "repo">
    : never
  : never;

/** Run one request as the extension does: through the Safety Net, then the backend function. */
function act(request: TestRequest) {
  const full = { ...request, repo } as ActionRequest;
  const client = git();
  return recordedAction(client, full, () => {
    switch (full.command) {
      case "resetToCommit":
        return resetToCommit(client, full);
      case "deleteBranch":
        return deleteBranch(client, full);
      case "deleteTag":
        return deleteTag(client, full);
      case "renameBranch":
        return renameBranch(client, full);
      case "mergeBranch":
        return mergeBranch(client, full, "git");
      case "pushBranch":
        return pushBranch(client, full);
      case "repositoryAction":
        return runRepositoryAction(client, full.action, "git");
      default:
        throw new Error(`No test dispatch for ${full.command}`);
    }
  });
}
const repositoryAction = (action: RepositoryAction) =>
  act({ command: "repositoryAction", requestId: "test", action });

/** Undo the action the header would offer to undo. */
async function undo() {
  const offered = await loadSafetyUndo(git());
  expect(offered).not.toBeNull();
  await runRepositoryAction(git(), { kind: "undoSafetyNet", id: offered!.id });
}
const undoRecord = (record: SafetyRecord) =>
  runRepositoryAction(git(), { kind: "undoSafetyNet", id: record.id });

/**
 * Everything Undo must put back: the refs (apart from the Safety Net's own), the stash list,
 * HEAD, the staged and unstaged changes and the untracked files, and branch settings.
 */
function snapshot() {
  return {
    refs: read(["for-each-ref", "--format=%(refname) %(objectname)"])
      .split("\n")
      .filter((line) => !line.startsWith("refs/branchwise/"))
      .join("\n"),
    stashes: read(["stash", "list", "--format=%H %gs"]),
    head: read(["rev-parse", "--symbolic-full-name", "HEAD"]) + " " + hash("HEAD"),
    status: read(["status", "--porcelain=v1", "--untracked-files=all"]),
    staged: read(["diff", "--cached"]),
    unstaged: read(["diff"]),
    config: read(["config", "--local", "--list"])
      .split("\n")
      .filter((line) => line.startsWith("branch."))
      .toSorted()
  };
}

/** Run `action`, check it recorded something and changed the repository, undo it, compare. */
async function roundTrip(action: () => Promise<{ record: SafetyRecord | null }>) {
  const before = snapshot();
  const { record } = await action();
  expect(record).not.toBeNull();
  expect(record!.state).toBe("done");
  expect(snapshot()).not.toEqual(before);
  await undo();
  expect(snapshot()).toEqual(before);
  expect((await readSafetyJournal(git())).at(-1)?.state).toBe("undone");
  return record!;
}

beforeEach(() => {
  repo = makeRepo();
  dirs = [repo];
});
afterEach(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

describe("recording and undoing each destructive action", () => {
  it("undoes soft, mixed and hard resets, bringing back discarded changes", async () => {
    commit("a", "one");
    commit("a", "two");
    const target = commit("a", "three");
    commit("b", "four");
    commit("a", "five");
    for (const resetMode of ["soft", "mixed", "hard"] as const) {
      write("a", "edited " + resetMode);
      write("b", "staged " + resetMode);
      read(["add", "--", "b"]);
      write("untracked", "stays");
      // eslint-disable-next-line no-await-in-loop
      const record = await roundTrip(() =>
        act({ command: "resetToCommit", commitHash: target, resetMode })
      );
      expect(record).toMatchObject({ head: "refs/heads/main", subject: "main" });
      // A soft reset discards nothing; the others keep the staged, or all, changes.
      expect(record.saved === null).toBe(resetMode === "soft");
      read(["reset", "-q", "--hard"]);
    }
  });

  it("undoes a reset of a detached HEAD", async () => {
    commit("a", "one");
    commit("a", "two");
    read(["checkout", "-q", "--detach"]);
    const record = await roundTrip(() =>
      act({ command: "resetToCommit", commitHash: hash("HEAD~2"), resetMode: "hard" })
    );
    expect(record.changes.map((change) => change.ref)).toEqual(["HEAD"]);
  });

  it("undoes a rebase and an interactive squash", async () => {
    const base = hash("HEAD");
    read(["checkout", "-q", "-b", "topic"]);
    commit("t", "topic one");
    commit("t", "topic two");
    const head = commit("u", "topic three");
    read(["checkout", "-q", "main"]);
    commit("m", "main moves");
    read(["checkout", "-q", "topic"]);
    await roundTrip(() =>
      repositoryAction({ kind: "rebase", branch: "topic", onto: "main", expectedHead: head })
    );
    const plan = squashRebasePlan(await loadRebasePlan(git(), base), [
      hash("HEAD~2"),
      hash("HEAD~1")
    ]);
    const record = await roundTrip(() => repositoryAction({ kind: "interactiveRebase", plan }));
    expect(record.kind).toBe("interactiveRebase");
  });

  it("undoes an absorb, leaving the absorbed changes staged again", async () => {
    commit("a", "one\ntwo\n");
    commit("a", "one\ntwo\nthree\n", "three");
    write("a", "one\ntwo\nthree fixed\n");
    read(["add", "--", "a"]);
    const record = await roundTrip(async () =>
      repositoryAction({ kind: "absorb", plan: await loadAbsorbPlan(git()) })
    );
    expect(record).toMatchObject({ kind: "absorb", subject: "main" });
  });

  it("undoes message edits and amends, leaving the folded-in changes staged again", async () => {
    commit("a", "one");
    commit("b", "two");
    commit("c", "three");
    await roundTrip(async () =>
      repositoryAction({
        kind: "reword",
        plan: await loadRewordPlan(git(), "HEAD~1"),
        message: "two, reworded"
      })
    );
    await roundTrip(async () =>
      repositoryAction({
        kind: "reword",
        plan: await loadRewordPlan(git(), "HEAD"),
        message: "three, reworded"
      })
    );
    write("b", "two plus staged");
    read(["add", "--", "b"]);
    await roundTrip(async () =>
      repositoryAction({ kind: "amendCommit", plan: await loadAmendPlan(git(), "HEAD~1") })
    );
    await roundTrip(async () =>
      repositoryAction({ kind: "amendCommit", plan: await loadAmendPlan(git(), "HEAD") })
    );
    expect(read(["diff", "--cached", "--name-only"])).toBe("b");
  });

  it("recreates deleted and force-deleted branches with their settings", async () => {
    read(["remote", "add", "origin", "https://example.invalid/repo.git"]);
    read(["branch", "merged"]);
    read(["config", "branch.merged.remote", "origin"]);
    read(["config", "branch.merged.merge", "refs/heads/merged"]);
    const record = await roundTrip(() =>
      act({ command: "deleteBranch", branchName: "merged", forceDelete: false })
    );
    expect(record.config).toEqual([
      ["branch.merged.remote", "origin"],
      ["branch.merged.merge", "refs/heads/merged"]
    ]);
    read(["checkout", "-q", "-b", "unmerged"]);
    commit("x", "only here");
    read(["checkout", "-q", "main"]);
    await roundTrip(() =>
      act({ command: "deleteBranch", branchName: "unmerged", forceDelete: true })
    );
  });

  it("undoes a cleanup of merged branches", async () => {
    read(["branch", "done-1"]);
    read(["branch", "done-2"]);
    await roundTrip(async () =>
      repositoryAction({ kind: "cleanup", plan: await loadCleanupPlan(git()) })
    );
  });

  it("recreates deleted lightweight and annotated tags as they were", async () => {
    read(["tag", "light"]);
    read(["tag", "-a", "-m", "notes", "annotated"]);
    await roundTrip(() => act({ command: "deleteTag", tagName: "light" }));
    const record = await roundTrip(() => act({ command: "deleteTag", tagName: "annotated" }));
    // The tag object itself comes back, not only the commit it names.
    expect(record.changes[0]!.old).toBe(hash("refs/tags/annotated"));
    expect(read(["cat-file", "-t", "annotated"])).toBe("tag");
  });

  it("renames a branch back, the checked-out one included", async () => {
    read(["branch", "old-name"]);
    read(["config", "branch.old-name.description", "kept"]);
    await roundTrip(() => act({ command: "renameBranch", oldName: "old-name", newName: "new" }));
    await roundTrip(() => act({ command: "renameBranch", oldName: "main", newName: "trunk" }));
  });

  it("puts a dropped stash back in the stash list", async () => {
    write("f", "stashed");
    read(["stash", "push", "-q", "-m", "keep me"]);
    const [stash] = await loadStashes(git());
    const record = await roundTrip(() =>
      repositoryAction({ kind: "stash", operation: "drop", stash: stash!, reinstateIndex: false })
    );
    expect(record).toMatchObject({ kind: "dropStash", subject: stash!.message });
  });

  it("undoes merges and fast-forwards of every branch", async () => {
    read(["checkout", "-q", "-b", "feature"]);
    commit("g", "feature work");
    read(["checkout", "-q", "main"]);
    commit("h", "main work");
    await roundTrip(() =>
      act({ command: "mergeBranch", branchName: "feature", createNewCommit: true })
    );

    read(["remote", "add", "origin", "https://example.invalid/repo.git"]);
    const base = hash("HEAD");
    const ahead = read(["commit-tree", `${base}^{tree}`, "-p", base, "-m", "upstream"]);
    for (const name of ["main", "behind"]) {
      if (name !== "main") {
        read(["branch", name, base]);
      }
      read(["update-ref", `refs/remotes/origin/${name}`, ahead]);
      read(["branch", `--set-upstream-to=origin/${name}`, name]);
    }
    const plan = await loadFastForwardPlan(git());
    expect(plan.branches.map((branch) => branch.name)).toEqual(["behind", "main"]);
    const record = await roundTrip(() =>
      repositoryAction({ kind: "fastForward", branches: plan.branches })
    );
    expect(record.changes.map((change) => change.ref)).toEqual([
      "refs/heads/behind",
      "refs/heads/main"
    ]);
  });

  it("undoes a cherry-pick and a revert of a commit range", async () => {
    read(["checkout", "-q", "-b", "source"]);
    const picks = [commit("p", "pick 1"), commit("q", "pick 2")];
    read(["checkout", "-q", "main"]);
    for (const operation of ["cherry-pick", "revert"] as const) {
      const hashes = operation === "cherry-pick" ? picks : [hash("HEAD")];
      if (operation === "revert") {
        commit("r", "to revert");
        hashes.splice(0, 1, hash("HEAD"));
      }
      // eslint-disable-next-line no-await-in-loop
      const plan = await loadBatchPlan(git(), hashes);
      // eslint-disable-next-line no-await-in-loop
      await roundTrip(() => repositoryAction({ kind: "batch", operation, plan, mainline: 1 }));
    }
  });

  it("records a force push with the remote branch's old commit, without offering to undo it", async () => {
    const remote = fs.realpathSync.native(fs.mkdtempSync(path.join(path.dirname(repo), "bare-")));
    dirs.push(remote);
    read(["init", "-q", "--bare"], remote);
    read(["remote", "add", "origin", remote]);
    commit("a", "pushed");
    read(["push", "-q", "-u", "origin", "main"]);
    const old = hash("origin/main");
    read(["commit", "-q", "--amend", "-m", "rewritten"]);
    const { record } = await act({
      command: "pushBranch",
      requestId: "push",
      branchName: "main",
      remote: "origin",
      remoteBranch: "main",
      setUpstream: false,
      expectedRemoteHash: old
    });
    expect(record).toMatchObject({
      kind: "forcePush",
      undoable: false,
      changes: [{ ref: "refs/remotes/origin/main", old, new: hash("HEAD") }]
    });
    expect(await loadSafetyUndo(git())).toBeNull();
    await expect(undoRecord(record!)).rejects.toThrow(/cannot undo/);
    // The old remote commit stays reachable through the backup, and is listed as lost.
    const [entry] = await loadSafetyNet(git());
    expect(entry!.lost.map((lost) => lost.hash)).toEqual([old]);
  });
});

describe("Undo's safeguards", () => {
  it("refuses once a recorded ref has moved, and changes nothing", async () => {
    commit("a", "one");
    commit("a", "two");
    await act({ command: "resetToCommit", commitHash: hash("HEAD~2"), resetMode: "hard" });
    commit("b", "later work");
    const before = snapshot();
    const offered = await loadSafetyUndo(git());
    await expect(
      runRepositoryAction(git(), { kind: "undoSafetyNet", id: offered!.id })
    ).rejects.toThrow(/main changed after the Hard Reset of main/);
    expect(snapshot()).toEqual(before);

    read(["branch", "gone"]);
    await act({ command: "deleteBranch", branchName: "gone", forceDelete: false });
    read(["branch", "gone"]);
    await expect(undo()).rejects.toThrow(/gone changed/);
  });

  it("refuses when uncommitted changes would be overwritten", async () => {
    const base = hash("HEAD");
    commit("a", "one");
    await act({ command: "resetToCommit", commitHash: base, resetMode: "hard" });
    write("a", "new work in a file the undo would bring back");
    const before = snapshot();
    await expect(undo()).rejects.toThrow(/Commit or stash/);
    expect(snapshot()).toEqual(before);
  });

  it("refuses to undo a mixed reset over staged changes", async () => {
    commit("a", "one");
    await act({ command: "resetToCommit", commitHash: hash("HEAD~1"), resetMode: "mixed" });
    write("b", "staged later");
    read(["add", "--", "b"]);
    await expect(undo()).rejects.toThrow(/unstage/);
  });

  it("refuses while an operation is stopped, and completes a merge recorded before it stopped", async () => {
    read(["checkout", "-q", "-b", "other"]);
    commit("f", "other side");
    read(["checkout", "-q", "main"]);
    commit("f", "main side");
    const before = snapshot();
    await expect(
      act({ command: "mergeBranch", branchName: "other", createNewCommit: false })
    ).rejects.toThrow(/conflicts/);
    const [pending] = await readSafetyJournal(git());
    expect(pending).toMatchObject({ kind: "merge", state: "pending", operation: "merge" });
    expect(await loadSafetyUndo(git())).toBeNull();
    await expect(undoRecord(pending!)).rejects.toThrow(/in progress/);

    write("f", "resolved");
    read(["add", "--", "f"]);
    const [state] = [await loadRepositoryState(git())];
    await repositoryAction({
      kind: "recover",
      operation: state.operation!,
      resolution: "continue"
    });
    expect((await readSafetyJournal(git()))[0]).toMatchObject({ state: "done" });
    await undo();
    expect(snapshot()).toEqual(before);
  });

  it("writes the record and its backups before the action starts", async () => {
    commit("a", "one");
    const tip = hash("HEAD");
    const request = {
      command: "resetToCommit",
      repo,
      commitHash: hash("HEAD~1"),
      resetMode: "hard"
    } as const;
    let seen: [SafetyRecord | undefined, string] | undefined;
    await recordedAction(git(), request, async () => {
      seen = [
        (await readSafetyJournal(git())).at(-1),
        read(["for-each-ref", "--format=%(objectname)", "refs/branchwise/backup/"])
      ];
      await resetToCommit(git(), request);
    });
    expect(seen?.[0]).toMatchObject({
      kind: "hardReset",
      state: "pending",
      changes: [{ ref: "refs/heads/main", old: tip, new: tip }]
    });
    expect(seen?.[1]).toBe(tip);
    expect((await readSafetyJournal(git()))[0]).toMatchObject({
      state: "done",
      changes: [{ ref: "refs/heads/main", old: tip, new: hash("HEAD") }]
    });
  });

  it("refuses to move a branch checked out in another worktree", async () => {
    const other = path.join(path.dirname(repo), path.basename(repo) + "-wt");
    dirs.push(other);
    read(["branch", "elsewhere"]);
    const base = hash("HEAD");
    read(["worktree", "add", "-q", other, "elsewhere"]);
    commit("a", "one");
    read(["remote", "add", "origin", "https://example.invalid/repo.git"]);
    read(["update-ref", "refs/remotes/origin/elsewhere", hash("HEAD")]);
    read(["branch", "--set-upstream-to=origin/elsewhere", "elsewhere"]);
    read(["checkout", "-q", "--detach", base], other);
    const plan = await loadFastForwardPlan(git());
    await repositoryAction({ kind: "fastForward", branches: plan.branches });
    read(["checkout", "-q", "elsewhere"], other);
    await expect(undo()).rejects.toThrow(/checked out in the worktree/);
  });

  it("forgets an action that failed before changing anything", async () => {
    read(["checkout", "-q", "-b", "unmerged"]);
    commit("x", "only here");
    read(["checkout", "-q", "main"]);
    await expect(
      act({ command: "deleteBranch", branchName: "unmerged", forceDelete: false })
    ).rejects.toThrow();
    expect(await readSafetyJournal(git())).toEqual([]);
    expect(read(["for-each-ref", "refs/branchwise/"])).toBe("");
  });

  it("offers the action before an undone one next", async () => {
    read(["branch", "first"]);
    read(["branch", "second"]);
    await act({ command: "deleteBranch", branchName: "first", forceDelete: false });
    await act({ command: "deleteBranch", branchName: "second", forceDelete: false });
    expect((await loadSafetyUndo(git()))?.title).toBe("Deletion of Branch second");
    await undo();
    expect((await loadSafetyUndo(git()))?.title).toBe("Deletion of Branch first");
    expect((await loadRepositoryState(git())).undo?.title).toBe("Deletion of Branch first");
    await undo();
    expect(await loadSafetyUndo(git())).toBeNull();
    expect(read(["for-each-ref", "--format=%(refname:short)", "refs/heads/"]).split("\n")).toEqual([
      "first",
      "main",
      "second"
    ]);
  });
});

describe("the backups", () => {
  it("keep lost commits out of the graph, the branch lists and the reflog's refs", async () => {
    const base = hash("HEAD");
    const lost = [commit("a", "lost one"), commit("a", "lost two")];
    await act({ command: "resetToCommit", commitHash: base, resetMode: "hard" });
    expect(read(["for-each-ref", "--format=%(refname)", "refs/branchwise/"])).toMatch(
      /^refs\/branchwise\/backup\/\d+-0\/old-0$/
    );
    for (const showRemoteBranches of [true, false]) {
      // eslint-disable-next-line no-await-in-loop
      const graph = await loadCommits(git(), {
        branchName: "",
        maxCommits: 50,
        showRemoteBranches,
        hard: true,
        dateType: "Commit Date",
        showUncommittedChanges: false
      });
      expect(graph.commits.map((row) => row.hash)).toEqual([base]);
      expect(graph.commits.flatMap((row) => row.refs.map((ref) => ref.name))).toEqual(["main"]);
    }
    const branches = await loadBranches(git(), {
      showRemoteBranches: true,
      hiddenRemotes: [],
      hard: true,
      repo,
      gitPath: "git"
    });
    expect(JSON.stringify(branches)).not.toContain("branchwise");
    const reflog = await loadReflog(git(), { offset: 0, lostOnly: true });
    expect(reflog.refs).toEqual(["HEAD", "refs/heads/main"]);
    expect(new Set(reflog.entries.map((entry) => entry.hash))).toEqual(new Set(lost));

    const [entry] = await loadSafetyNet(git());
    expect(entry).toMatchObject({ title: "Hard Reset of main", restorable: true });
    expect(entry!.lost.map((item) => item.subject)).toEqual(["lost two", "lost one"]);
  });

  it("are listed without changing anything on disk", async () => {
    commit("a", "one");
    await act({ command: "resetToCommit", commitHash: hash("HEAD~1"), resetMode: "hard" });
    const journal = fs.readFileSync(await safetyJournalFile(git()), "utf8");
    const before = [snapshot(), read(["for-each-ref"])];
    await loadSafetyNet(git());
    await loadSafetyUndo(git());
    expect([snapshot(), read(["for-each-ref"])]).toEqual(before);
    expect(fs.readFileSync(await safetyJournalFile(git()), "utf8")).toBe(journal);
  });

  it("prune the oldest records past the limit, and records and backups older than 30 days", async () => {
    const base = hash("HEAD");
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const records: SafetyRecord[] = [];
    // Five records older than 30 days, then one more than the limit of recent ones.
    for (let index = 0; index < SAFETY_NET_LIMIT + 6; index++) {
      const time = index < 5 ? now - 40 * day + index : now - day + index;
      const id = `${time}-0`;
      read(["update-ref", `refs/branchwise/backup/${id}/old-0`, base]);
      records.push({
        id,
        kind: "deleteBranch",
        subject: `branch-${index}`,
        detail: "",
        date: Math.floor(time / 1000),
        head: "refs/heads/main",
        mode: "keep",
        changes: [{ ref: `refs/heads/branch-${index}`, old: base, new: null }],
        saved: null,
        stash: null,
        config: [],
        undoable: true,
        state: "done",
        operation: null
      });
    }
    // Backups no record names: a recent one stays, an old one goes.
    read(["update-ref", `refs/branchwise/backup/${now - 2 * day}-0/old-0`, base]);
    read(["update-ref", `refs/branchwise/backup/${now - 31 * day}-0/old-0`, base]);
    const file = await safetyJournalFile(git());
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ version: 1, records }));

    read(["branch", "doomed"]);
    await act({ command: "deleteBranch", branchName: "doomed", forceDelete: false });

    const kept = await readSafetyJournal(git());
    expect(kept).toHaveLength(SAFETY_NET_LIMIT);
    expect(kept[0]!.subject).toBe("branch-7");
    expect(kept.at(-1)!.subject).toBe("doomed");
    const ids = new Set(
      read(["for-each-ref", "--format=%(refname)", "refs/branchwise/backup/"])
        .split("\n")
        .map((ref) => ref.split("/")[3])
    );
    expect(ids).toEqual(new Set([...kept.map((record) => record.id), `${now - 2 * day}-0`]));
  });
});
