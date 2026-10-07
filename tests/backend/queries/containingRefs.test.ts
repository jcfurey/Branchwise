import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";

import { expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadContainingRefs } from "@/backend/queries/containingRefs";
import { repositoryQuery } from "@/backend/queries/repository";
import type { ContainingRefsScope } from "@/backend/types";

import { freshRepo, git, gitOutput } from "@tests/backend/helpers";

const repo = freshRepo();

const ALL: ContainingRefsScope = { showRemoteBranches: true, hiddenRemotes: [] };

const containing = (hash: string, scope: Partial<ContainingRefsScope> = {}) =>
  loadContainingRefs(createGit(repo(), "git"), hash, { ...ALL, ...scope });

const head = () => gitOutput(["rev-parse", "HEAD"], repo());

/** Commit a change to `f`, dated `date` seconds after 1970 for both author and committer. */
function commitAt(message: string, date: number) {
  writeFileSync(path.join(repo(), "f"), message);
  git(["add", "f"], repo());
  execFileSync("git", ["commit", "-q", "-m", message], {
    cwd: repo(),
    stdio: "pipe",
    env: { ...process.env, GIT_AUTHOR_DATE: `${date} +0000`, GIT_COMMITTER_DATE: `${date} +0000` }
  });
  return head();
}

/** An annotated tag on `target`, with its tagger date at `date`. */
function tagAt(name: string, target: string, date: number) {
  execFileSync("git", ["tag", "-a", "-m", name, name, target], {
    cwd: repo(),
    stdio: "pipe",
    env: { ...process.env, GIT_COMMITTER_DATE: `${date} +0000` }
  });
}

const snapshot = () => [
  gitOutput(["status", "--porcelain"], repo()),
  gitOutput(["for-each-ref", "--format=%(refname) %(objectname)"], repo())
];

it("lists the checked-out branch, then local branches, then remote ones, without symbolic refs", async () => {
  const base = head();
  git(["branch", "zeta"], repo());
  git(["branch", "alpha"], repo());
  git(["checkout", "-q", "-b", "elsewhere"], repo());
  commitAt("elsewhere", 1_700_000_000);
  git(["checkout", "-q", "main"], repo());
  const later = commitAt("later", 1_700_000_100);
  git(["update-ref", "refs/remotes/origin/main", base], repo());
  git(["symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main"], repo());
  const before = snapshot();

  expect((await containing(base)).branches).toEqual([
    "main",
    "alpha",
    "elsewhere",
    "zeta",
    "remotes/origin/main"
  ]);
  expect((await containing(later)).branches).toEqual(["main"]);
  // Nothing on disk or among the refs changed.
  expect(snapshot()).toEqual(before);
});

it("leaves out the branches the graph hides", async () => {
  const base = head();
  git(["branch", "dependabot/npm/x"], repo());
  git(["branch", "keep"], repo());
  for (const ref of ["origin/main", "origin/dependabot/y", "fork/main"]) {
    git(["update-ref", `refs/remotes/${ref}`, base], repo());
  }

  expect((await containing(base, { hiddenRemotes: ["fork"] })).branches).toEqual([
    "main",
    "dependabot/npm/x",
    "keep",
    "remotes/origin/dependabot/y",
    "remotes/origin/main"
  ]);
  expect((await containing(base, { showRemoteBranches: false })).branches).toEqual([
    "main",
    "dependabot/npm/x",
    "keep"
  ]);
  // The patterns hide remote branches by their names on the remote too, but never the
  // checked-out branch or the branch chosen in the header.
  expect(
    (
      await containing(base, {
        hiddenRemotes: ["fork"],
        hiddenBranchPatterns: ["dependabot/*", "main"],
        shownBranch: "remotes/origin/dependabot/y"
      })
    ).branches
  ).toEqual(["main", "keep", "remotes/origin/dependabot/y"]);
});

it("orders the tags by their dates and names the tag the commit follows", async () => {
  const first = commitAt("first", 1_600_000_000);
  tagAt("v1.0.0", first, 1_600_000_000);
  const fix = commitAt("fix", 1_600_100_000);
  const second = commitAt("second", 1_600_200_000);
  // Named against their dates' order, so a name sort would put them the other way round. The
  // lightweight tag is dated by its commit, which is older than either annotated tag.
  tagAt("v1.10.0", second, 1_600_300_000);
  tagAt("v1.2.0", second, 1_600_400_000);
  git(["tag", "light", second], repo());
  git(["tag", "aaa-early", first], repo());

  const refs = await containing(fix);
  expect(refs.tags.map((tag) => tag.name)).toEqual(["light", "v1.10.0", "v1.2.0"]);
  // Annotated tags name the commit they point to, not the tag object.
  expect(refs.tags.every((tag) => tag.hash === second)).toBe(true);
  expect(refs.follows).toEqual({ name: "v1.0.0", hash: first });

  // The tagged commit itself follows whatever came before it, not its own tag.
  expect((await containing(first)).follows).toBeNull();
  expect((await containing(second)).follows).toEqual({ name: "v1.0.0", hash: first });
});

it("reports no tags and nothing followed for a root commit in an untagged repository", async () => {
  expect(await containing(head())).toEqual({ branches: ["main"], tags: [], follows: null });
});

it("answers through the repository query and refuses anything but a full commit ID", async () => {
  const hash = head();
  await expect(
    repositoryQuery(createGit(repo(), "git"), { kind: "containingRefs", hash, ...ALL })
  ).resolves.toEqual({ kind: "containingRefs", branches: ["main"], tags: [], follows: null });
  await Promise.all(
    ["HEAD", hash.slice(0, 8), "--all", `${hash}^`].map((revision) =>
      expect(containing(revision)).rejects.toThrow()
    )
  );
});

it("stops when its request is cancelled", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    loadContainingRefs(createGit(repo(), "git", controller.signal), head(), ALL)
  ).rejects.toThrow();
});
