import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadCommits } from "@/backend/queries/loadCommits";
import type { GitCommitNode } from "@/backend/types";

import {
  commit,
  defaults,
  git,
  repoA,
  repoC,
  repoI,
  useTempDirs
} from "@tests/backend/queries/loadCommits/fixtures";

const tempDir = useTempDirs();

/** Labels as `type:name`, in the order the commit carries them. */
const labels = (entry: GitCommitNode | undefined) =>
  entry?.refs.map((ref) => `${ref.type}:${ref.name}`);

describe("graph labels", () => {
  it("puts lightweight and annotated tags on their commits, never on the tag object", async () => {
    const { repo, I, S } = repoA(tempDir());
    const result = await loadCommits(createGit(repo, "git"), defaults);
    expect(result).toEqual({
      commits: [
        {
          hash: S,
          parentHashes: [I],
          author: "T",
          email: "t@t.com",
          date: 1_700_000_100,
          message: "second",
          refs: [
            { hash: S, name: "main", type: "head" },
            { hash: S, name: "v1", type: "tag" }
          ]
        },
        {
          hash: I,
          parentHashes: [],
          author: "T",
          email: "t@t.com",
          date: 1_700_000_000,
          message: "init",
          refs: [{ hash: I, name: "v0", type: "tag" }]
        }
      ],
      head: S,
      moreCommitsAvailable: false,
      hard: false,
      uncommittedChanges: 0
    });
    const tagObject = git(repo, ["rev-parse", "refs/tags/v0"]);
    expect(tagObject).not.toBe(I);
    expect(result.commits.flatMap((entry) => entry.refs).map((ref) => ref.hash)).not.toContain(
      tagObject
    );
  });

  it("follows chains of annotated tags and skips tags on trees and blobs", async () => {
    const { repo, S } = repoA(tempDir());
    git(repo, ["tag", "-a", "inner", "-m", "i", "HEAD"]);
    git(repo, ["tag", "-a", "outer", "-m", "o", "inner"]);
    git(repo, ["tag", "treetag", "HEAD^{tree}"]);
    git(repo, ["tag", "blobtag", "HEAD:f"]);
    git(repo, ["tag", "-a", "anntree", "-m", "t", "HEAD^{tree}"]);
    const result = await loadCommits(createGit(repo, "git"), defaults);
    const tip = result.commits.find((entry) => entry.hash === S);
    expect(tip?.refs.filter((ref) => ref.type === "tag")).toEqual([
      { hash: S, name: "inner", type: "tag" },
      { hash: S, name: "outer", type: "tag" },
      { hash: S, name: "v1", type: "tag" }
    ]);
    const names = result.commits.flatMap((entry) => entry.refs).map((ref) => ref.name);
    for (const name of ["treetag", "blobtag", "anntree", "outer^{}", "inner^{}"]) {
      expect(names).not.toContain(name);
    }
  });

  it("orders labels by full ref name in byte order, packed or loose", async () => {
    const { repo, S } = repoA(tempDir());
    for (const branch of ["b-loose", "Zeta", "alpha"]) {
      git(repo, ["branch", branch]);
    }
    git(repo, ["pack-refs", "--all"]);
    git(repo, ["branch", "a-loose"]);
    git(repo, ["tag", "T1"]);
    git(repo, ["tag", "t0"]);
    const result = await loadCommits(createGit(repo, "git"), defaults);
    expect(labels(result.commits.find((entry) => entry.hash === S))).toEqual([
      "head:Zeta",
      "head:a-loose",
      "head:alpha",
      "head:b-loose",
      "head:main",
      "tag:T1",
      "tag:t0",
      "tag:v1"
    ]);
  });

  it("labels remote-tracking branches, including origin/HEAD, unless their remote is hidden", async () => {
    const { repo: source, I, S } = repoA(tempDir());
    const { repo, L } = repoC(source, tempDir());
    const input = { ...defaults, showUncommittedChanges: false };
    const shown = await loadCommits(createGit(repo, "git"), input);
    expect(shown.commits.map((entry) => [entry.hash, labels(entry)])).toEqual([
      [L, ["head:main"]],
      [S, ["remote:origin/HEAD", "remote:origin/main", "tag:v1"]],
      [I, ["tag:v0"]]
    ]);
    expect(shown.head).toBe(L);

    const hidings = [
      { hiddenRemotes: ["origin"] },
      { showRemoteBranches: false },
      { showRemoteBranches: false, hiddenRemotes: ["origin"] }
    ];
    const hidden = await Promise.all(
      hidings.map((hiding) => loadCommits(createGit(repo, "git"), { ...input, ...hiding }))
    );
    for (const [index, result] of hidden.entries()) {
      expect(
        result.commits.map((entry) => [entry.hash, labels(entry)]),
        JSON.stringify(hidings[index])
      ).toEqual([
        [L, ["head:main"]],
        [S, ["tag:v1"]],
        [I, ["tag:v0"]]
      ]);
    }
  });

  it("filters to a remote-tracking branch, whose labels still follow the visibility settings", async () => {
    const { repo: source, I, S } = repoA(tempDir());
    const { repo, L } = repoC(source, tempDir());
    const client = createGit(repo, "git");
    const raw = vi.spyOn(client, "raw");
    const input = { ...defaults, branchName: "remotes/origin/main", showUncommittedChanges: false };
    const result = await loadCommits(client, input);
    expect(result.commits.map((entry) => [entry.hash, labels(entry)])).toEqual([
      [S, ["remote:origin/HEAD", "remote:origin/main", "tag:v1"]],
      [I, ["tag:v0"]]
    ]);
    expect(result.head).toBe(L);
    const log = raw.mock.calls
      .map(([args]) => args as unknown as string[])
      .find((args) => args[0] === "log");
    expect(log?.slice(-2)).toEqual(["refs/remotes/origin/main", "--"]);
    expect(log).not.toContain("--branches");

    const hidden = await loadCommits(createGit(repo, "git"), {
      ...input,
      hiddenRemotes: ["origin"]
    });
    expect(hidden.commits.map((entry) => entry.hash)).toEqual([S, I]);
    expect(hidden.commits.flatMap((entry) => entry.refs).map((ref) => ref.type)).not.toContain(
      "remote"
    );
  });

  it("rejects a remote-tracking branch filter that does not exist", async () => {
    const { repo: source } = repoA(tempDir());
    const { repo } = repoC(source, tempDir());
    await expect(
      loadCommits(createGit(repo, "git"), { ...defaults, branchName: "remotes/origin/nope" })
    ).rejects.toThrow("refs/remotes/origin/nope");
  });

  it("labels a symbolic branch with the commit of its target", async () => {
    const { repo, I } = repoI(tempDir());
    git(repo, ["symbolic-ref", "refs/heads/alias", "refs/heads/main"]);
    const result = await loadCommits(createGit(repo, "git"), defaults);
    expect(result.commits).toHaveLength(1);
    expect(result.commits[0]?.refs).toEqual([
      { hash: I, name: "alias", type: "head" },
      { hash: I, name: "main", type: "head" }
    ]);
  });

  it("shows no stashes, notes or other namespaces, as commits or labels", async () => {
    const { repo, I } = repoI(tempDir());
    fs.writeFileSync(path.join(repo, "f"), "changed");
    git(repo, ["stash"]);
    const tree = git(repo, ["rev-parse", "HEAD^{tree}"]);
    const pull = git(repo, ["commit-tree", tree, "-p", I, "-m", "pull request"]);
    git(repo, ["update-ref", "refs/pull/1/head", pull]);
    git(repo, ["notes", "add", "-m", "a note", I]);
    const client = createGit(repo, "git");
    const status = vi.spyOn(client, "status");
    const result = await loadCommits(client, defaults);
    expect(result.commits.map((entry) => entry.hash)).toEqual([I]);
    expect(result.commits[0]?.refs).toEqual([{ hash: I, name: "main", type: "head" }]);
    // The stash left the working tree clean.
    expect(status).toHaveBeenCalledTimes(1);
    expect(result.uncommittedChanges).toBe(0);
  });

  it("labels and filters branches named with Unicode", async () => {
    const { repo, I } = repoI(tempDir());
    git(repo, ["checkout", "-q", "-b", "feat/ünï-cøde"]);
    const tip = commit(repo, "unicode branch", 1_700_000_100);
    git(repo, ["tag", "v1.0-ß"]);
    git(repo, ["checkout", "-q", "main"]);
    const all = await loadCommits(createGit(repo, "git"), defaults);
    expect(all.commits.map((entry) => [entry.hash, labels(entry)])).toEqual([
      [tip, ["head:feat/ünï-cøde", "tag:v1.0-ß"]],
      [I, ["head:main"]]
    ]);
    const filtered = await loadCommits(createGit(repo, "git"), {
      ...defaults,
      branchName: "feat/ünï-cøde"
    });
    expect(filtered.commits.map((entry) => entry.hash)).toEqual([tip, I]);
  });
});
