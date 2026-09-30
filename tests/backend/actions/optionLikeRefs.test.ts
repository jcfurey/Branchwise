import * as cp from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { deleteBranch, renameBranch } from "@/backend/actions/branch";
import { mergeBranch } from "@/backend/actions/merge";
import { addTag, deleteTag } from "@/backend/actions/tag";
import { createGit } from "@/backend/gitClient";
import { loadCommits } from "@/backend/queries/loadCommits";

import { git, makeRepo } from "@tests/backend/helpers";

// Clones and fetches can create refs that `git branch` and `git tag` refuse to create.
const OPTION_REFS = ["refs/tags/-d", "refs/heads/--output=x", "refs/heads/-D"];

const repos: string[] = [];

afterEach(() => {
  for (const repo of repos.splice(0)) {
    fs.rmSync(repo, { recursive: true, force: true });
  }
});

/** A repository whose option-like refs each point at their own commit. */
function fixture() {
  const repo = makeRepo();
  repos.push(repo);
  const tips: Record<string, string> = {};
  for (const ref of OPTION_REFS) {
    git(["commit", "--allow-empty", "-m", ref], repo);
    tips[ref] = rev(repo, "HEAD");
    git(["update-ref", ref, "HEAD"], repo);
    git(["reset", "--hard", "HEAD^"], repo);
  }
  return { repo, tips, files: fs.readdirSync(repo).toSorted() };
}

function rev(repo: string, name: string) {
  return cp.execFileSync("git", ["rev-parse", name], { cwd: repo }).toString().trim();
}

function refs(repo: string) {
  return cp
    .execFileSync("git", ["for-each-ref", "--format=%(refname) %(objectname)"], { cwd: repo })
    .toString()
    .trim()
    .split("\n")
    .toSorted();
}

/** The refs before an action, with one ref removed or renamed. */
function refsAfter(before: string[], removed: string, added?: string) {
  const entry = before.find((line) => line.startsWith(removed + " "))!;
  const rest = before.filter((line) => line !== entry);
  return (added ? [...rest, added + entry.slice(removed.length)] : rest).toSorted();
}

describe("refs whose names look like options", () => {
  it("filters the graph to a branch named --output=x without writing a file", async () => {
    const { repo, tips, files } = fixture();
    const result = await loadCommits(createGit(repo, "git"), {
      branchName: "--output=x",
      maxCommits: 10,
      showRemoteBranches: true,
      hard: false,
      dateType: "Author Date",
      showUncommittedChanges: false
    });
    expect(result.commits[0]?.hash).toBe(tips["refs/heads/--output=x"]);
    expect(fs.readdirSync(repo).toSorted()).toEqual(files);
  });

  it("filters the graph to a branch, not a tag with the same name", async () => {
    const { repo } = fixture();
    git(["commit", "--allow-empty", "-m", "tag only"], repo);
    git(["tag", "same"], repo);
    git(["reset", "--hard", "HEAD^"], repo);
    git(["branch", "same"], repo);
    const result = await loadCommits(createGit(repo, "git"), {
      branchName: "same",
      maxCommits: 10,
      showRemoteBranches: true,
      hard: false,
      dateType: "Author Date",
      showUncommittedChanges: false
    });
    expect(result.commits.map((commit) => commit.message)).not.toContain("tag only");
    expect(result.commits[0]?.hash).toBe(rev(repo, "refs/heads/same"));
  });

  it("deletes only the tag named -d", async () => {
    const { repo, files } = fixture();
    const before = refs(repo);
    await deleteTag(createGit(repo, "git"), { tagName: "-d" });
    expect(refs(repo)).toEqual(refsAfter(before, "refs/tags/-d"));
    expect(fs.readdirSync(repo).toSorted()).toEqual(files);
  });

  it.each([false, true])(
    "deletes only the branches named -D and --output=x with force %s",
    async (forceDelete) => {
      const { repo, files } = fixture();
      const before = refs(repo);
      await deleteBranch(createGit(repo, "git"), { branchName: "-D", forceDelete: true });
      await deleteBranch(createGit(repo, "git"), { branchName: "--output=x", forceDelete: true });
      expect(refs(repo)).toEqual(
        refsAfter(refsAfter(before, "refs/heads/-D"), "refs/heads/--output=x")
      );
      expect(fs.readdirSync(repo).toSorted()).toEqual(files);
      // Unmerged option-like branches still need force.
      git(["commit", "--allow-empty", "-m", "unmerged"], repo);
      git(["update-ref", "refs/heads/-D", "HEAD"], repo);
      git(["reset", "--hard", "HEAD^"], repo);
      const deletion = deleteBranch(createGit(repo, "git"), { branchName: "-D", forceDelete });
      if (forceDelete) {
        await deletion;
        expect(refs(repo).some((line) => line.startsWith("refs/heads/-D "))).toBe(false);
      } else {
        await expect(deletion).rejects.toThrow();
        expect(refs(repo).some((line) => line.startsWith("refs/heads/-D "))).toBe(true);
      }
    }
  );

  it("renames only the branch named -D", async () => {
    const { repo, files } = fixture();
    const before = refs(repo);
    await renameBranch(createGit(repo, "git"), { oldName: "-D", newName: "renamed" });
    expect(refs(repo)).toEqual(refsAfter(before, "refs/heads/-D", "refs/heads/renamed"));
    expect(fs.readdirSync(repo).toSorted()).toEqual(files);
  });

  it("does not read a new name as an option", async () => {
    const { repo } = fixture();
    const before = refs(repo);
    await expect(
      renameBranch(createGit(repo, "git"), { oldName: "main", newName: "-D" })
    ).rejects.toThrow();
    await expect(
      addTag(createGit(repo, "git"), {
        tagName: "-d",
        commitHash: rev(repo, "HEAD"),
        lightweight: true,
        message: ""
      })
    ).rejects.toThrow();
    expect(refs(repo)).toEqual(before);
  });

  it("merges the branch named -D and names the merge after it", async () => {
    const { repo, tips } = fixture();
    // A case-insensitive filesystem resolves the short name -D to the loose tag -d first.
    const shadowed = fs.existsSync(path.join(repo, ".git", "refs", "tags", "-D"));
    await mergeBranch(createGit(repo, "git"), { branchName: "-D", createNewCommit: true }, "git");
    expect(rev(repo, "HEAD^2")).toBe(tips["refs/heads/-D"]);
    expect(
      cp.execFileSync("git", ["log", "-1", "--format=%s"], { cwd: repo }).toString().trim()
    ).toBe(shadowed ? "Merge branch 'refs/heads/-D'" : "Merge branch '-D'");
  });

  it("merges a branch, not a tag with the same name", async () => {
    const { repo, tips } = fixture();
    git(["tag", "same", tips["refs/tags/-d"]!], repo);
    git(["branch", "same", tips["refs/heads/--output=x"]!], repo);
    await mergeBranch(createGit(repo, "git"), { branchName: "same", createNewCommit: true }, "git");
    expect(rev(repo, "HEAD^2")).toBe(tips["refs/heads/--output=x"]);
  });
});
