import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { runRepositoryAction } from "@/backend/actions/repository";
import { createGit, PARSED_OUTPUT_ARGS } from "@/backend/gitClient";
import { loadAbsorbPlan } from "@/backend/queries/absorb";
import { loadOperation, repositoryQuery } from "@/backend/queries/repository";
import type { AbsorbPlan, RepositoryAction } from "@/backend/types";

import { makeRepo } from "@tests/backend/helpers";

let repo = "";
/** Git's output in `repo`, with the settings the backend pins, so never in colour. */
const read = (args: string[]) =>
  execFileSync("git", [...PARSED_OUTPUT_ARGS, ...args], { cwd: repo, stdio: "pipe" })
    .toString()
    .trim();
const git = () => createGit(repo, "git");
const run = (action: RepositoryAction) => runRepositoryAction(git(), action);
const write = (file: string, lines: string[]) =>
  fs.writeFileSync(path.join(repo, file), lines.map((line) => line + "\n").join(""));
function commit(message: string, files: Record<string, string[]>) {
  for (const [file, lines] of Object.entries(files)) {
    write(file, lines);
  }
  read(["add", "-A"]);
  read(["commit", "-q", "-m", message]);
  return read(["rev-parse", "HEAD"]);
}
function stage(files: Record<string, string[]>) {
  for (const [file, lines] of Object.entries(files)) {
    write(file, lines);
    read(["add", "--", file]);
  }
}
const subjects = () => read(["log", "--format=%s"]);
/** Everything a read-only query must leave as it was: refs, status, index and work tree. */
const snapshot = () => [
  read(["for-each-ref", "--format=%(refname) %(objectname)"]),
  read(["symbolic-ref", "HEAD"]),
  read(["status", "--porcelain", "--untracked-files=all"]),
  read(["ls-files", "--stage", "--debug"]),
  fs.readFileSync(path.join(repo, ".git", "index")).toString("base64"),
  read(["diff"]),
  read(["diff", "--cached"])
];

let pushed = "";
let first = "";
let second = "";
/**
 * `x` is pushed with five lines. `first` changes its line 2 and adds lines 6 and 7; `second`
 * changes its line 4 and adds `y`. Neither of them is on `origin/main`.
 */
