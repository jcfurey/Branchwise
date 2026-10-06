import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import type { Contributor, Statistics, StatisticsQuery } from "@/backend/types";
import { remoteVisibility, type RemoteVisibility } from "@/backend/utils/remoteVisibility";

const DAY = 24 * 60 * 60;

/** The periods the view offers, in days back from now; `all` has no start. */
export const STATISTICS_RANGES = { "30": 30, "90": 90, "365": 365, all: null } as const;

/** How many days of daily counts are returned for the activity grid: a year and a week. */
export const ACTIVITY_DAYS = 372;

/** The revisions to count: one local branch, or what the graph shows when every branch is. */
async function scope(git: SimpleGit, branch: string, visibility: RemoteVisibility) {
  if (branch !== "") {
    const branches = await git.raw(["for-each-ref", "--format=%(refname)", "refs/heads/"]);
    if (!branches.split("\n").includes(branch)) {
      throw new Error(l10n.t("Choose a local branch to count its commits."));
    }
    return ["--end-of-options", branch];
  }
  const head = (await git.raw(["rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => "")).trim();
  const { branchArgs, logArgs } = await remoteVisibility(git, visibility);
  return [...branchArgs, "--tags", ...logArgs, ...(head ? [head] : [])];
}

/** Git's error for a repository whose HEAD has no commits yet, which has nothing to count. */
const NOTHING_TO_COUNT = /does not have any commits|unknown revision|bad default revision/;

/**
 * Who made the commits in a range, and when: each contributor's commit count and first and last
 * commit, the commits on each of the last `ACTIVITY_DAYS` days, and, with `lines`, the lines each
 * contributor added and deleted outside merges. People are named through `.mailmap`, so someone
 * who committed under several addresses counts once. Days are the author's own calendar days.
 */
export async function loadStatistics(
  git: SimpleGit,
  query: Omit<StatisticsQuery, "kind">,
  now = Math.floor(Date.now() / 1000)
): Promise<Statistics> {
  if (!Object.hasOwn(STATISTICS_RANGES, query.range)) {
    throw new Error(l10n.t("Choose a period to count."));
  }
  const days = STATISTICS_RANGES[query.range];
  const since = days === null ? [] : [`--since=${now - days * DAY}`];
  const revisions = await scope(git, query.branch, query);
  const run = (args: string[]) =>
    git.raw(args).catch((error: unknown) => {
      if (NOTHING_TO_COUNT.test(String(error))) {
        return "";
      }
      throw error;
    });

  const output = await run([
    "log",
    "--use-mailmap",
    "-z",
    "--date=short",
    "--format=%aN%x00%aE%x00%at%x00%ad",
    ...since,
    ...revisions
  ]);
  const people = new Map<string, Contributor>();
  const activity: Record<string, number> = {};
  const activeDays = new Set<string>();
  const recent = new Date((now - ACTIVITY_DAYS * DAY) * 1000).toISOString().slice(0, 10);
  let commits = 0;
  const fields = output.split("\0");
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const name = fields[index]!.replace(/^\n/, "");
    const email = fields[index + 1]!;
    const date = Number(fields[index + 2]);
    const day = fields[index + 3]!;
    commits++;
    activeDays.add(day);
    if (day >= recent) {
      activity[day] = (activity[day] ?? 0) + 1;
    }
    const key = email.toLowerCase() || name;
    const person = people.get(key);
    if (person === undefined) {
      people.set(key, { name, email, commits: 1, first: date, last: date });
    } else {
      person.commits++;
      person.first = Math.min(person.first, date);
      person.last = Math.max(person.last, date);
    }
  }

  if (query.lines && commits > 0) {
    const numstat = await run([
      "log",
      "--use-mailmap",
      "--no-merges",
      "--numstat",
      "--no-renames",
      "--format=%x00%aE",
      ...since,
      ...revisions
    ]);
    let person: Contributor | undefined;
    for (const line of numstat.split("\n")) {
      if (line.startsWith("\0")) {
        person = people.get(line.slice(1).toLowerCase());
        if (person !== undefined) {
          person.added ??= 0;
          person.deleted ??= 0;
        }
        continue;
      }
      // `added<TAB>deleted<TAB>path`; a binary file counts `-` lines.
      const match = /^(\d+|-)\t(\d+|-)\t/.exec(line);
      if (match !== null && person !== undefined) {
        person.added! += match[1] === "-" ? 0 : Number(match[1]);
        person.deleted! += match[2] === "-" ? 0 : Number(match[2]);
      }
    }
  }

  const contributors = [...people.values()].toSorted(
    (a, b) => b.commits - a.commits || a.name.localeCompare(b.name)
  );
  return {
    commits,
    activeDays: activeDays.size,
    first: contributors.length === 0 ? null : Math.min(...contributors.map((p) => p.first)),
    last: contributors.length === 0 ? null : Math.max(...contributors.map((p) => p.last)),
    contributors,
    activity,
    lines: query.lines
  };
}
