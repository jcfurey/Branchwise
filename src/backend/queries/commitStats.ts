import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { gitFolderOf, gitProcessOf } from "@/backend/gitClient";
import type { CommitStats } from "@/backend/types";
import { readDirectory } from "@/backend/utils/runGit";

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/** The most commits one Git process is asked about, which keeps its command line short. */
export const COMMIT_STATS_BATCH = 200;

/** The most commits one query may ask about. The page asks for the rows in sight. */
export const COMMIT_STATS_LIMIT = 1000;

/** Lines of the message body kept for the hover card. */
export const COMMIT_BODY_LINES = 6;

/** Characters kept of each of those lines; a longer line ends in an ellipsis. */
const BODY_LINE_LENGTH = 300;

/** How many answers the cache keeps before it forgets the oldest. */
const CACHE_SIZE = 10_000;

/**
 * Answers by repository folder and commit, for as long as the extension runs. A commit and its
 * parents never change, so neither does what it changed.
 */
const answers = new Map<string, CommitStats>();

function remember(key: string, stats: CommitStats) {
  if (answers.size >= CACHE_SIZE) {
    answers.delete(answers.keys().next().value!);
  }
  answers.set(key, stats);
}

/**
 * The options that make `git log` count what `diff-tree` lists for the commit details: a merge
 * against its first parent, a root commit against the empty tree, renames found as the details
 * find them, and the same diff algorithm, whatever the user's `diff.*` and `log.*` settings say.
 * Plumbing lists no copies, and a commit's trees hold no unmerged entries, so the details'
 * `--diff-filter` would leave nothing out here. Given to `log`, it would leave out the commits
 * that changed nothing, which must count as zero instead.
 */
function logArgs(hashes: string[]) {
  return [
    "log",
    "--no-walk=unsorted",
    // A commit that is gone, as after a rewrite and a garbage collection, is left out.
    "--ignore-missing",
    "--encoding=UTF-8",
    "-z",
    "--format=%H%x00%b",
    "--numstat",
    "--root",
    "--diff-merges=first-parent",
    "--find-renames",
    "--diff-algorithm=myers",
    "--no-relative",
    "--no-ext-diff",
    "--no-textconv",
    "--end-of-options",
    ...hashes,
    "--"
  ];
}

/** The body without its surrounding blank lines, cut to `COMMIT_BODY_LINES` lines. */
function bodyPreview(message: string): Pick<CommitStats, "body" | "bodyCut"> {
  const lines = message.replace(/\r\n?/g, "\n").split("\n");
  let start = 0;
  let end = lines.length;
  while (start < end && lines[start]!.trim() === "") {
    start++;
  }
  while (end > start && lines[end - 1]!.trim() === "") {
    end--;
  }
  const kept = lines
    .slice(start, Math.min(end, start + COMMIT_BODY_LINES))
    .map((line) => (line.length > BODY_LINE_LENGTH ? `${line.slice(0, BODY_LINE_LENGTH)}…` : line));
  return { body: kept.join("\n"), bodyCut: end - start > COMMIT_BODY_LINES };
}

/** One `--numstat` entry: lines added, lines deleted and the path, `-` for a binary file. */
const NUMSTAT = /^\n?(\d+|-)\t(\d+|-)\t(.*)$/s;

/**
 * The commits of `log -z --format=%H%x00%b --numstat`. Each starts with its ID and its body, two
 * fields, then one field per changed file. A rename leaves that field's path empty and puts its
 * source and destination in the two fields after it, which can hold anything but a NUL.
 */
function parseLog(output: string) {
  const fields = output.split("\0");
  const stats = new Map<string, CommitStats>();
  let index = 0;
  while (index < fields.length) {
    const hash = fields[index++]!.replace(/^\n/, "");
    if (hash === "" && index === fields.length) {
      break;
    }
    const body = fields[index++];
    if (!OBJECT_ID.test(hash) || body === undefined) {
      throw new Error("Unexpected log output");
    }
    const counts = { files: 0, additions: 0, deletions: 0 };
    for (
      let entry = NUMSTAT.exec(fields[index] ?? "");
      entry !== null;
      entry = NUMSTAT.exec(fields[index] ?? "")
    ) {
      index += entry[3] === "" ? 3 : 1;
      counts.files++;
      // Git prints `-` for both counts of content it treats as binary.
      if (entry[1] !== "-" && entry[2] !== "-") {
        counts.additions += Number(entry[1]);
        counts.deletions += Number(entry[2]);
      }
    }
    stats.set(hash, { ...counts, ...bodyPreview(body) });
  }
  return stats;
}

/**
 * How many files, added lines and deleted lines each commit of `hashes` has, with the start of
 * its message body. A merge counts against its first parent and a root commit against the empty
 * tree, as the commit details do. Answers are remembered, so a commit is read once; the rest are
 * read `COMMIT_STATS_BATCH` at a time, and a cancelled request stops between batches as well as
 * in one. Nothing on disk changes.
 */
export async function loadCommitStats(
  git: SimpleGit,
  hashes: string[]
): Promise<Record<string, CommitStats>> {
  // The list arrives unchecked from the page. Full IDs only: anything else could be read as an
  // option or name many commits.
  const list: unknown[] = Array.isArray(hashes) ? hashes : [hashes];
  for (const hash of list) {
    if (typeof hash !== "string" || !OBJECT_ID.test(hash)) {
      throw new Error(l10n.t("{0} is not a full commit ID.", String(hash)));
    }
  }
  if (list.length > COMMIT_STATS_LIMIT) {
    throw new Error(
      l10n.t("Ask for the changes of at most {0} commits at a time.", COMMIT_STATS_LIMIT)
    );
  }
  const folder = gitFolderOf(git) ?? (await readDirectory(git));
  const result: Record<string, CommitStats> = {};
  const unknown: string[] = [];
  for (const hash of new Set(list as string[])) {
    const known = answers.get(`${folder}\0${hash}`);
    if (known === undefined) {
      unknown.push(hash);
    } else {
      result[hash] = known;
    }
  }
  const signal = gitProcessOf(git)?.abort;
  for (let start = 0; start < unknown.length; start += COMMIT_STATS_BATCH) {
    signal?.throwIfAborted();
    // One batch after another: the next waits for the last, so a cancelled request starts none.
    // eslint-disable-next-line no-await-in-loop
    const output = await git.raw(logArgs(unknown.slice(start, start + COMMIT_STATS_BATCH)));
    for (const [hash, stats] of parseLog(output)) {
      remember(`${folder}\0${hash}`, stats);
      result[hash] = stats;
    }
  }
  return result;
}
