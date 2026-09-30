import * as fs from "node:fs";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createBranch, renameBranch } from "@/backend/actions/branch";
import { manageRemote } from "@/backend/actions/remotes";
import { addTag, pushTag } from "@/backend/actions/tag";
import { createGit } from "@/backend/gitClient";
import { repositoryQuery } from "@/backend/queries/repository";
import { requireBranchName, requireTagName } from "@/backend/utils/validation";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

// Names Git refuses. `check-ref-format` reports each only through its exit status.
const INVALID = ["a..b", "*", "x@{1}", "has space", "a:b", ".hidden", "a//b", "end/", "x.lock"];

let repo: string;
let remote: string;
let refs: string;
let remoteRefs: string;

beforeAll(() => {
  repo = makeRepo();
  remote = fs.mkdtempSync(repo + "-remote-");
  git(["init", "--bare"], remote);
  git(["remote", "add", "origin", remote], repo);
  git(["push", "origin", "main"], repo);
  refs = gitOutput(["for-each-ref"], repo);
  remoteRefs = gitOutput(["for-each-ref"], remote);
});

afterAll(() => {
  for (const dir of [repo, remote]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("ref-name validation", () => {
  it("accepts ordinary branch and tag names", async () => {
    const client = createGit(repo, "git");
    await requireBranchName(client, "feature/one-2");
    await requireTagName(client, "v1.0.0");
  });

  it.each(INVALID)("rejects %s before any Git write", async (name) => {
    const client = createGit(repo, "git");
    const branch = /Enter a valid branch name/;
    const tag = /Enter a valid tag name/;
    const head = gitOutput(["rev-parse", "HEAD"], repo);

    await expect(requireBranchName(client, name)).rejects.toThrow(branch);
    await expect(requireTagName(client, name)).rejects.toThrow(tag);
    await expect(createBranch(client, { branchName: name, commitHash: head })).rejects.toThrow(
      branch
    );
    await expect(renameBranch(client, { oldName: "main", newName: name })).rejects.toThrow(branch);
    await expect(
      addTag(client, {
        tagName: name,
        commitHash: head,
        lightweight: true,
        message: ""
      })
    ).rejects.toThrow(tag);
    await expect(pushTag(client, { remote: "origin", tagName: name })).rejects.toThrow(tag);
    await expect(
      manageRemote(client, { kind: "deleteRemoteRef", remote: "origin", name, refType: "branch" })
    ).rejects.toThrow(branch);
    await expect(
      manageRemote(client, { kind: "deleteRemoteRef", remote: "origin", name, refType: "tag" })
    ).rejects.toThrow(tag);
    await expect(
      repositoryQuery(client, { kind: "lease", remote: "origin", branch: name })
    ).rejects.toThrow(branch);

    expect(gitOutput(["for-each-ref"], repo)).toBe(refs);
    expect(gitOutput(["for-each-ref"], remote)).toBe(remoteRefs);
  });

  it.each(["", "HEAD", "-f", "--force"])("rejects the branch name '%s'", async (name) => {
    await expect(requireBranchName(createGit(repo, "git"), name)).rejects.toThrow(
      /valid branch name/
    );
  });

  it.each(["", ".", "-x", "a..b", "has space", "a:b"])(
    "rejects the remote name '%s' before adding it",
    async (name) => {
      await expect(
        manageRemote(createGit(repo, "git"), { kind: "addRemote", name, url: remote, fetch: false })
      ).rejects.toThrow(/valid remote name/);
      expect(gitOutput(["remote"], repo)).toBe("origin");
    }
  );

  it("returns the lease for a valid remote branch", async () => {
    expect(
      await repositoryQuery(createGit(repo, "git"), {
        kind: "lease",
        remote: "origin",
        branch: "main"
      })
    ).toEqual({ kind: "lease", hash: gitOutput(["rev-parse", "main"], repo) });
  });
});
