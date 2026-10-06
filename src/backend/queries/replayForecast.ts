import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { gitProcessOf } from "@/backend/gitClient";
import type { ReplayForecast, ReplayForecastQuery } from "@/backend/types";
import { gitVersionAtLeast } from "@/backend/utils/gitVersion";
import { readDirectory, readGitCode } from "@/backend/utils/runGit";
import { resolveCommit } from "@/backend/utils/validation";

/** Commits replayed at most. A longer replay is not forecast at all. */
export const REPLAY_FORECAST_LIMIT = 200;

/** Forecasts remembered at most, oldest dropped first. */
const CACHE_SIZE = 200;

/** Forecasts by their inputs. Every input is a commit ID, so an answer never goes stale. */
const cache = new Map<string, ReplayForecast>();

/** A commit to replay. `upstream` marks one whose change the target already has. */
type Commit = { hash: string; parents: string[]; subject: string; upstream: boolean };

/** Where one commit's replay ended: the new commit, or the files left in conflict. */
type Step = { commit: string } | { files: string[] };

/** The parent of a commit that has none: the empty tree. */
const NO_PARENT = "";

type Replayer = {
  /**
   * Merge `theirs` into `ours` from `base`, or from their merge bases when `base` is `null`, and
   * commit the result on `parents`, so that the next merge can start from it.
   */
  step(base: string | null, ours: string, theirs: string, parents: string[]): Promise<Step>;
};

const OBJECT_ID = /^[0-9a-f]{40}(?:[0-9a-f]{24})?$/;

/** Fixed details for throwaway commits, which never need the user's identity. */
const THROWAWAY_IDENTITY = {
  GIT_AUTHOR_NAME: "Branchwise",
  GIT_AUTHOR_EMAIL: "forecast@branchwise.invalid",
  GIT_AUTHOR_DATE: "1000000000 +0000",
  GIT_COMMITTER_NAME: "Branchwise",
  GIT_COMMITTER_EMAIL: "forecast@branchwise.invalid",
  GIT_COMMITTER_DATE: "1000000000 +0000"
};

/**
 * Run `replay` with Git writing every new object, the merged trees and the throwaway commits,
 * to a folder of its own that is deleted afterwards, while existing objects are still read from
 * the repository. Nothing is written to the repository at all, not even unreachable objects.
 */
async function withScratchObjects<T>(
  git: SimpleGit,
  replay: (replayer: Replayer) => Promise<T>
): Promise<T> {
  const objects = (
    await git.raw(["rev-parse", "--path-format=absolute", "--git-path", "objects"])
  ).trim();
  const cwd = await readDirectory(git);
  const scratch = await mkdtemp(path.join(os.tmpdir(), "branchwise-forecast-"));
  const env = {
    ...process.env,
    ...THROWAWAY_IDENTITY,
    GIT_OBJECT_DIRECTORY: scratch,
    GIT_ALTERNATE_OBJECT_DIRECTORIES: [objects, process.env["GIT_ALTERNATE_OBJECT_DIRECTORIES"]]
      .filter(Boolean)
      .join(path.delimiter)
  };
  const read = async (args: string[], codes = [0]) => {
    // Each command is short, so a cancelled request stops before its next one.
    gitProcessOf(git)?.abort?.throwIfAborted();
    return readGitCode(git, args, codes, { env, cwd });
  };
  const commit = async (tree: string, parents: string[]) => {
    const { stdout } = await read([
      "commit-tree",
      "--no-gpg-sign",
      ...parents.flatMap((parent) => ["-p", parent]),
      "-m",
      "forecast",
      tree
    ]);
    return stdout.trim();
  };
  let empty: Promise<string> | undefined;
  const orEmpty = (hash: string) => {
    if (hash !== NO_PARENT) {
      return hash;
    }
    empty ??= read(["hash-object", "-t", "tree", "-w", "--stdin"]).then(({ stdout }) =>
      commit(stdout.trim(), [])
    );
    return empty;
  };
  const replayer: Replayer = {
    async step(base, ours, theirs, parents) {
      const { stdout, code } = await read(
        [
          "merge-tree",
          "--write-tree",
          "--name-only",
          "--no-messages",
          "-z",
          ...(base === null ? [] : [`--merge-base=${await orEmpty(base)}`]),
          ours,
          await orEmpty(theirs)
        ],
        [0, 1]
      );
      // The new tree's ID, then each conflicted path, all ending in NUL. Git also exits with 1
      // for some arguments it cannot use, and then prints no tree.
      const [tree = "", ...files] = stdout.split("\0");
      if (!OBJECT_ID.test(tree)) {
        throw new Error(l10n.t("Git could not forecast this replay."));
      }
      return code === 0
        ? { commit: await commit(tree, parents) }
        : { files: [...new Set(files.filter(Boolean))] };
    }
  };
  try {
    return await replay(replayer);
  } finally {
    await rm(scratch, { recursive: true, force: true, maxRetries: 3 });
  }
}

