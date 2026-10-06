import { createHash } from "node:crypto";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import type { AbsorbHunk, AbsorbPlan, AbsorbReason } from "@/backend/types";
import { literalPath } from "@/backend/utils/history";
import { readBlob, readGitBytes } from "@/backend/utils/runGit";
import { resolveCommit } from "@/backend/utils/validation";

/** The most commits of the branch that staged changes are absorbed into. */
export const ABSORB_LIMIT = 100;

/** A staged file as `git diff --cached --raw` lists it. */
export type StagedEntry = {
  status: string;
  srcMode: string;
  dstMode: string;
  dstBlob: string;
  srcBlob: string;
  /** The path before a rename or copy; the same as `path` otherwise. */
  from: string;
  path: string;
};
/** A hunk with its own lines, each without its newline, and the commit it goes into. */
export type StagedHunk = AbsorbHunk & { body: Buffer[]; target: string | null };
/** A changed file whose hunks can each be absorbed: its patch header and hunks, in order. */
export type StagedFile = { path: string; header: Buffer[]; hunks: StagedHunk[] };
export type AbsorbAnalysis = {
  plan: AbsorbPlan;
  files: StagedFile[];
  /** Files that stay staged whole, such as added or binary ones. */
  whole: StagedEntry[];
};

type Candidate = { hash: string; parent: string | null; subject: string };

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;
const BLAME_LINE = /^([0-9a-f]{40}|[0-9a-f]{64}) \d+ (\d+)/;
const REGULAR_FILE = new Set(["100644", "100755"]);

/**
 * The commits staged changes can be absorbed into, newest first: HEAD's first parents back to
 * where the branch meets its upstream. Without an upstream, commits that a remote-tracking branch
 * or the repository's main local branch already has are left out. The walk stops before a merge,
 * which the rebase folding the fixups in would flatten, and after `ABSORB_LIMIT` commits.
 */
async function loadCandidates(git: SimpleGit, branch: string, head: string) {
  // `--verify --quiet` prints nothing when there is no upstream, or it is gone.
  const upstream = (
    await git
      .raw(["rev-parse", "--verify", "--quiet", "--symbolic-full-name", "@{upstream}"])
      .catch(() => "")
  ).trim();
  let excluded = [upstream];
  if (upstream === "") {
    const configured = (await git.raw(["config", "--get", "init.defaultBranch"]).catch(() => ""))
      .trim()
      .split("\n")[0]!;
    const names = [...new Set([configured, "main", "master"])].filter(
      (name) => name !== "" && name !== branch
    );
    const local = (
      await git.raw(["for-each-ref", "--format=%(refname)", ...names.map((n) => `refs/heads/${n}`)])
    )
      .split("\n")
      .filter(Boolean);
    excluded = ["--remotes", ...local];
  }
  const fields = (
    await git.raw([
      "log",
      "--first-parent",
      "-z",
      `--max-count=${ABSORB_LIMIT}`,
      "--format=%H%x00%P%x00%B",
      head,
      "--not",
      ...excluded,
      "--"
    ])
  ).split("\0");
  const commits: Candidate[] = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const parents = fields[index + 1]!.split(" ").filter(Boolean);
    if (parents.length > 1) {
      break;
    }
    const hash = fields[index]!;
    // The first line, as autosquash matches it. A blank one would make a `fixup! ` that matches
    // nothing; autosquash also matches by ID.
    const subject = fields[index + 2]!.split("\n")[0]!;
    commits.push({ hash, parent: parents[0] ?? null, subject: subject.trim() ? subject : hash });
  }
  return commits;
}

/** The staged files, renames included, with their modes and blobs. */
async function loadEntries(git: SimpleGit): Promise<{ raw: string; entries: StagedEntry[] }> {
  const raw = await git.raw([
    "diff",
    "--cached",
    "--raw",
    "-z",
    "-M",
    "--no-abbrev",
    "--no-relative",
    "--ignore-submodules=none",
    "--"
  ]);
  const fields = raw.split("\0");
  const entries: StagedEntry[] = [];
  for (let index = 0; index < fields.length - 1;) {
    const [srcMode, dstMode, srcBlob, dstBlob, status] = fields[index]!.slice(1).split(" ");
    const kind = status![0]!;
    const from = fields[index + 1]!;
    const to = kind === "R" || kind === "C" ? fields[index + 2]! : from;
    index += kind === "R" || kind === "C" ? 3 : 2;
    entries.push({
      status: kind,
      srcMode: srcMode!,
      dstMode: dstMode!,
      srcBlob: srcBlob!,
      dstBlob: dstBlob!,
      from,
      path: to
    });
  }
  return { raw, entries };
}

