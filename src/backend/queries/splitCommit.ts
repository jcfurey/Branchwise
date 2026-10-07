import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { loadEditPlan } from "@/backend/queries/editCommit";
import type { SplitFile, SplitHunk, SplitPlan } from "@/backend/types";
import { literalPath } from "@/backend/utils/history";
import { evalPromises } from "@/backend/utils/promise";
import { readGitBytes, readGitWithInput } from "@/backend/utils/runGit";
import { resolveCommit } from "@/backend/utils/validation";

/** The most lines of a hunk that a split plan carries for the dialog to show. */
export const SPLIT_PREVIEW_LINES = 40;

/** A file the commit changes, as `git diff-tree --raw` lists it. */
export type SplitEntry = {
  status: string;
  srcMode: string;
  dstMode: string;
  dstBlob: string;
  /** The path before a rename; the same as `path` otherwise. */
  from: string;
  path: string;
};
/** A hunk with its exact lines, each without its newline, as a patch of it needs them. */
export type SplitSourceHunk = SplitHunk & { body: Buffer[] };
/** A file with what building the parts needs: for a file split by hunk, its patch header too. */
export type SplitSource = {
  entry: SplitEntry;
  header: Buffer[] | null;
  hunks: SplitSourceHunk[] | null;
};
export type SplitAnalysis = {
  plan: SplitPlan;
  /** The target's parent, or null for the first commit. */
  parent: string | null;
  /** The target's tree, which the last part must rebuild exactly. */
  tree: string;
  sources: SplitSource[];
};

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const REGULAR_FILE = new Set(["100644", "100755"]);

/** Split `bytes` into lines without their newlines; a final newline ends the last line. */
function splitLines(bytes: Buffer): Buffer[] {
  const lines: Buffer[] = [];
  let start = 0;
  for (let end = bytes.indexOf(10); end !== -1; end = bytes.indexOf(10, start)) {
    lines.push(bytes.subarray(start, end));
    start = end + 1;
  }
  if (start < bytes.length) {
    lines.push(bytes.subarray(start));
  }
  return lines;
}

/** The files `target` changes from `base`, renames included, with their modes and blobs. */
async function loadEntries(git: SimpleGit, base: string, target: string) {
  const fields = (
    await git.raw([
      "diff-tree",
      "-r",
      "-z",
      "-M",
      "--no-abbrev",
      "--ignore-submodules=none",
      base,
      target,
      "--"
    ])
  ).split("\0");
  const entries: SplitEntry[] = [];
  for (let index = 0; index < fields.length - 1;) {
    const [srcMode, dstMode, , dstBlob, status] = fields[index]!.slice(1).split(" ");
    const kind = status![0]!;
    const from = fields[index + 1]!;
    const to = kind === "R" || kind === "C" ? fields[index + 2]! : from;
    index += kind === "R" || kind === "C" ? 3 : 2;
    entries.push({
      status: kind,
      srcMode: srcMode!,
      dstMode: dstMode!,
      dstBlob: dstBlob!,
      from,
      path: to
    });
  }
  return entries;
}

/**
 * The file's patch without context, so that changes on neighbouring lines stay separate hunks,
 * or null for a binary file. The options keep the user's diff settings out of its form.
 */
async function loadPatch(git: SimpleGit, base: string, target: string, path: string) {
  const patch = await readGitBytes(git, [
    "diff-tree",
    "-p",
    "-U0",
    "--inter-hunk-context=0",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    base,
    target,
    "--",
    literalPath(path)
  ]);
  const header: Buffer[] = [];
  const hunks: SplitSourceHunk[] = [];
  for (const line of splitLines(patch)) {
    const match = line[0] === 0x40 ? HUNK_HEADER.exec(line.toString("latin1")) : null;
    if (match) {
      hunks.push({
        oldStart: Number(match[1]),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        lines: [],
        hidden: 0,
        body: []
      });
    } else if (hunks.length > 0) {
      hunks.at(-1)!.body.push(line);
    } else if (/^(Binary files |GIT binary patch)/.test(line.toString("latin1"))) {
      return null;
    } else {
      header.push(line);
    }
  }
  for (const hunk of hunks) {
    // The marker for a missing final newline belongs to the patch, not to what the dialog shows.
    const shown = hunk.body.filter((line) => line[0] !== 0x5c);
    hunk.lines = shown.slice(0, SPLIT_PREVIEW_LINES).map((line) => line.toString("utf8"));
    hunk.hidden = shown.length - hunk.lines.length;
  }
  return { header, hunks };
}

/** How the dialog names a change: copies are not detected, and a type change is a change. */
function statusOf(entry: SplitEntry): SplitFile["status"] {
  return entry.status === "A" || entry.status === "D" || entry.status === "R" ? entry.status : "M";
}

function publicHunk({ oldStart, oldLines, newStart, newLines, lines, hidden }: SplitHunk) {
  return { oldStart, oldLines, newStart, newLines, lines, hidden };
}

/**
 * Find a commit of the checked-out branch that can be split, the files it changes and, for a
 * text file changed in place, its hunks. The parts are built from the target's parent, or from
 * the empty tree for the first commit, and the later commits are rebuilt on the last part
 * without a rebase, so an older first commit qualifies too. Reads only: nothing on disk changes.
 */
export async function analyzeSplit(git: SimpleGit, target: string): Promise<SplitAnalysis> {
  const hash = await resolveCommit(git, target);
  const parents = (await git.raw(["rev-list", "--parents", "-n", "1", hash, "--"]))
    .trim()
    .split(" ")
    .slice(1);
  if (parents.length > 1) {
    throw new Error(l10n.t("A merge commit cannot be split."));
  }
  const plan = await loadEditPlan(git, hash, true);
  const parent = parents[0] ?? null;
  // The empty tree, which Git knows without storing it, stands in for the first commit's parent.
  const base =
    parent ?? (await readGitWithInput(git, ["hash-object", "-t", "tree", "--stdin"], "")).trim();
  const [tree, entries] = await Promise.all([
    git.raw(["rev-parse", "--verify", `${plan.target}^{tree}`]),
    loadEntries(git, base, plan.target)
  ]);
  const sources = await evalPromises(entries, 4, async (entry): Promise<SplitSource> => {
    const inPlace =
      entry.status === "M" && entry.srcMode === entry.dstMode && REGULAR_FILE.has(entry.dstMode);
    const patch = inPlace ? await loadPatch(git, base, plan.target, entry.path) : null;
    // A single hunk goes whole: there is nothing to choose between.
    return patch === null || patch.hunks.length < 2
      ? { entry, header: null, hunks: null }
      : { entry, ...patch };
  });
  const changes = sources.reduce((sum, source) => sum + (source.hunks?.length ?? 1), 0);
  if (changes < 2) {
    throw new Error(l10n.t("This commit has only one change, so there is nothing to split."));
  }
  return {
    plan: {
      ...plan,
      files: sources.map(({ entry, hunks }) => ({
        path: entry.path,
        from: entry.from,
        status: statusOf(entry),
        hunks: hunks?.map(publicHunk) ?? null
      }))
    },
    parent,
    tree: tree.trim(),
    sources
  };
}

/** The files and hunks of a commit to split, for the dialog. Reads only. */
export async function loadSplitPlan(git: SimpleGit, target: string): Promise<SplitPlan> {
  return (await analyzeSplit(git, target)).plan;
}