function stopAt(commit: Commit, files: string[], replayed: number): ReplayForecast {
  return { stop: { hash: commit.hash, subject: commit.subject, files }, replayed };
}

/**
 * Replay `commits` one by one onto `onto`, as `git cherry-pick` or `git revert` would. A merge
 * is taken against its parent `mainline`, and left out without one, as Git would refuse it.
 */
async function replayList(
  replayer: Replayer,
  onto: string,
  commits: Commit[],
  revert: boolean,
  mainline: number
): Promise<ReplayForecast> {
  let current = onto;
  let replayed = 0;
  for (const commit of commits) {
    const merge = commit.parents.length > 1;
    if (merge && mainline < 1) {
      continue;
    }
    const parent = commit.parents[merge ? mainline - 1 : 0] ?? NO_PARENT;
    // A pick onto its own parent changes nothing, so it needs no merge.
    if (!revert && current === parent) {
      current = commit.hash;
      replayed += 1;
      continue;
    }
    // Each commit starts from where the one before it ended.
    // eslint-disable-next-line no-await-in-loop
    const step = await (revert
      ? replayer.step(commit.hash, current, parent, [current])
      : replayer.step(parent, current, commit.hash, [current]));
    if ("files" in step) {
      return stopAt(commit, step.files, replayed);
    }
    current = step.commit;
    replayed += 1;
  }
  return { stop: null, replayed };
}

/**
 * Replay a branch onto `onto` as `git rebase --rebase-merges onto` does, which is how Branchwise
 * rebases. The first-parent line from HEAD starts at `onto`. A side branch that forks from
 * outside the range keeps its fork point. Each commit is picked onto the replayed copy of its
 * parent, and each merge is merged afresh from its replayed parents, unless nothing under it
 * changed. Commits whose change `onto` already has are dropped.
 */
async function replayBranch(
  replayer: Replayer,
  onto: string,
  head: string,
  commits: Commit[]
): Promise<ReplayForecast> {
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  const firstParentLine = new Set<string>();
  for (let hash = head; byHash.has(hash); hash = byHash.get(hash)!.parents[0] ?? "") {
    firstParentLine.add(hash);
  }
  const replayedAs = new Map<string, string>();
  /** Where parent `index` of `commit` stands once the commits before it are replayed. */
  const placed = (commit: Commit, index: number) => {
    const parent = commit.parents[index];
    if (parent === undefined) {
      return onto;
    }
    const copy = replayedAs.get(parent);
    if (copy !== undefined) {
      return copy;
    }
    return index === 0 && firstParentLine.has(commit.hash) ? onto : parent;
  };
  const replay = async (commit: Commit, parents: string[]): Promise<Step> => {
    const [first = onto, ...others] = parents;
    if (others.length === 0) {
      return replayer.step(commit.parents[0] ?? NO_PARENT, first, commit.hash, [first]);
    }
    let current = first;
    for (const other of others) {
      // An octopus merge takes its other parents one at a time.
      // eslint-disable-next-line no-await-in-loop
      const step = await replayer.step(null, current, other, [current, other]);
      if ("files" in step) {
        return step;
      }
      current = step.commit;
    }
    return { commit: current };
  };
  let replayed = 0;
  for (const commit of commits) {
    if (commit.upstream) {
      replayedAs.set(commit.hash, placed(commit, 0));
      continue;
    }
    const parents = commit.parents.map((_, index) => placed(commit, index));
    if (parents.length > 0 && parents.every((parent, index) => parent === commit.parents[index])) {
      // Nothing under the commit changed, so Git keeps it as it is.
      replayedAs.set(commit.hash, commit.hash);
      replayed += 1;
      continue;
    }
    // Each commit starts from the replayed copies of its parents.
    // eslint-disable-next-line no-await-in-loop
    const step = await replay(commit, parents);
    if ("files" in step) {
      return stopAt(commit, step.files, replayed);
    }
    replayedAs.set(commit.hash, step.commit);
    replayed += 1;
  }
  return { stop: null, replayed };
}

