import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import type { HistoryFilter } from "@/backend/types";
import { literalPath, repoFile } from "@/backend/utils/history";
import { readGitWithInput } from "@/backend/utils/runGit";
import { resolveCommit } from "@/backend/utils/validation";

/** The most commits a line history lists, however far back the lines go. */
export const LINE_HISTORY_LIMIT = 200;

/** Lines of a file, counted from 1, both ends included. */
export type LineSpan = { start: number; end: number };

/** Where a line came from, as far as Git can tell. */
export type LineOrigin =
  /** The commit that last changed the line. */
  | { kind: "commit"; hash: string }
  /** The line, or the whole file, has changes that are not committed yet. */
  | { kind: "uncommitted" }
  /** Git does not track the file, so none of its lines has a commit. */
  | { kind: "untracked" };

/** The ID blame gives a line that no commit holds yet, in SHA-1 and SHA-256 repositories alike. */
const NOT_COMMITTED = /^0+$/;

function lineNumber(value: number) {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(l10n.t("Choose a line of the file."));
  }
  return value;
}

/**
 * The commit that last changed line `line` of `file`, a path from the top level. Without a
 * `revision` the line is counted in the work tree's file, or in `contents` when given: an
 * editor's unsaved text stands in for the file, so the numbers match what the user sees. Blame
 * reads `contents` from its standard input, which Git has supported since long before 2.0.
 */
export async function lineOrigin(
  git: SimpleGit,
  file: string,
  line: number,
  options: { revision?: string; contents?: Uint8Array } = {}
): Promise<LineOrigin> {
  const path = repoFile(file);
  const range = `-L${lineNumber(line)},${line}`;
  let output: string;
  if (options.revision !== undefined) {
    const revision = await resolveCommit(git, options.revision);
    const present = await git.raw(["ls-tree", "-z", revision, "--", literalPath(path)]);
    if (present === "") {
      throw new Error(l10n.t("This revision does not contain that file."));
    }
    output = await git.raw(["blame", "--porcelain", range, revision, "--", path]);
  } else {
    // Blame calls a file that is neither in HEAD nor in the index a missing path, as it does a
    // misspelt one; asking the index first tells the two apart.
    if ((await git.raw(["ls-files", "-z", "--", literalPath(path)])) === "") {
      return { kind: "untracked" };
    }
    const args = ["blame", "--porcelain", range];
    output =
      options.contents === undefined
        ? await git.raw([...args, "--", path])
        : await readGitWithInput(git, [...args, "--contents", "-", "--", path], options.contents);
  }
  const hash = /^([0-9a-f]{40}|[0-9a-f]{64}) /.exec(output)?.[1];
  if (hash === undefined) {
    throw new Error(l10n.t("Git returned an unexpected blame record."));
  }
  return NOT_COMMITTED.test(hash) ? { kind: "uncommitted" } : { kind: "commit", hash };
}

/**
 * What a line history of `file` would follow: nothing when Git does not track the file
 * (`untracked`) or `revision`, HEAD by default, lacks it (`uncommitted`). Without a revision, the
 * file is `changed` when the index or the work tree holds changes to it that HEAD does not, so
 * that its lines may be numbered differently there. Otherwise it is `committed`.
 */
export async function lineFileState(
  git: SimpleGit,
  file: string,
  revision?: string
): Promise<"untracked" | "uncommitted" | "changed" | "committed"> {
  const path = literalPath(file);
  if (revision === undefined && (await git.raw(["ls-files", "-z", "--", path])) === "") {
    return "untracked";
  }
  const commit = await resolveCommit(git, revision ?? "HEAD").catch(() => null);
  if (commit === null || (await git.raw(["ls-tree", "-z", commit, "--", path])) === "") {
    return "uncommitted";
  }
  if (revision !== undefined) {
    return "committed";
  }
  const changed = await git.raw(["diff", "--no-ext-diff", "--name-only", "-z", commit, "--", path]);
  return changed === "" ? "committed" : "changed";
}

/**
 * The lines a filter's line history follows, written as `HistoryFilter` holds them, or null for
 * a filter without them. Lines belong to a file, so a filter that names lines names its path.
 */
export function lineSpan({ lines = "", path }: Pick<HistoryFilter, "lines" | "path">) {
  if (lines === "") {
    return null;
  }
  const match = /^(\d{1,9}),(\d{1,9})$/.exec(lines);
  const start = Number(match?.[1]);
  const end = Number(match?.[2]);
  if (!match || start < 1 || end < start || !path) {
    throw new Error(l10n.t("Choose a range of lines in a file."));
  }
  return { start, end } satisfies LineSpan;
}

/**
 * The option that has `git log` follow `span` of `file` back through its history. Attached to
 * `-L`, a path that starts with `-` cannot be read as an option. Git follows the lines across
 * renames on its own, and allows no pathspec beside it.
 */
export function lineLogOption(span: LineSpan, file: string) {
  return `-L${span.start},${span.end}:${repoFile(file)}`;
}

/**
 * Only the commit records of `git log -z` output written with a format that ends in `%x00`. A
 * Git that ignores `--no-patch` beside `-L` puts each commit's patch after its record; patches
 * hold no NUL, so each is one field that starts with a line break, never the record's marker.
 */
export function lineLogRecords(output: string, marker: string, fields: number) {
  const values = output.split("\0");
  const kept: string[] = [];
  for (let index = 0; index < values.length; index++) {
    if (values[index]!.replace(/^\n+/, "") === marker) {
      kept.push(marker, ...values.slice(index + 1, index + 1 + fields));
      index += fields;
    }
  }
  return kept.join("\0");
}

/**
 * The patch with which commit `hash` changed `span` of `file`, the lines counted at `revision`
 * (HEAD when empty). The lines move as history goes back, so Git follows them from `revision`
 * down to the commit; the walk stops at the commit's parents, so it reads no further than the
 * line history that listed the commit.
 */
export async function lineChanges(
  git: SimpleGit,
  hash: string,
  file: string,
  span: LineSpan,
  revision = ""
): Promise<string> {
  const [commit, tip] = await Promise.all([
    resolveCommit(git, hash),
    resolveCommit(git, revision || "HEAD")
  ]);
  const output = await git.raw([
    "log",
    "--format=%x00%H%x00commit %H%nAuthor: %an <%ae>%nDate:   %aI%n%n    %s%n",
    "--no-ext-diff",
    lineLogOption(span, file),
    tip,
    "--not",
    `${commit}^@`,
    "--"
  ]);
  const values = output.split("\0");
  for (let index = 1; index + 1 < values.length; index += 2) {
    if (values[index] === commit) {
      return values[index + 1]!.replace(/\n+$/, "\n");
    }
  }
  throw new Error(l10n.t("This commit did not change those lines."));
}
