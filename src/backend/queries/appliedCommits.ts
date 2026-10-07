import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { gitProcessOf } from "@/backend/gitClient";
import type { AppliedCommits, EquivalentCommit, SubjectedCommit } from "@/backend/types";
import { branchListRef } from "@/backend/utils/refs";
import { readGitCode, readGitWithInput } from "@/backend/utils/runGit";

/**
 * Commits a branch may have that the checked-out commit does not, for its applied commits to be
 * looked for. Past this the branch is skipped: comparing patches reads every one of them.
 */
export const APPLIED_COMMITS_LIMIT = 2000;

/** Commits of the checked-out branch compared at most, newest first, by Find Equivalent Commit. */
export const EQUIVALENT_SEARCH_LIMIT = 5000;

/** Answers remembered at most, oldest dropped first. */
const CACHE_SIZE = 100;

/**
 * Answers by the pair of commits compared: HEAD's and the branch tip's. Both are fixed, so an
 * answer never goes stale; a branch or HEAD that moves asks about another pair.
 */
const cache = new Map<string, AppliedCommits>();

/** A full SHA-1 or SHA-256 object ID. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * How the patches are written for `git patch-id`. Every option the user's configuration could
 * change is spelt out, so that the same change always reads the same, whatever the settings.
 * Renames are not followed, as Git's own patch comparison does not follow them.
 */
const PATCH_OPTIONS = [
  "-p",
  "--format=commit %H",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--no-renames",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "-U3",
  "--inter-hunk-context=0",
  "--diff-algorithm=myers"
];

/** Stop here when the request has been cancelled: Git's commands that read input do not. */
function throwIfCancelled(git: SimpleGit) {
  gitProcessOf(git)?.abort?.throwIfAborted();
}

/** HEAD's commit, or `""` when HEAD has none yet. */
async function headCommit(git: SimpleGit) {
  return (
    await git.raw(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).catch(() => "")
  ).trim();
}

/**
 * The stable patch ID of each of `hashes`, from `git patch-id --stable` over their patches. A
 * commit that changes nothing has no patch ID, and no entry.
 */
async function patchIds(git: SimpleGit, hashes: string[]): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  if (hashes.length === 0) {
    return ids;
  }
  // On standard input, as any number of commits may be asked about.
  const patches = await readGitWithInput(
    git,
    ["log", "--no-walk=unsorted", "--stdin", ...PATCH_OPTIONS],
    hashes.join("\n") + "\n"
  );
  throwIfCancelled(git);
  const output = await readGitWithInput(git, ["patch-id", "--stable"], patches);
  for (const line of output.split("\n")) {
    const [id, hash] = line.trim().split(" ");
    if (id && hash) {
      ids.set(hash, id);
    }
  }
  return ids;
}

/** `%m`, `%H` and `%s` of each commit `git log` lists, its fields separated by NUL. */
function parseMarked(output: string) {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [mark = "", hash = "", subject = ""] = line.split("\0");
      return { mark, hash, subject };
    });
}

function remember(key: string, answer: AppliedCommits) {
  if (cache.size >= CACHE_SIZE) {
    cache.delete(cache.keys().next().value!);
  }
  cache.set(key, answer);
  return answer;
}

/**
 * Which of `branch`'s commits that HEAD does not have make a change HEAD already has, as after a
 * cherry-pick or a rebase, and the commit of HEAD's that makes it. Git compares patch IDs:
 * `--cherry-mark` marks with `=` each commit whose patch the other side has. Merges are left
 * out, since a merge has no single patch. A branch with more than `APPLIED_COMMITS_LIMIT` commits
 * that HEAD lacks is not compared, and the answer says it was skipped. Nothing on disk changes.
 */
