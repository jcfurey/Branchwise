import { describe, expect, it } from "vitest";

import {
  checkoutCommit,
  cherrypickCommit,
  resetToCommit,
  revertCommit
} from "@/backend/actions/commit";
import { createGit } from "@/backend/gitClient";
import type { GitResetMode } from "@/backend/types";

import { recordingGit } from "@tests/backend/queries/loadCommits/fixtures";
import {
  allRefs,
  commitFile,
  onWindows,
  readFile,
  run,
  sandbox,
  writeFile
} from "@tests/backend/sandbox";

const box = sandbox();

/** `main` with two commits, the second changing `f` from "x" to "y", and `f` edited since. */
function editedRepo() {
  const repo = box.repo();
  const second = commitFile(repo, "f", "y", "second");
  writeFile(repo, "f", "unsaved");
  return { repo, first: run(repo, "rev-parse", "HEAD^"), second };
}

/** HEAD, the index and the work tree, to show that nothing moved. */
function snapshot(repo: string) {
  return {
    head: run(repo, "symbolic-ref", "--quiet", "HEAD"),
    refs: allRefs(repo),
    index: run(repo, "ls-files", "--stage"),
    f: readFile(repo, "f")
  };
}

const NOT_A_COMMIT = ["main", "f", "HEAD", "--orphan=x", "abc", "a".repeat(65), "", "12345g"];

