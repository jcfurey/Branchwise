import type { SimpleGit } from "simple-git";

import { gitProcessOf } from "@/backend/gitClient";
import type { ConflictForecastEntry, ConflictForecastScope } from "@/backend/types";
import { gitVersionAtLeast } from "@/backend/utils/gitVersion";
import { type RemoteVisibility, remoteVisibility } from "@/backend/utils/remoteVisibility";
import { readGitCode } from "@/backend/utils/runGit";

/** Local branches checked at most, those with the newest commits first. */
export const CONFLICT_FORECAST_LIMIT = 50;

/** Remote-tracking branches checked at most, on top of the local ones. */
export const REMOTE_FORECAST_LIMIT = 50;

/**
 * Remote-tracking branches with no commit for this many days are left out: nobody seems to be
 * working on them, and a repository can keep hundreds of them.
 */
export const REMOTE_FORECAST_DAYS = 30;

/** Merges run at once. */
const PARALLEL = 4;

/** Results remembered at most, oldest dropped first. */
const CACHE_SIZE = 1000;

/**
 * Files in conflict by the pair of commits merged, or `null` for a merge Git could not try, such
 * as one between unrelated histories. Both commits are fixed, so the answer never goes stale.
 */
const cache = new Map<string, string[] | null>();

/**
 * The files that merging `tip` into `head` would leave in conflict, from a merge Git runs
 * entirely in memory: the work tree, the index and every ref stay as they are.
 */
async function conflictedFiles(git: SimpleGit, head: string, tip: string) {
  const key = `${head}:${tip}`;
  if (cache.has(key)) {
    return cache.get(key)!;
  }
  let files: string[] | null;
  try {
    const { stdout, code } = await readGitCode(
      git,
      ["merge-tree", "--write-tree", "--name-only", "--no-messages", "-z", head, tip],
      [0, 1]
    );
    // The new tree's ID, then each conflicted path, all ending in NUL.
    files = code === 0 ? [] : stdout.split("\0").slice(1).filter(Boolean);
  } catch (error) {
    // A merge stopped because its request was cancelled says nothing about the commits.
    if (gitProcessOf(git)?.abort?.aborted === true) {
      throw error;
    }
    files = null;
  }
  if (cache.size >= CACHE_SIZE) {
    cache.delete(cache.keys().next().value!);
  }
  cache.set(key, files);
  return files;
}

/** What `for-each-ref` reports of each branch, its fields separated by NUL. */
const FIELDS = [
  "%(refname)",
  "%(objectname)",
  "%(committerdate:unix)",
  "%(committername)",
  "%(upstream)",
  "%(symref)"
].join("%00");

type ListedRef = {
  ref: string;
  tip: string;
  date: number;
  committer: string;
  upstream: string;
  symref: string;
};

function parseRefs(output: string): ListedRef[] {
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [ref = "", tip = "", date = "", committer = "", upstream = "", symref = ""] =
        line.split("\0");
      return { ref, tip, date: Number(date) || 0, committer, upstream, symref };
    });
}

type Candidate = { branch: string; remote: boolean; tip: string; date: number; committer: string };

function candidate(row: ListedRef, remote: boolean): Candidate {
  const prefix = remote ? "refs/remotes/" : "refs/heads/";
  return {
    branch: row.ref.slice(prefix.length),
    remote,
    tip: row.tip,
    date: row.date,
    committer: row.committer
  };
}

/**
 * The remote-tracking branches worth trying, newest first: recent ones that hold work HEAD does
 * not have, as far as Git can tell someone else's. `listed` are the local branches tried already;
 * their upstreams are left out, as is the upstream of HEAD's own branch (which is only "behind"),
 * and any branch at the same commit as a local one, whose entry already says it all. So are
 * `<remote>/HEAD` and the branches the graph hides.
 */
async function remoteCandidates(
  git: SimpleGit,
  head: string,
  listed: ListedRef[],
  visibility: RemoteVisibility
): Promise<Candidate[]> {
  const [remoteRefs, localRefs, { excluded }] = await Promise.all([
    git.raw([
      "for-each-ref",
      `--no-merged=${head}`,
      "--sort=-committerdate",
      `--format=${FIELDS}`,
      "refs/remotes/"
    ]),
    git.raw(["for-each-ref", "--format=%(HEAD)%00%(objectname)%00%(upstream)", "refs/heads/"]),
    remoteVisibility(git, {
      showRemoteBranches: true,
      hiddenRemotes: visibility.hiddenRemotes ?? [],
      hiddenBranchPatterns: visibility.hiddenBranchPatterns ?? []
    })
  ]);
  const skipped = new Set(listed.map((row) => row.upstream));
  const localTips = new Set<string>();
  for (const line of localRefs.split("\n").filter(Boolean)) {
    const [current = "", tip = "", upstream = ""] = line.split("\0");
    localTips.add(tip);
    if (current === "*") {
      skipped.add(upstream);
    }
  }
  skipped.delete("");
  const cutoff = Date.now() / 1000 - REMOTE_FORECAST_DAYS * 24 * 60 * 60;
  const chosen: Candidate[] = [];
  // Newest first, so the first branch past the cutoff ends the list.
  for (const row of parseRefs(remoteRefs)) {
    if (row.date < cutoff || chosen.length >= REMOTE_FORECAST_LIMIT) {
      break;
    }
    if (
      row.symref !== "" ||
      row.ref.endsWith("/HEAD") ||
      skipped.has(row.ref) ||
      localTips.has(row.tip) ||
      excluded.has(row.ref.slice("refs/remotes/".length))
    ) {
      continue;
    }
    chosen.push(candidate(row, true));
  }
  return chosen;
}

/**
 * The branches that would not merge cleanly into HEAD, each with its conflicted files and the
 * committer and date of its last commit: local branches first, then with `localAndRemote` the
 * remote-tracking branches `remoteCandidates` picks. Only branches HEAD does not contain yet are
 * tried, so HEAD's own branch never is. Empty when the scope is `off`, when HEAD has no commit
 * yet, or when Git is older than 2.38.
 */
export async function loadConflictForecast(
  git: SimpleGit,
  options: RemoteVisibility & { scope: ConflictForecastScope } = { scope: "local" }
): Promise<ConflictForecastEntry[]> {
  // `merge-tree --write-tree` came in Git 2.38.
  if (options.scope === "off" || !(await gitVersionAtLeast(git, 2, 38))) {
    return [];
  }
  const head = (
    await git.raw(["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]).catch(() => "")
  ).trim();
  if (head === "") {
    return [];
  }
  const local = parseRefs(
    await git.raw([
      "for-each-ref",
      `--no-merged=${head}`,
      "--sort=-committerdate",
      `--count=${CONFLICT_FORECAST_LIMIT}`,
      `--format=${FIELDS}`,
      "refs/heads/"
    ])
  );
  const branches = local.map((row) => candidate(row, false));
  if (options.scope === "localAndRemote" && options.showRemoteBranches !== false) {
    branches.push(...(await remoteCandidates(git, head, local, options)));
  }
  const conflicts: ConflictForecastEntry[] = [];
  for (let start = 0; start < branches.length; start += PARALLEL) {
    // A few merges at a time, so that a repository with many branches stays responsive.
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      branches
        .slice(start, start + PARALLEL)
        .map(async (branch) => ({ branch, files: await conflictedFiles(git, head, branch.tip) }))
    );
    for (const { branch, files } of results) {
      if (files !== null && files.length > 0) {
        const { branch: name, remote, committer, date } = branch;
        conflicts.push({ branch: name, remote, files, committer, date });
      }
    }
  }
  return conflicts;
}
