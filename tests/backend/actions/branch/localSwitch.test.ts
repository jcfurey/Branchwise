import { describe, expect, it } from "vitest";

import { checkoutBranch, createBranch, deleteBranch, renameBranch } from "@/backend/actions/branch";
import { createGit } from "@/backend/gitClient";

import { recordingGit } from "@tests/backend/queries/loadCommits/fixtures";
import {
  allRefs,
  commitFile,
  onWindows,
  readFile,
  run,
  sandbox,
  succeeds,
  writeFile
} from "@tests/backend/sandbox";

const box = sandbox();

/** A repository with `main` two commits long; `f` holds "x" and then "y". */
function twoCommits() {
  const repo = box.repo();
  const second = commitFile(repo, "f", "y", "second");
  return { repo, first: run(repo, "rev-parse", "HEAD^"), second };
}

const headRef = (repo: string) => run(repo, "symbolic-ref", "--quiet", "HEAD");
const STALE_BRANCH = /The branch changed/;

describe("local checkout switches branches and does nothing else", () => {
  it("switches to an existing branch", async () => {
    const { repo, first } = twoCommits();
    run(repo, "branch", "older", first);
    await expect(
      checkoutBranch(createGit(repo, "git"), { branchName: "older", remoteBranch: null })
    ).resolves.toBeUndefined();
    expect(headRef(repo)).toBe("refs/heads/older");
    expect(readFile(repo, "f")).toBe("x");
  });

  it("refuses a file name and keeps the file's uncommitted text", async () => {
    const { repo } = twoCommits();
    writeFile(repo, "f", "work in progress");
    await expect(
      checkoutBranch(createGit(repo, "git"), { branchName: "f", remoteBranch: null })
    ).rejects.toThrow(STALE_BRANCH);
    expect(readFile(repo, "f")).toBe("work in progress");
    expect(headRef(repo)).toBe("refs/heads/main");
  });

  it("refuses a tag name instead of detaching HEAD", async () => {
    const { repo, first } = twoCommits();
    run(repo, "tag", "v0", first);
    await expect(
      checkoutBranch(createGit(repo, "git"), { branchName: "v0", remoteBranch: null })
    ).rejects.toThrow(STALE_BRANCH);
    expect(headRef(repo)).toBe("refs/heads/main");
  });

  it("refuses a name that only a remote has instead of creating a tracking branch", async () => {
    const { repo, first } = twoCommits();
    // A configured remote with a fetched branch is all that Git's guess needs.
    run(repo, "remote", "add", "origin", box.folder("unused-remote"));
    run(repo, "update-ref", "refs/remotes/origin/feature", first);
    const before = allRefs(repo);
    await expect(
      checkoutBranch(createGit(repo, "git"), { branchName: "feature", remoteBranch: null })
    ).rejects.toThrow(STALE_BRANCH);
    expect(allRefs(repo)).toBe(before);
    expect(headRef(repo)).toBe("refs/heads/main");
  });

  it("refuses option-like names as invalid", async () => {
    const { repo } = twoCommits();
    const before = allRefs(repo);
    for (const branchName of ["--orphan=x", "-f"]) {
      // eslint-disable-next-line no-await-in-loop
      await expect(
        checkoutBranch(createGit(repo, "git"), { branchName, remoteBranch: null })
      ).rejects.toThrow(/Enter a valid branch name/);
    }
    expect(allRefs(repo)).toBe(before);
    expect(headRef(repo)).toBe("refs/heads/main");
  });

  it.skipIf(onWindows)("only reads the repository before refusing a missing branch", async () => {
    const { repo } = twoCommits();
    const recorder = recordingGit(box.folder("bin"));
    await expect(
      checkoutBranch(createGit(repo, recorder.gitPath), { branchName: "f", remoteBranch: null })
    ).rejects.toThrow(STALE_BRANCH);
    expect(recorder.runs()).toEqual([
      "check-ref-format --normalize refs/heads/f",
      "for-each-ref --format=%(if)%(symref)%(then)%(else)%(refname)%(end) refs/heads/"
    ]);
  });

  it("switches to the branch, not a same-named file, keeping the file's changes", async () => {
    const { repo } = twoCommits();
    run(repo, "branch", "f");
    writeFile(repo, "f", "work in progress");
    await checkoutBranch(createGit(repo, "git"), { branchName: "f", remoteBranch: null });
    expect(headRef(repo)).toBe("refs/heads/f");
    expect(readFile(repo, "f")).toBe("work in progress");
  });

  it("switches to the branch when a tag has the same name", async () => {
    const { repo, first, second } = twoCommits();
    run(repo, "branch", "same", first);
    run(repo, "tag", "same", second);
    await checkoutBranch(createGit(repo, "git"), { branchName: "same", remoteBranch: null });
    expect(headRef(repo)).toBe("refs/heads/same");
    expect(run(repo, "rev-parse", "HEAD")).toBe(first);
  });
});

describe("branch names Git would misread", () => {
  it.each(["HEAD", "-x"])("refuses to create a branch named %s", async (branchName) => {
    const { repo, first } = twoCommits();
    const before = allRefs(repo);
    await expect(
      createBranch(createGit(repo, "git"), { branchName, commitHash: first })
    ).rejects.toThrow(/Enter a valid branch name/);
    expect(allRefs(repo)).toBe(before);
  });

  it.skipIf(onWindows)("refuses HEAD and -x without starting Git", async () => {
    const { repo, first } = twoCommits();
    const recorder = recordingGit(box.folder("bin"));
    const client = createGit(repo, recorder.gitPath);
    await expect(createBranch(client, { branchName: "HEAD", commitHash: first })).rejects.toThrow();
    await expect(createBranch(client, { branchName: "-x", commitHash: first })).rejects.toThrow();
    expect(recorder.runs()).toEqual([]);
  });

  it("reads an option-like start point as a revision", async () => {
    const { repo } = twoCommits();
    const before = allRefs(repo);
    await expect(
      createBranch(createGit(repo, "git"), { branchName: "e3", commitHash: "--force" })
    ).rejects.toThrow();
    expect(allRefs(repo)).toBe(before);
  });
});

describe("the checked-out branch", () => {
  it("moves HEAD along when renamed", async () => {
    const { repo } = twoCommits();
    await expect(
      renameBranch(createGit(repo, "git"), { oldName: "main", newName: "trunk" })
    ).resolves.toBeUndefined();
    expect(headRef(repo)).toBe("refs/heads/trunk");
    expect(succeeds(repo, "rev-parse", "--verify", "--quiet", "refs/heads/main")).toBe(false);
  });

  it("cannot be deleted, even with force", async () => {
    const { repo, second } = twoCommits();
    await expect(
      deleteBranch(createGit(repo, "git"), { branchName: "main", forceDelete: true })
    ).rejects.toThrow();
    expect(run(repo, "rev-parse", "refs/heads/main")).toBe(second);
  });
});