describe("checking out a commit", () => {
  it.each(NOT_A_COMMIT)("refuses %j, which is not a commit ID", async (commitHash) => {
    const { repo } = editedRepo();
    const before = snapshot(repo);
    await expect(checkoutCommit(createGit(repo, "git"), { commitHash })).rejects.toThrow(
      /Choose a valid commit/
    );
    expect(snapshot(repo)).toEqual(before);
  });

  it.skipIf(onWindows)("refuses without starting Git", async () => {
    const { repo } = editedRepo();
    const recorder = recordingGit(box.folder("bin"));
    await expect(
      checkoutCommit(createGit(repo, recorder.gitPath), { commitHash: "main" })
    ).rejects.toThrow();
    expect(recorder.runs()).toEqual([]);
  });

  it.each([
    ["an abbreviated", (hash: string) => hash.slice(0, 7)],
    ["an upper-case", (hash: string) => hash.toUpperCase()]
  ])("detaches HEAD at %s commit ID", async (_, spell) => {
    const repo = box.repo();
    const second = commitFile(repo, "g", "new", "second");
    const first = run(repo, "rev-parse", "HEAD^");
    await expect(
      checkoutCommit(createGit(repo, "git"), { commitHash: spell(first) })
    ).resolves.toBeUndefined();
    expect(run(repo, "rev-parse", "HEAD")).toBe(first);
    expect(run(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
    expect(run(repo, "rev-parse", "refs/heads/main")).toBe(second);
  });

  it("detaches even when the commit is a branch's tip", async () => {
    const repo = box.repo();
    const tip = run(repo, "rev-parse", "HEAD");
    run(repo, "checkout", "-q", "-b", "elsewhere");
    await checkoutCommit(createGit(repo, "git"), { commitHash: tip });
    expect(run(repo, "rev-parse", "--abbrev-ref", "HEAD")).toBe("HEAD");
    expect(run(repo, "rev-parse", "HEAD")).toBe(tip);
  });
});

describe("resetting to a commit", () => {
  it.each(NOT_A_COMMIT)("refuses %j, which is not a commit ID", async (commitHash) => {
    const { repo } = editedRepo();
    const before = snapshot(repo);
    await expect(
      resetToCommit(createGit(repo, "git"), { commitHash, resetMode: "soft" })
    ).rejects.toThrow(/Choose a valid commit/);
    expect(snapshot(repo)).toEqual(before);
  });

  it.each(["keep", "merge", "bogus", "Hard", ""])("refuses the reset mode %j", async (mode) => {
    const { repo, first } = editedRepo();
    const before = snapshot(repo);
    await expect(
      resetToCommit(createGit(repo, "git"), {
        commitHash: first,
        resetMode: mode as GitResetMode
      })
    ).rejects.toThrow(/Choose a soft, mixed or hard reset/);
    expect(snapshot(repo)).toEqual(before);
  });

  it.skipIf(onWindows)("refuses without starting Git", async () => {
    const { repo, first } = editedRepo();
    const recorder = recordingGit(box.folder("bin"));
    const client = createGit(repo, recorder.gitPath);
    await expect(
      resetToCommit(client, { commitHash: "--hard", resetMode: "soft" })
    ).rejects.toThrow();
    await expect(
      resetToCommit(client, { commitHash: first, resetMode: "keep" as GitResetMode })
    ).rejects.toThrow();
    expect(recorder.runs()).toEqual([]);
  });

  it("reads a hexadecimal file name as a commit, not as a path to unstage", async () => {
    const repo = box.repo();
    commitFile(repo, "beef", "old", "add beef");
    writeFile(repo, "beef", "staged");
    run(repo, "add", "beef");
    await expect(
      resetToCommit(createGit(repo, "git"), { commitHash: "beef", resetMode: "mixed" })
    ).rejects.toThrow();
    expect(run(repo, "diff", "--cached", "--name-only")).toBe("beef");
  });
});

describe("choosing a merge parent", () => {
  const actions = [
    ["cherry-pick", cherrypickCommit],
    ["revert", revertCommit]
  ] as const;

  it.each(
    actions.flatMap(([name, action]) =>
      [1.5, -1, Number.NaN, Number.POSITIVE_INFINITY].map(
        (parentIndex) => [name, parentIndex, action] as const
      )
    )
  )("%s refuses the parent number %s", async (_, parentIndex, action) => {
    const repo = box.repo();
    const picked = commitFile(repo, "g", "new", "second");
    run(repo, "reset", "-q", "--hard", "HEAD^");
    const before = allRefs(repo);
    await expect(
      action(createGit(repo, "git"), { commitHash: picked, parentIndex })
    ).rejects.toThrow(/Choose a valid mainline parent/);
    expect(allRefs(repo)).toBe(before);
  });
});

describe("picking and reverting by commit ID only", () => {
  const actions = [
    ["cherry-pick", cherrypickCommit],
    ["revert", revertCommit]
  ] as const;

  /** `side` has a commit that `main` lacks, so its name alone would be enough for Git. */
  function withSide() {
    const repo = box.repo();
    run(repo, "checkout", "-q", "-b", "side");
    commitFile(repo, "g", "from side", "side work");
    run(repo, "checkout", "-q", "main");
    return repo;
  }

  it.each(
    actions.flatMap(([name, action]) =>
      ["--strategy=ours", "-n", "side", "refs/heads/side", "HEAD"].map(
        (commitHash) => [name, commitHash, action] as const
      )
    )
  )("%s refuses %j, which is not a commit ID", async (_, commitHash, action) => {
    const repo = withSide();
    const before = snapshot(repo);
    await expect(action(createGit(repo, "git"), { commitHash, parentIndex: 0 })).rejects.toThrow(
      /Choose a valid commit/
    );
    expect(snapshot(repo)).toEqual(before);
  });

  it.skipIf(onWindows).each(actions)("%s refuses without starting Git", async (_, action) => {
    const repo = withSide();
    const recorder = recordingGit(box.folder("bin"));
    const client = createGit(repo, recorder.gitPath);
    await expect(action(client, { commitHash: "--strategy=ours", parentIndex: 0 })).rejects.toThrow(
      /Choose a valid commit/
    );
    await expect(action(client, { commitHash: "side", parentIndex: 1 })).rejects.toThrow(
      /Choose a valid commit/
    );
    expect(recorder.runs()).toEqual([]);
  });
});