/** Why a file stays staged whole, or null for a text file changed in place. */
function wholeReason(entry: StagedEntry): AbsorbReason | null {
  switch (entry.status) {
    case "A":
      return "added";
    case "D":
      return "deleted";
    case "R":
    case "C":
      return "renamed";
    case "M":
      return entry.srcMode === entry.dstMode && REGULAR_FILE.has(entry.dstMode) ? null : "special";
    default:
      return "special";
  }
}

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

/**
 * The file's staged patch without context, so that changes on neighbouring lines stay separate
 * hunks, or null for a binary one. The options keep the user's diff settings out of its form.
 */
async function loadPatch(git: SimpleGit, path: string) {
  const patch = await readGitBytes(git, [
    "diff",
    "--cached",
    "--patch",
    "-U0",
    "--inter-hunk-context=0",
    "--no-renames",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--no-relative",
    "--src-prefix=a/",
    "--dst-prefix=b/",
    "--",
    literalPath(path)
  ]);
  const header: Buffer[] = [];
  const hunks: StagedHunk[] = [];
  for (const line of splitLines(patch)) {
    const match = line[0] === 0x40 ? HUNK_HEADER.exec(line.toString("latin1")) : null;
    if (match) {
      hunks.push({
        path,
        oldStart: Number(match[1]),
        oldLines: match[2] === undefined ? 1 : Number(match[2]),
        newStart: Number(match[3]),
        newLines: match[4] === undefined ? 1 : Number(match[4]),
        body: [],
        target: null
      });
    } else if (hunks.length > 0) {
      hunks.at(-1)!.body.push(line);
    } else if (/^(Binary files |GIT binary patch)/.test(line.toString("latin1"))) {
      return { patch, file: null };
    } else {
      header.push(line);
    }
  }
  return { patch, file: { path, header, hunks } };
}

/** The lines of HEAD's version that tell whose a hunk is: its own, or for added lines, those around it. */
function blamedLines(hunk: AbsorbHunk, lineCount: number) {
  if (hunk.oldLines > 0) {
    return Array.from({ length: hunk.oldLines }, (_, i) => hunk.oldStart + i);
  }
  return [hunk.oldStart, hunk.oldStart + 1].filter((line) => line >= 1 && line <= lineCount);
}

/**
 * The commit that last changed each of `lines` of HEAD's `path`. Blame stops at `boundary`, so
 * older lines name it or another commit outside the branch's own, which is all they need to say.
 */
async function blame(
  git: SimpleGit,
  path: string,
  lines: number[],
  head: string,
  boundary: string | null
) {
  const sorted = [...new Set(lines)].toSorted((a, b) => a - b);
  const ranges: Array<[number, number]> = [];
  for (const line of sorted) {
    const last = ranges.at(-1);
    if (last !== undefined && last[1] + 1 === line) {
      last[1] = line;
    } else {
      ranges.push([line, line]);
    }
  }
  const owners = new Map<number, string>();
  if (ranges.length === 0) {
    return owners;
  }
  const output = await git.raw([
    "blame",
    "--porcelain",
    // An empty name clears any configured list of commits to skip: every commit counts here.
    "--ignore-revs-file=",
    ...ranges.flatMap(([from, to]) => ["-L", `${from},${to}`]),
    boundary === null ? head : `${boundary}..${head}`,
    "--",
    path
  ]);
  for (const line of output.split("\n")) {
    const match = BLAME_LINE.exec(line);
    if (match) {
      owners.set(Number(match[2]), match[1]!);
    }
  }
  return owners;
}

/** Whose a hunk is, from the commits that last changed its lines. */
function classify(owners: string[], candidates: Map<string, Candidate>) {
  const distinct = [...new Set(owners)];
  if (distinct.length === 0) {
    return { reason: "noContext" as const };
  }
  if (distinct.length === 1 && candidates.has(distinct[0]!)) {
    return { target: distinct[0]! };
  }
  return {
    reason: distinct.some((hash) => candidates.has(hash))
      ? ("several" as const)
      : ("outside" as const)
  };
}

/**
 * Split the staged changes into hunks and find, for each, the one commit of the branch's own
 * that last changed its lines, as `git blame` tells. Reads only: nothing on disk changes.
 */