/** Parse `--format=%m%x00%H%x00%P%x00%s` records from `log -z`. */
function parseCommits(output: string): Commit[] {
  const fields = output.split("\0");
  const commits: Commit[] = [];
  for (let index = 0; index + 3 < fields.length; index += 4) {
    commits.push({
      upstream: fields[index] === "=",
      hash: fields[index + 1]!,
      parents: fields[index + 2]!.split(" ").filter(Boolean),
      subject: fields[index + 3]!
    });
  }
  return commits;
}

/** The commits `git rebase onto` would consider, oldest first, or `null` when too many. */
async function branchCommits(git: SimpleGit, onto: string, head: string) {
  const count = Number(
    (
      await git.raw([
        "rev-list",
        "--count",
        `--max-count=${REPLAY_FORECAST_LIMIT + 1}`,
        `${onto}..${head}`,
        "--"
      ])
    ).trim()
  );
  if (count > REPLAY_FORECAST_LIMIT) {
    return null;
  }
  // Git leaves out commits whose change `onto` already has, as `--cherry-mark` marks with `=`.
  return parseCommits(
    await git.raw([
      "log",
      "-z",
      "--reverse",
      "--topo-order",
      "--right-only",
      "--cherry-mark",
      "--format=%m%x00%H%x00%P%x00%s",
      `${onto}...${head}`,
      "--"
    ])
  );
}

/** `hashes` in the order given, each with its parents and subject. */
async function listedCommits(git: SimpleGit, hashes: string[]) {
  const commits = parseCommits(
    await git.raw([
      "log",
      "--no-walk=unsorted",
      "-z",
      "--format=%x00%H%x00%P%x00%s",
      "--end-of-options",
      ...hashes.map((hash) => `${hash}^{commit}`),
      "--"
    ])
  );
  if (commits.length !== hashes.length) {
    throw new Error(l10n.t("Git could not forecast this replay."));
  }
  return commits;
}

function remember(key: string, forecast: ReplayForecast) {
  if (cache.size >= CACHE_SIZE) {
    cache.delete(cache.keys().next().value!);
  }
  cache.set(key, forecast);
  return forecast;
}

/**
 * Where replaying commits would first stop with conflicts, and in which files, from merges Git
 * runs in memory, one commit at a time: the work tree, the index and every ref stay as they are.
 * Later stops are not forecast, since they depend on how the user resolves the first. Needs
 * `merge-tree --merge-base`, which came in Git 2.40.
 */
export async function loadReplayForecast(
  git: SimpleGit,
  query: ReplayForecastQuery
): Promise<ReplayForecast> {
  if (!(await gitVersionAtLeast(git, 2, 40))) {
    return { stop: null, replayed: 0, skipped: "unsupported" };
  }
  const onto = await resolveCommit(git, query.onto);
  if (query.mode === "rebase") {
    const head = await resolveCommit(git, "HEAD");
    const key = JSON.stringify(["rebase", onto, head]);
    const known = cache.get(key);
    if (known !== undefined) {
      return known;
    }
    // A branch that already contains `onto` is up to date: Git replays nothing.
    const { code } = await readGitCode(git, ["merge-base", "--is-ancestor", onto, head], [0, 1]);
    if (code === 0) {
      return remember(key, { stop: null, replayed: 0 });
    }
    const commits = await branchCommits(git, onto, head);
    if (commits === null) {
      return remember(key, { stop: null, replayed: 0, skipped: "limit" });
    }
    return remember(
      key,
      await withScratchObjects(git, (replayer) => replayBranch(replayer, onto, head, commits))
    );
  }
  if (query.commits.length > REPLAY_FORECAST_LIMIT) {
    return { stop: null, replayed: 0, skipped: "limit" };
  }
  const commits = await listedCommits(git, query.commits);
  const mainline = query.mainline ?? 0;
  const key = JSON.stringify([query.mode, onto, mainline, commits.map((commit) => commit.hash)]);
  const known = cache.get(key);
  if (known !== undefined) {
    return known;
  }
  return remember(
    key,
    await withScratchObjects(git, (replayer) =>
      replayList(replayer, onto, commits, query.mode === "revert", mainline)
    )
  );
}