beforeEach(() => {
  repo = makeRepo();
  pushed = commit("pushed", { x: ["p1", "p2", "p3", "p4", "p5"] });
  read(["update-ref", "refs/remotes/origin/main", "HEAD"]);
  first = commit("first", { x: ["p1", "first-2", "p3", "p4", "p5", "first-6", "first-7"] });
  second = commit("second", {
    x: ["p1", "first-2", "p3", "second-4", "p5", "first-6", "first-7"],
    y: ["y1", "y2", "y3"]
  });
});
afterEach(() => {
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

/** Stage fixes to lines that `first` and `second` each changed. */
function stageFixes() {
  stage({
    x: ["p1", "first-2 fixed", "p3", "second-4 fixed", "p5", "first-6", "first-7"],
    y: ["y1", "y2 fixed", "y3"]
  });
}

describe("the absorb preview", () => {
  it("assigns each hunk to the one commit that last changed its lines", async () => {
    stageFixes();
    const plan = await loadAbsorbPlan(git());
    expect(plan).toMatchObject({ branch: "main", base: pushed, left: [], clean: true });
    expect(plan.targets).toEqual([
      {
        hash: first,
        subject: "first",
        hunks: [{ path: "x", oldStart: 2, oldLines: 1, newStart: 2, newLines: 1 }]
      },
      {
        hash: second,
        subject: "second",
        hunks: [
          { path: "x", oldStart: 4, oldLines: 1, newStart: 4, newLines: 1 },
          { path: "y", oldStart: 2, oldLines: 1, newStart: 2, newLines: 1 }
        ]
      }
    ]);
  });

  it("changes nothing: refs, status, index and work tree stay identical", async () => {
    stageFixes();
    write("x", ["p1", "first-2 fixed", "p3", "second-4 fixed", "p5 unstaged", "first-6"]);
    fs.writeFileSync(path.join(repo, "untracked"), "u");
    const before = snapshot();
    const data = await repositoryQuery(git(), { kind: "absorbPlan" });
    expect(data.kind).toBe("absorbPlan");
    expect(snapshot()).toEqual(before);
  });

  it("leaves pushed lines, lines of several commits and pure additions without context", async () => {
    stage({
      x: ["p1 pushed", "first-2", "p3", "second-4", "p5", "first-6", "first-7"]
    });
    let plan = await loadAbsorbPlan(git());
    expect(plan.targets).toEqual([]);
    expect(plan.left).toEqual([
      {
        path: "x",
        hunk: { path: "x", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 },
        reason: "outside"
      }
    ]);
    expect(plan.clean).toBe(false);

    // Lines 2 to 4 were last changed by `first`, the pushed commit and `second`.
    stage({ x: ["p1", "a", "b", "c", "p5", "first-6", "first-7"] });
    plan = await loadAbsorbPlan(git());
    expect(plan.left.map((item) => item.reason)).toEqual(["several"]);

    // Added lines go by the lines around them: both `first`'s, or `first`'s at the end.
    stage({
      x: ["p1", "first-2", "p3", "second-4", "p5", "first-6", "between", "first-7", "end"]
    });
    plan = await loadAbsorbPlan(git());
    expect(plan.targets.map((target) => [target.hash, target.hunks.length])).toEqual([[first, 2]]);
    // Between `p5`, pushed, and `first-6`: two commits.
    stage({ x: ["p1", "first-2", "p3", "second-4", "p5", "new", "first-6", "first-7"] });
    plan = await loadAbsorbPlan(git());
    expect(plan.left.map((item) => item.reason)).toEqual(["several"]);

    read(["reset", "-q", "--hard"]);
    commit("empty", { e: [] });
    stage({ e: ["now something"] });
    plan = await loadAbsorbPlan(git());
    expect(plan.left).toEqual([expect.objectContaining({ path: "e", reason: "noContext" })]);
  });

  it("leaves added, deleted, renamed, binary and mode-changed files staged whole", async () => {
    commit("more", { z: ["z1", "z2", "z3", "z4", "z5", "z6"], w: ["w"], bin: ["b"] });
    stage({ added: ["new"] });
    read(["rm", "-q", "w"]);
    read(["mv", "z", "z-renamed"]);
    fs.writeFileSync(path.join(repo, "bin"), Buffer.from([0, 1, 2, 0]));
    read(["add", "bin"]);
    read(["update-index", "--chmod=+x", "y"]);
    const plan = await loadAbsorbPlan(git());
    expect(plan.targets).toEqual([]);
    expect(plan.left.map((item) => [item.path, item.hunk, item.reason]).toSorted()).toEqual([
      ["added", null, "added"],
      ["bin", null, "binary"],
      ["w", null, "deleted"],
      ["y", null, "special"],
      ["z-renamed", null, "renamed"]
    ]);
  });

  it("only looks at the branch after its upstream, and stops at a merge", async () => {
    // With an upstream, it is the boundary even when other remote-tracking branches are older.
    read(["config", "remote.origin.url", repo]);
    read(["config", "branch.main.remote", "origin"]);
    read(["config", "branch.main.merge", "refs/heads/main"]);
    read(["update-ref", "refs/remotes/origin/main", first]);
    stageFixes();
    let plan = await loadAbsorbPlan(git());
    expect(plan.targets.map((target) => target.hash)).toEqual([second]);
    expect(plan.left.map((item) => item.reason)).toEqual(["outside"]);
    expect(plan.base).toBe(first);

    read(["reset", "-q", "--hard"]);
    read(["checkout", "-q", "-b", "side", first]);
    commit("side", { s: ["s"] });
    read(["checkout", "-q", "main"]);
    read(["merge", "-q", "--no-ff", "-m", "merge side", "side"]);
    const after = commit("after", { a: ["a1"] });
    stageFixes();
    stage({ a: ["a1 fixed"] });
    plan = await loadAbsorbPlan(git());
    expect(plan.targets.map((target) => target.hash)).toEqual([after]);
    expect(plan.left.map((item) => item.reason)).toEqual(["outside", "outside", "outside"]);
  });

  it("refuses a detached HEAD, a branch without commits and nothing staged", async () => {
    await expect(loadAbsorbPlan(git())).rejects.toThrow(/Stage the changes/);
    read(["checkout", "-q", "--detach"]);
    stageFixes();
    await expect(loadAbsorbPlan(git())).rejects.toThrow(/Check out a branch/);
    read(["checkout", "-q", "--orphan", "empty"]);
    await expect(loadAbsorbPlan(git())).rejects.toThrow(/no commits/);
  });
});

describe("absorbing", () => {
  async function absorb(plan?: AbsorbPlan) {
    await run({ kind: "absorb", plan: plan ?? (await loadAbsorbPlan(git())) });
  }

  it("commits one fixup per commit with just its hunks, oldest target first", async () => {
    stageFixes();
    const staged = read(["write-tree"]);
    await absorb();
    expect(subjects()).toBe("fixup! second\nfixup! first\nsecond\nfirst\npushed\ninit");
    expect(read(["diff", "HEAD~2", "HEAD~1"])).toContain("-first-2\n+first-2 fixed");
    expect(read(["diff", "--name-only", "HEAD~2", "HEAD~1"])).toBe("x");
    expect(read(["diff", "-U0", "HEAD~1", "HEAD", "--", "x"])).toMatch(
      /@@ -4 \+4 @@.*\n-second-4\n\+second-4 fixed$/
    );
    expect(read(["diff", "HEAD~1", "HEAD", "--", "y"])).toContain("-y2\n+y2 fixed");
    expect(read(["rev-parse", "HEAD^{tree}"])).toBe(staged);
    expect(read(["status", "--porcelain"])).toBe("");
    expect(read(["reflog", "-1", "--format=%gs"])).toMatch(/absorb/);
  });

  it("keeps unstaged and untracked changes and the hunks it cannot absorb", async () => {
    stage({
      x: ["p1 pushed", "first-2", "p3", "second-4", "p5", "first-6 fixed", "first-7"],
      added: ["new"]
    });
    write("x", [
      "p1 pushed",
      "first-2",
      "p3",
      "second-4",
      "p5 unstaged",
      "first-6 fixed",
      "first-7"
    ]);
    fs.writeFileSync(path.join(repo, "untracked"), "u");
    const staged = read(["write-tree"]);
    const unstaged = read(["diff"]);
    const work = fs.readFileSync(path.join(repo, "x"), "utf8");
    const plan = await loadAbsorbPlan(git());
    expect(plan.clean).toBe(false);
    await absorb(plan);
    expect(subjects()).toBe("fixup! first\nsecond\nfirst\npushed\ninit");
    expect(read(["write-tree"])).toBe(staged);
    expect(read(["diff"])).toBe(unstaged);
    expect(fs.readFileSync(path.join(repo, "x"), "utf8")).toBe(work);
    expect(read(["diff", "--cached", "-U0", "--", "x"])).toMatch(
      /@@ -1 \+1 @@.*\n-p1\n\+p1 pushed$/
    );
    expect(read(["show", "HEAD:x"])).toContain("first-6 fixed");
    expect(read(["status", "--porcelain"]).split("\n")).toEqual([
      "A  added",
      "MM x",
      "?? untracked"
    ]);
  });

  it("refuses a plan the staged changes or the branch moved away from, changing nothing", async () => {
    stageFixes();
    const plan = await loadAbsorbPlan(git());
    stage({ y: ["y1", "y2 fixed again", "y3"] });
    const before = snapshot();
    await expect(absorb(plan)).rejects.toThrow(/staged changes changed/);
    expect(snapshot()).toEqual(before);
    read(["commit", "-q", "-m", "later"]);
    await expect(absorb(plan)).rejects.toThrow(/branch changed/);
    stage({
      x: ["p1 pushed", "first-2 fixed", "p3", "second-4 fixed", "p5", "first-6", "first-7"]
    });
    await expect(absorb()).rejects.toThrow(/None of the staged changes/);
    expect(subjects()).toBe("later\nsecond\nfirst\npushed\ninit");
  });

  it("leaves renamed, deleted, binary and mode-changed files staged as they were", async () => {
    commit("more", { z: ["z1", "z2", "z3", "z4", "z5", "z6"], w: ["w"], bin: ["b"] });
    read(["rm", "-q", "w"]);
    read(["mv", "z", "z-renamed"]);
    fs.writeFileSync(path.join(repo, "bin"), Buffer.from([0, 1, 2, 0]));
    read(["add", "bin"]);
    stageFixes();
    read(["update-index", "--chmod=+x", "y"]);
    const staged = read(["write-tree"]);
    await absorb();
    expect(subjects()).toBe("fixup! second\nfixup! first\nmore\nsecond\nfirst\npushed\ninit");
    expect(read(["diff", "--name-only", "HEAD~2", "HEAD"]).split("\n")).toEqual(["x"]);
    expect(read(["write-tree"])).toBe(staged);
    // `y` keeps its staged fix with its mode change; only the index has the new mode, which the
    // work tree shows as a change only where Git tracks file modes (not on Windows).
    const fileMode = read(["config", "--bool", "core.fileMode"]) === "true";
    expect(read(["status", "--porcelain"]).split("\n")).toEqual([
      "M  bin",
      "D  w",
      fileMode ? "MM y" : "M  y",
      "R  z -> z-renamed"
    ]);
  });

  it("keeps the bytes of files in other encodings and with CRLF line endings", async () => {
    const latin = (text: string) => Buffer.from(text.replaceAll("\n", "\r\n"), "latin1");
    fs.writeFileSync(path.join(repo, "l"), latin("café\nnaïve\nend\n"));
    read(["add", "l"]);
    read(["commit", "-q", "-m", "latin"]);
    fs.writeFileSync(path.join(repo, "l"), latin("café\nnaïve à fixed\nend\n"));
    read(["add", "l"]);
    const staged = read(["write-tree"]);
    await absorb();
    expect(subjects().split("\n")[0]).toBe("fixup! latin");
    expect(read(["rev-parse", "HEAD^{tree}"])).toBe(staged);
  });

  it("autosquashes the fixups into the commits they fix", async () => {
    stageFixes();
    const staged = read(["write-tree"]);
    const plan = await loadAbsorbPlan(git());
    await absorb(plan);
    const data = await repositoryQuery(git(), {
      kind: "rebasePlan",
      base: plan.base!,
      autosquash: true
    });
    if (data.kind !== "rebasePlan") {
      throw new Error("No plan");
    }
    expect(data.plan.entries.map((entry) => [entry.message, entry.action])).toEqual([
      ["first", "pick"],
      ["fixup! first", "fixup"],
      ["second", "pick"],
      ["fixup! second", "fixup"]
    ]);
    await run({ kind: "interactiveRebase", plan: data.plan });
    expect(await loadOperation(git())).toBeNull();
    expect(subjects()).toBe("second\nfirst\npushed\ninit");
    expect(read(["show", "HEAD~1:x"]).split("\n")).toEqual([
      "p1",
      "first-2 fixed",
      "p3",
      "p4",
      "p5",
      "first-6",
      "first-7"
    ]);
    expect(read(["diff", "--name-only", "HEAD~1", "HEAD"]).split("\n")).toEqual(["x", "y"]);
    expect(read(["show", "HEAD:y"])).toBe("y1\ny2 fixed\ny3");
    expect(read(["rev-parse", "HEAD^{tree}"])).toBe(staged);
  });
});