export async function loadAppliedCommits(git: SimpleGit, branch: string): Promise<AppliedCommits> {
  // Exact ref lookup also rejects revision expressions such as main~1.
  const [tip, head] = await Promise.all([
    git.raw(["show-ref", "--verify", "--hash", branchListRef(branch)]).then((out) => out.trim()),
    headCommit(git)
  ]);
  const key = `${head}:${tip}`;
  const known = cache.get(key);
  if (known !== undefined) {
    return known;
  }
  const none: AppliedCommits = { head, tip, skipped: false, applied: [] };
  if (head === "" || head === tip) {
    return none;
  }
  // One past the limit tells a branch at the limit from one beyond it. Each line is a commit and
  // its parents, so merges can be told apart.
  const listed = (
    await git.raw([
      "rev-list",
      `--max-count=${APPLIED_COMMITS_LIMIT + 1}`,
      "--parents",
      tip,
      `^${head}`,
      "--"
    ])
  )
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split(" "));
  if (listed.length > APPLIED_COMMITS_LIMIT) {
    return remember(key, { ...none, skipped: true });
  }
  const own = new Set(listed.filter((line) => line.length <= 2).map(([hash]) => hash!));
  if (own.size === 0) {
    return remember(key, none);
  }
  const marked = parseMarked(
    await git.raw([
      "log",
      "--cherry-mark",
      "--left-right",
      "--no-merges",
      "--format=%m%x00%H%x00%s",
      `${head}...${tip}`,
      "--"
    ])
  ).filter((commit) => commit.mark === "=");
  // With `--cherry-mark`, `=` takes the place of the side's mark, so the side comes from `own`.
  const picked = marked.filter((commit) => own.has(commit.hash));
  const theirs = marked.filter((commit) => !own.has(commit.hash));
  if (picked.length === 0) {
    return remember(key, none);
  }
  throwIfCancelled(git);
  // Git says only that each picked commit has an equal on HEAD's side, not which; patch IDs of
  // just the marked commits pair them up.
  const ids = await patchIds(
    git,
    [...picked, ...theirs].map((commit) => commit.hash)
  );
  // Newest first, as `git log` lists them, so the latest equal commit wins.
  const byId = new Map<string, SubjectedCommit>();
  for (const { hash, subject } of theirs) {
    const id = ids.get(hash);
    if (id !== undefined && !byId.has(id)) {
      byId.set(id, { hash, subject });
    }
  }
  throwIfCancelled(git);
  return remember(key, {
    ...none,
    applied: picked.map(({ hash }) => {
      const id = ids.get(hash);
      return { hash, equivalent: (id === undefined ? undefined : byId.get(id)) ?? null };
    })
  });
}

/** The paths a commit changes, without following renames, as `diff-tree` reports them. */
async function changedPaths(git: SimpleGit, hash: string) {
  const output = await git.raw([
    "diff-tree",
    "--no-commit-id",
    "--name-only",
    "--no-renames",
    "-r",
    "-z",
    "--root",
    hash
  ]);
  return output.split("\0").filter(Boolean);
}

/**
 * The commit of HEAD's history that makes the same change as `hash`, by stable patch ID, among
 * the commits HEAD has that `hash` does not (`HEAD...hash`, left side). Only those that change
 * one of the same files can match, so Git is asked for those alone, the newest
 * `EQUIVALENT_SEARCH_LIMIT` at most; `truncated` says whether older ones were left. `onHead` says
 * the commit is in HEAD's history already. Nothing on disk changes.
 */
export async function findEquivalentCommit(
  git: SimpleGit,
  hash: string
): Promise<EquivalentCommit> {
  // A full ID only: anything else could be read as an option or name many commits.
  if (!OBJECT_ID.test(hash)) {
    throw new Error(l10n.t("{0} is not a full commit ID.", hash));
  }
  const [head, parents] = await Promise.all([
    headCommit(git),
    git.raw(["rev-list", "--no-walk", "--parents", hash, "--"]).then((out) => out.trim())
  ]);
  if (head === "") {
    throw new Error(l10n.t("There is no checked-out commit to compare with."));
  }
  if (parents.split(" ").length > 2) {
    throw new Error(l10n.t("A merge commit has no single change to look for."));
  }
  const result: EquivalentCommit = { onHead: false, equivalent: null, truncated: false };
  // Git answers through the exit code alone: 0 for an ancestor, 1 for any other commit.
  const { code } = await readGitCode(git, ["merge-base", "--is-ancestor", hash, head], [0, 1]);
  if (code === 0) {
    return { ...result, onHead: true };
  }
  throwIfCancelled(git);
  const own = (await patchIds(git, [hash])).get(hash);
  if (own === undefined) {
    // A commit that changes nothing has no patch to match.
    return result;
  }
  // Paths with a line break cannot go one per line; leaving them out only widens the search.
  const paths = (await changedPaths(git, hash)).filter((path) => !/[\r\n]/.test(path));
  const listed = (
    await readGitWithInput(
      git,
      [
        "rev-list",
        "--no-merges",
        "--left-only",
        `--max-count=${EQUIVALENT_SEARCH_LIMIT + 1}`,
        `${head}...${hash}`,
        "--stdin"
      ],
      // After `--`, standard input names paths, each taken literally.
      ["--", ...paths.map((path) => `:(literal)${path}`)].join("\n") + "\n"
    )
  )
    .split("\n")
    .filter(Boolean);
  throwIfCancelled(git);
  const candidates = listed.slice(0, EQUIVALENT_SEARCH_LIMIT);
  const ids = await patchIds(git, candidates);
  const match = candidates.find((candidate) => ids.get(candidate) === own);
  const truncated = listed.length > EQUIVALENT_SEARCH_LIMIT;
  if (match === undefined) {
    return { ...result, truncated };
  }
  const subject = (await git.raw(["log", "-1", "--no-walk", "--format=%s", match, "--"])).replace(
    /\n$/,
    ""
  );
  return { ...result, equivalent: { hash: match, subject } };
}