export async function analyzeAbsorb(git: SimpleGit): Promise<AbsorbAnalysis> {
  // `symbolic-ref --quiet` prints nothing for a detached HEAD.
  const branch = (
    await git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => "")
  ).trim();
  if (branch === "") {
    throw new Error(l10n.t("Check out a branch to absorb staged changes into its commits."));
  }
  const head = await resolveCommit(git, "HEAD").catch(() => null);
  if (head === null) {
    throw new Error(l10n.t("The branch has no commits to absorb staged changes into yet."));
  }
  const [{ raw, entries }, commits, status] = await Promise.all([
    loadEntries(git),
    loadCandidates(git, branch, head),
    git.status()
  ]);
  if (entries.length === 0) {
    throw new Error(l10n.t("Stage the changes to absorb first."));
  }
  if (entries.some((entry) => entry.status === "U")) {
    throw new Error(l10n.t("Resolve the conflicts in the staged files first."));
  }
  const candidates = new Map(commits.map((commit) => [commit.hash, commit]));
  const boundary = commits.at(-1)?.parent ?? null;
  const digest = createHash("sha256").update(raw);
  const files: StagedFile[] = [];
  const whole: StagedEntry[] = [];
  const left: AbsorbPlan["left"] = [];
  const hunks: StagedHunk[] = [];
  for (const entry of entries) {
    const reason = wholeReason(entry);
    // One file at a time: a large staging area would otherwise start a process per file at once.
    // eslint-disable-next-line no-await-in-loop
    const loaded = reason === null ? await loadPatch(git, entry.path) : null;
    if (loaded !== null) {
      digest.update(loaded.patch);
    }
    if (loaded === null || loaded.file === null) {
      whole.push(entry);
      left.push({ path: entry.path, hunk: null, reason: reason ?? "binary" });
      continue;
    }
    const file = loaded.file;
    files.push(file);
    const needsLength = file.hunks.some((hunk) => hunk.oldLines === 0);
    // eslint-disable-next-line no-await-in-loop
    const lineCount = needsLength ? countLines(await readBlob(git, entry.srcBlob)) : 0;
    const wanted = new Map(file.hunks.map((hunk) => [hunk, blamedLines(hunk, lineCount)]));
    const owners =
      candidates.size === 0
        ? new Map<number, string>()
        : // eslint-disable-next-line no-await-in-loop
          await blame(git, entry.path, [...wanted.values()].flat(), head, boundary);
    for (const hunk of file.hunks) {
      // Without candidates nothing is blamed, and every line belongs to none of them.
      const verdict = classify(
        wanted.get(hunk)!.map((line) => owners.get(line) ?? ""),
        candidates
      );
      if ("target" in verdict) {
        hunk.target = verdict.target;
        hunks.push(hunk);
      } else {
        left.push({ path: file.path, hunk: publicHunk(hunk), reason: verdict.reason });
      }
    }
  }
  // Oldest first, the order the rebase meets them in, so each fixup's parent already has the
  // fixups that land before it.
  const targets = commits
    .toReversed()
    .map((commit) => ({
      hash: commit.hash,
      subject: commit.subject,
      hunks: hunks.filter((hunk) => hunk.target === commit.hash).map(publicHunk)
    }))
    .filter((target) => target.hunks.length > 0);
  const oldest = targets[0] === undefined ? undefined : candidates.get(targets[0].hash);
  return {
    plan: {
      branch,
      head,
      staged: digest.digest("hex"),
      targets,
      left,
      base: oldest?.parent ?? null,
      // Anything in the work tree column, an untracked file included, would stop the rebase.
      clean: left.length === 0 && status.files.every((file) => file.working_dir === " ")
    },
    files,
    whole
  };
}

/** How many lines `content` has; a last line without a newline counts. */
function countLines(content: Buffer) {
  let count = 0;
  for (let at = content.indexOf(10); at !== -1; at = content.indexOf(10, at + 1)) {
    count++;
  }
  return content.length > 0 && content.at(-1) !== 10 ? count + 1 : count;
}

function publicHunk({ path, oldStart, oldLines, newStart, newLines }: AbsorbHunk): AbsorbHunk {
  return { path, oldStart, oldLines, newStart, newLines };
}

/** Which staged hunks would go into which commit, and which would stay staged. Reads only. */
export async function loadAbsorbPlan(git: SimpleGit): Promise<AbsorbPlan> {
  return (await analyzeAbsorb(git)).plan;
}
