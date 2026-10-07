import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { APPLIED_COMMITS_LIMIT } from "@/backend/queries/appliedCommits";
import { repositoryQuery } from "@/backend/queries/repository";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

const repo = freshRepo();

const head = (revision = "HEAD") => gitOutput(["rev-parse", revision], repo());

/** Write `files` and commit them as `message`; the new commit's ID. */
function commitFiles(message: string, files: Record<string, string>) {
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(path.join(repo(), name), content);
  }
  git(["add", "-A"], repo());
  git(["commit", "-q", "-m", message], repo());
  return head();
}

/** Cherry-pick `hash` onto the checked-out branch; the copy's ID. */
function pick(hash: string) {
  git(["cherry-pick", hash], repo());
  return head();
}

const applied = async (branch: string) => {
  const result = await repositoryQuery(createGit(repo(), "git"), {
    kind: "appliedCommits",
    branch
  });
  return result.kind === "appliedCommits" ? result : null;
};

const equivalent = async (hash: string) => {
  const result = await repositoryQuery(createGit(repo(), "git"), {
    kind: "equivalentCommit",
    hash
  });
  return result.kind === "equivalentCommit" ? result : null;
};

/** The work tree and index as Git reports them, every ref, and the index file's own bytes. */
const snapshot = () => [
  gitOutput(["status", "--porcelain", "--untracked-files=all"], repo()),
  gitOutput(["for-each-ref", "--format=%(refname) %(objectname)"], repo()),
  gitOutput(["rev-parse", "HEAD"], repo()),
  createHash("sha256")
    .update(readFileSync(path.join(repo(), ".git", "index")))
    .digest("hex")
];

/**
 * `topic` with a commit that main then picks as it is, one that main picks and changes, and one
 * main never sees. Main also gains a commit of its own. A staged change and an untracked file are
 * left for the queries to leave alone.
 */
function pickedTopic() {
  git(["checkout", "-q", "-b", "topic"], repo());
  const same = commitFiles("same change", { a: "a\n" });
  const changed = commitFiles("changed later", { b: "b\n" });
  const unpicked = commitFiles("never picked", { c: "c\n" });
  git(["checkout", "-q", "main"], repo());
  commitFiles("main's own", { m: "m\n" });
  const copy = pick(same);
  git(["cherry-pick", "--no-commit", changed], repo());
  writeFileSync(path.join(repo(), "b"), "b, but different\n");
  git(["add", "b"], repo());
  git(["commit", "-q", "-m", "changed later"], repo());
  const altered = head();
  writeFileSync(path.join(repo(), "f"), "staged\n");
  git(["add", "f"], repo());
  writeFileSync(path.join(repo(), "untracked"), "left alone\n");
  return { same, changed, unpicked, copy, altered };
}

