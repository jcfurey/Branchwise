import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { createGit } from "@/backend/gitClient";
import { loadAmendPlan, loadEditPlan, loadRewordPlan } from "@/backend/queries/editCommit";
import { loadOperation, repositoryQuery } from "@/backend/queries/repository";
import type { RepositoryAction } from "@/backend/types";

import { makeRepo } from "@tests/backend/helpers";

let repo = "";
const read = (args: string[]) =>
  execFileSync("git", args, { cwd: repo, stdio: "pipe" }).toString().trim();
const git = () => createGit(repo, "git");
const run = (action: RepositoryAction) => runRepositoryAction(git(), action);
function commit(file: string, contents: string, message = contents) {
  fs.writeFileSync(path.join(repo, file), contents);
  read(["add", "--", file]);
  read(["commit", "-m", message]);
  return read(["rev-parse", "HEAD"]);
}
function stage(file: string, contents: string) {
  fs.writeFileSync(path.join(repo, file), contents);
  read(["add", "--", file]);
}
/** The tree of each commit from HEAD back to the root, which an edit of a message keeps. */
const trees = () => read(["log", "--format=%T"]);
const subjects = () => read(["log", "--format=%s"]);

beforeEach(() => {
  repo = makeRepo();
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

describe("edit message", () => {
  it("amends only the message of HEAD and keeps what is staged", async () => {
    commit("a", "a");
    const parent = read(["rev-parse", "HEAD^"]);
    const before = trees();
    stage("a", "staged");
    const plan = await loadRewordPlan(git(), "HEAD");
    expect(plan).toMatchObject({ branch: "main", message: "a", later: 0, pushed: false });
    await run({ kind: "reword", plan, message: "new subject\n\n#42 stays" });
    expect(read(["log", "-1", "--format=%B"])).toBe("new subject\n\n#42 stays");
    expect(read(["rev-parse", "HEAD^"])).toBe(parent);
    expect(trees()).toBe(before);
    expect(read(["diff", "--cached", "--name-only"])).toBe("a");
  });

  it("amends a root commit that is HEAD, and one that changes nothing", async () => {
    await run({ kind: "reword", plan: await loadRewordPlan(git(), "HEAD"), message: "root" });
    expect(subjects()).toBe("root");
    read(["commit", "--allow-empty", "-m", "empty"]);
    await run({ kind: "reword", plan: await loadRewordPlan(git(), "HEAD"), message: "still" });
    expect(subjects()).toBe("still\nroot");
  });

  it("rewords an older commit and keeps every tree and later commit", async () => {
    commit("a", "a");
    const target = commit("b", "b");
    commit("c", "c");
    commit("d", "d");
    const before = trees();
    const plan = await loadRewordPlan(git(), target);
    expect(plan).toMatchObject({ target, message: "b", later: 2 });
    await run({ kind: "reword", plan, message: "b reworded\n\n# not a comment" });
    expect(subjects()).toBe("d\nc\nb reworded\na\ninit");
    expect(read(["log", "-1", "--format=%B", "HEAD~2"])).toBe("b reworded\n\n# not a comment");
    expect(trees()).toBe(before);
    expect(await loadOperation(git())).toBeNull();
  });

  it("reports a commit a remote-tracking branch already contains", async () => {
    const pushed = commit("a", "a");
    read(["update-ref", "refs/remotes/origin/main", "HEAD"]);
    const local = commit("b", "b");
    expect((await loadEditPlan(git(), pushed)).pushed).toBe(true);
    expect((await loadEditPlan(git(), local)).pushed).toBe(false);
  });

  it("refuses commits that cannot be rewritten in place", async () => {
    const root = read(["rev-parse", "HEAD"]);
    read(["checkout", "-q", "-b", "side"]);
    const side = commit("s", "side");
    read(["checkout", "-q", "main"]);
    const before = commit("a", "a");
    read(["merge", "--no-ff", "-q", "-m", "merge side", "side"]);
    // HEAD is amended, so it may be a merge.
    await expect(loadRewordPlan(git(), "HEAD")).resolves.toMatchObject({ later: 0 });
    const after = commit("b", "b");
    commit("c", "c");
    await expect(loadRewordPlan(git(), root)).rejects.toThrow(/first commit/);
    await expect(loadRewordPlan(git(), before)).rejects.toThrow(/merge/);
    await expect(loadRewordPlan(git(), side)).rejects.toThrow(/checked-out branch/);
    read(["checkout", "-q", "-b", "other", "side"]);
    const elsewhere = commit("o", "other");
    read(["checkout", "-q", "main"]);
    await expect(loadRewordPlan(git(), elsewhere)).rejects.toThrow(/checked-out branch/);
    read(["checkout", "-q", "--detach"]);
    await expect(loadRewordPlan(git(), "HEAD")).rejects.toThrow(/Check out a branch/);
    read(["checkout", "-q", "main"]);
    // The merge stays below the rebase that rewords a later commit.
    expect((await loadRewordPlan(git(), after)).later).toBe(1);
    await expect(loadRewordPlan(git(), "HEAD^^")).rejects.toThrow(/merge/);
    fs.writeFileSync(path.join(repo, "untracked"), "x");
    await expect(loadRewordPlan(git(), after)).rejects.toThrow(/stash/);
    await expect(loadRewordPlan(git(), "HEAD")).resolves.toMatchObject({ later: 0 });
  });

  it("refuses an empty message and a branch that moved since the dialog opened", async () => {
    const target = commit("a", "a");
    commit("b", "b");
    const plan = await loadRewordPlan(git(), target);
    await expect(run({ kind: "reword", plan, message: " \n " })).rejects.toThrow(/message/);
    commit("c", "c");
    await expect(run({ kind: "reword", plan, message: "new" })).rejects.toThrow(/branch changed/);
    expect(subjects()).toBe("c\nb\na\ninit");
  });
});

describe("add staged changes to a commit", () => {
  it("folds the staged changes into an older commit and keeps the later ones", async () => {
    const base = read(["rev-parse", "HEAD"]);
    const target = commit("a", "a");
    commit("b", "b");
    stage("a", "corrected");
    const data = await repositoryQuery(git(), { kind: "amendPlan", target });
    if (data.kind !== "amendPlan") {
      throw new Error("No plan");
    }
    expect(data.plan).toMatchObject({ target, later: 1, staged: { files: ["a"] } });
    await run({ kind: "amendCommit", plan: data.plan });
    expect(subjects()).toBe("b\na\ninit");
    expect(read(["show", "HEAD^:a"])).toBe("corrected");
    expect(read(["rev-parse", "HEAD~2"])).toBe(base);
    expect(read(["status", "--porcelain"])).toBe("");
  });

  it("folds into the chosen commit when another shares its subject", async () => {
    const target = commit("a", "a", "same");
    commit("b", "b", "same");
    stage("a", "corrected");
    await run({ kind: "amendCommit", plan: await loadAmendPlan(git(), target) });
    expect(subjects()).toBe("same\nsame\ninit");
    expect(read(["show", "HEAD^:a"])).toBe("corrected");
    expect(read(["diff", "HEAD^", "HEAD", "--name-only"])).toBe("b");
  });

  it("amends HEAD and leaves unstaged changes alone", async () => {
    commit("a", "a");
    stage("a", "staged");
    fs.writeFileSync(path.join(repo, "a"), "unstaged");
    await run({ kind: "amendCommit", plan: await loadAmendPlan(git(), "HEAD") });
    expect(subjects()).toBe("a\ninit");
    expect(read(["show", "HEAD:a"])).toBe("staged");
    expect(read(["status", "--porcelain"])).toBe("M a");
  });

  it("refuses without staged changes, with other changes, or once the index moved", async () => {
    const target = commit("a", "a");
    commit("b", "b");
    await expect(loadAmendPlan(git(), target)).rejects.toThrow(/Stage the changes/);
    stage("a", "staged");
    fs.writeFileSync(path.join(repo, "b"), "unstaged");
    await expect(loadAmendPlan(git(), target)).rejects.toThrow(/unstaged and untracked/);
    read(["checkout", "--", "b"]);
    fs.writeFileSync(path.join(repo, "new"), "untracked");
    await expect(loadAmendPlan(git(), target)).rejects.toThrow(/unstaged and untracked/);
    fs.rmSync(path.join(repo, "new"));
    const plan = await loadAmendPlan(git(), target);
    stage("a", "staged again");
    await expect(run({ kind: "amendCommit", plan })).rejects.toThrow(/staged changes changed/);
    await expect(loadAmendPlan(git(), "HEAD~2")).rejects.toThrow(/first commit/);
    expect(subjects()).toBe("b\na\ninit");
  });

  it("leaves a conflicting autosquash in progress for recovery", async () => {
    const target = commit("f", "first");
    commit("f", "second");
    stage("f", "third");
    const plan = await loadAmendPlan(git(), target);
    await expect(run({ kind: "amendCommit", plan })).rejects.toThrow();
    const operation = await loadOperation(git());
    expect(operation?.kind).toBe("rebase");
    await run({ kind: "recover", operation: operation!, resolution: "abort" });
    // Abort keeps the staged changes in the fixup commit at the top of the branch.
    expect(subjects()).toBe("fixup! first\nsecond\nfirst\ninit");
    expect(read(["show", "HEAD:f"])).toBe("third");
    expect(fs.existsSync(path.join(repo, ".git", "branchwise-rebase"))).toBe(false);
  });
});