describe("applied commits", () => {
  it("marks a commit main picked as it was, with main's copy, and not one main changed", async () => {
    const { same, copy } = pickedTopic();
    const before = snapshot();

    expect(await applied("topic")).toEqual({
      kind: "appliedCommits",
      head: head(),
      tip: head("topic"),
      skipped: false,
      applied: [{ hash: same, equivalent: { hash: copy, subject: "same change" } }]
    });
    // Nothing on disk or among the refs changed.
    expect(snapshot()).toEqual(before);
  });

  it("finds them on a remote-tracking branch too, and nothing on the checked-out branch itself", async () => {
    const { same, copy } = pickedTopic();
    git(["update-ref", "refs/remotes/origin/topic", "topic"], repo());
    expect((await applied("remotes/origin/topic"))?.applied).toEqual([
      { hash: same, equivalent: { hash: copy, subject: "same change" } }
    ]);
    expect((await applied("main"))?.applied).toEqual([]);
  });

  it("marks the commits of a rebased branch whose originals are partly in main", async () => {
    git(["checkout", "-q", "-b", "topic"], repo());
    commitFiles("first", { a: "a\n" });
    commitFiles("second", { b: "b\n" });
    commitFiles("third", { c: "c\n" });
    const [first, second] = [head("topic~2"), head("topic~1")];
    // Main takes the first two commits as they were, then moves on.
    git(["checkout", "-q", "main"], repo());
    git(["merge", "-q", "--ff-only", "topic~1"], repo());
    commitFiles("main's own", { m: "m\n" });
    // Meanwhile the whole branch was rebased onto a release line, which copies every commit.
    git(["checkout", "-q", "-b", "release", "HEAD~3"], repo());
    commitFiles("release fix", { r: "r\n" });
    git(["rebase", "-q", "--onto", "release", "release~1", "topic"], repo());
    git(["checkout", "-q", "main"], repo());
    const before = snapshot();

    const result = await applied("topic");
    expect(result?.applied).toEqual([
      { hash: head("topic~1"), equivalent: { hash: second, subject: "second" } },
      { hash: head("topic~2"), equivalent: { hash: first, subject: "first" } }
    ]);
    expect(snapshot()).toEqual(before);
  });

  it("leaves merges out, even one whose change main has", async () => {
    git(["checkout", "-q", "-b", "side"], repo());
    const sideCommit = commitFiles("side work", { s: "s\n" });
    git(["checkout", "-q", "-b", "topic", "main"], repo());
    commitFiles("topic work", { t: "t\n" });
    git(["merge", "-q", "--no-ff", "-m", "merge side", "side"], repo());
    const merge = head();
    git(["checkout", "-q", "main"], repo());
    commitFiles("main's own", { m: "m\n" });
    // The merge adds `s` just as this commit does, but only the side commit counts.
    const copy = pick(sideCommit);

    const result = await applied("topic");
    expect(result?.applied).toEqual([
      { hash: sideCommit, equivalent: { hash: copy, subject: "side work" } }
    ]);
    expect(result?.applied.map((commit) => commit.hash)).not.toContain(merge);
  });

  it("answers nothing without a commit on HEAD, and refuses a revision that is not a branch", async () => {
    pickedTopic();
    await expect(applied("topic~1")).rejects.toThrow();
    git(["checkout", "-q", "--orphan", "empty"], repo());
    expect(await applied("topic")).toMatchObject({ head: "", skipped: false, applied: [] });
  });

  it("is not thrown by settings that change Git's output", async () => {
    const { same, copy } = pickedTopic();
    const settings: Array<[string, string]> = [
      ["diff.noprefix", "true"],
      ["diff.mnemonicPrefix", "true"],
      ["diff.algorithm", "histogram"],
      ["diff.renames", "copies"],
      ["diff.context", "10"],
      ["diff.interHunkContext", "20"],
      // Any diff through this program would fail.
      ["diff.external", "no-such-diff-program"],
      ["color.ui", "always"],
      ["color.diff", "always"],
      ["log.showSignature", "true"],
      ["log.abbrevCommit", "true"],
      ["log.decorate", "full"],
      ["format.pretty", "oneline"],
      ["core.quotePath", "true"]
    ];
    for (const [key, value] of settings) {
      git(["config", key, value], repo());
    }
    expect((await applied("topic"))?.applied).toEqual([
      { hash: same, equivalent: { hash: copy, subject: "same change" } }
    ]);
    expect(await equivalent(same)).toMatchObject({ equivalent: { hash: copy } });
  });
});

describe("the size bound", () => {
  /**
   * `count` commits on `branch` from main, written by `git fast-import` in one go. The first adds
   * `picked` and main later picks it; the others change nothing.
   */
  function longBranch(branch: string, count: number) {
    const lines = [];
    for (let index = 1; index <= count; index++) {
      lines.push(
        `commit refs/heads/${branch}`,
        `committer T <t@t.com> ${1_700_000_000 + index} +0000`,
        `data <<END`,
        `step ${index}`,
        `END`
      );
      if (index === 1) {
        lines.push(`from ${head("main")}`, "M 100644 inline picked", "data <<END", "p", "END");
      }
      lines.push("");
    }
    execFileSync("git", ["fast-import", "--quiet"], {
      cwd: repo(),
      input: lines.join("\n") + "\n",
      stdio: ["pipe", "pipe", "pipe"]
    });
  }

  it(`compares a branch with ${APPLIED_COMMITS_LIMIT} commits HEAD lacks, and skips one with more`, async () => {
    longBranch("at-limit", APPLIED_COMMITS_LIMIT);
    git(["branch", "beyond", "at-limit"], repo());
    git(["checkout", "-q", "beyond"], repo());
    git(["commit", "-q", "--allow-empty", "-m", "one more"], repo());
    git(["checkout", "-q", "main"], repo());
    const picked = gitOutput(["rev-list", "--reverse", "main..at-limit"], repo()).split("\n")[0]!;
    const copy = pick(picked);
    const before = snapshot();

    expect(await applied("at-limit")).toMatchObject({
      skipped: false,
      applied: [{ hash: picked, equivalent: { hash: copy } }]
    });
    expect(await applied("beyond")).toMatchObject({ skipped: true, applied: [] });
    expect(snapshot()).toEqual(before);
  }, 60_000);
});

describe("remembered answers", () => {
  /**
   * The module afresh, with nothing remembered from other tests. `client(trigger)` counts the Git
   * commands run with `trigger` among their arguments, and with `cancel` cancels its own request
   * when it is about to run one.
   */
  const freshModule = async () => {
    vi.resetModules();
    const [{ loadAppliedCommits }, { createGit: freshGit }] = await Promise.all([
      import("@/backend/queries/appliedCommits"),
      import("@/backend/gitClient")
    ]);
    const client = (trigger: string, cancel = false) => {
      const controller = new AbortController();
      const counted = freshGit(repo(), "git", controller.signal);
      const raw = counted.raw.bind(counted);
      const runs = { count: 0 };
      counted.raw = ((args: string[]) => {
        if (args.includes(trigger)) {
          runs.count++;
          if (cancel) {
            controller.abort();
          }
        }
        return raw(args);
      }) as typeof counted.raw;
      return { git: counted, runs };
    };
    return { loadAppliedCommits, client };
  };

  it("compares a pair of tips once, and again once either moves", async () => {
    const { same } = pickedTopic();
    const { loadAppliedCommits, client } = await freshModule();
    const first = client("--cherry-mark");
    expect((await loadAppliedCommits(first.git, "topic")).applied).toHaveLength(1);
    expect((await loadAppliedCommits(first.git, "topic")).applied).toHaveLength(1);
    expect(first.runs.count).toBe(1);

    git(["checkout", "-q", "topic"], repo());
    git(["commit", "-q", "--allow-empty", "-m", "moves the tip"], repo());
    git(["checkout", "-q", "main"], repo());
    const moved = await loadAppliedCommits(first.git, "topic");
    expect(first.runs.count).toBe(2);
    expect(moved.applied.map((commit) => commit.hash)).toEqual([same]);
  });

  it("forgets a comparison cancelled part way", async () => {
    pickedTopic();
    const { loadAppliedCommits, client } = await freshModule();
    await expect(loadAppliedCommits(client("--cherry-mark", true).git, "topic")).rejects.toThrow();
    expect((await loadAppliedCommits(client("--cherry-mark").git, "topic")).applied).toHaveLength(
      1
    );
  });
});

describe("Find Equivalent Commit", () => {
  it("finds main's copy of a picked commit, and nothing for a changed one", async () => {
    const { same, changed, unpicked, copy } = pickedTopic();
    const before = snapshot();

    expect(await equivalent(same)).toEqual({
      kind: "equivalentCommit",
      hash: same,
      onHead: false,
      equivalent: { hash: copy, subject: "same change" },
      truncated: false
    });
    expect(await equivalent(changed)).toMatchObject({ onHead: false, equivalent: null });
    expect(await equivalent(unpicked)).toMatchObject({ onHead: false, equivalent: null });
    expect(snapshot()).toEqual(before);
  });

  it("says when the commit is on the checked-out branch already", async () => {
    const { copy } = pickedTopic();
    expect(await equivalent(copy)).toMatchObject({ onHead: true, equivalent: null });
  });

  it("reads file names literally, not as patterns", async () => {
    git(["checkout", "-q", "-b", "topic"], repo());
    const glob = commitFiles("glob-like name", { "[ab].txt": "x\n" });
    git(["checkout", "-q", "main"], repo());
    // A pattern `[ab].txt` would match these, which must not hide the real copy among them.
    commitFiles("a", { "a.txt": "x\n" });
    const copy = pick(glob);
    commitFiles("b", { "b.txt": "x\n" });

    expect(await equivalent(glob)).toMatchObject({ equivalent: { hash: copy } });
  });

  it("refuses a merge, an abbreviated ID, and a repository without commits on HEAD", async () => {
    git(["checkout", "-q", "-b", "side"], repo());
    commitFiles("side", { s: "s\n" });
    git(["checkout", "-q", "-b", "topic", "main"], repo());
    commitFiles("topic", { t: "t\n" });
    git(["merge", "-q", "--no-ff", "-m", "merge side", "side"], repo());
    const merge = head();
    git(["checkout", "-q", "main"], repo());

    await expect(equivalent(merge)).rejects.toThrow("A merge commit has no single change");
    await expect(equivalent(merge.slice(0, 12))).rejects.toThrow("is not a full commit ID");
    git(["checkout", "-q", "--orphan", "empty"], repo());
    await expect(equivalent(head("side"))).rejects.toThrow("no checked-out commit");
  });
});
