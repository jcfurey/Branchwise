import type { SimpleGit } from "simple-git";

import type {
  DateType,
  GitCommitDetails,
  GitFileChange,
  GitFileChangeType,
  QueryResult
} from "@/backend/types";

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * Notations that name a set of commits: `a..b`, `a...b`, `^a`, `a^@`, `a^!` and `a^-`. `show`
 * accepts them and prints the newest commit, but the details describe one named commit.
 */
const RANGE = /\.\.|^\^|\^[@!-]/;

/** The kinds `diff-tree` reports, by status letter. A type change counts as a modification. */
const CHANGE_TYPES = new Map<string, GitFileChangeType>([
  ["A", "A"],
  ["M", "M"],
  ["D", "D"],
  ["T", "M"],
  ["R", "R"]
]);

type LineCounts = Pick<GitFileChange, "additions" | "deletions">;

function showArgs(commitHash: string, dateType: DateType) {
  const date = dateType === "Author Date" ? "%at" : "%ct";
  return [
    "show",
    "--quiet",
    // Names and message in UTF-8, whatever `i18n.logOutputEncoding` says.
    "--encoding=UTF-8",
    `--format=%H%x00%P%x00%an%x00%ae%x00${date}%x00%cn%x00%B`,
    "--end-of-options",
    commitHash,
    // Without it, the name of a file the commit changed would be read as a path filter.
    "--"
  ];
}

/**
 * The commit's changes against its first parent only, so a merge lists what it brought into its
 * branch, and nothing when that is nothing. A commit without parents is compared with the empty
 * tree. Plumbing ignores `diff.renames`, so renames are found here and copies never are.
 */
function diffTreeArgs(format: "--name-status" | "--numstat", hash: string, firstParent?: string) {
  return [
    "diff-tree",
    format,
    "-z",
    "-r",
    "--no-commit-id",
    "--find-renames",
    "--diff-filter=AMDRT",
    ...(firstParent === undefined ? ["--root", hash] : [firstParent, hash])
  ];
}

/**
 * Every line ending becomes LF, and the empty lines at the end go, with the newline Git adds
 * after `%B`. Lines of spaces or tabs stay.
 */
function messageBody(message: string) {
  const body = message.replace(/\r\n?/g, "\n");
  let end = body.length;
  while (end > 0 && body[end - 1] === "\n") {
    end--;
  }
  return body.slice(0, end);
}

function parseHeader(output: string): Omit<GitCommitDetails, "fileChanges"> {
  // `%B` holds no NUL, so one commit gives exactly seven fields. An annotated tag's header, printed
  // before its commit, fails the ID check.
  const fields = output.split("\0");
  const [
    hash = "",
    parentList = "",
    author = "",
    email = "",
    date = "",
    committer = "",
    message = ""
  ] = fields;
  const parents = parentList === "" ? [] : parentList.split(" ");
  if (
    fields.length !== 7 ||
    !OBJECT_ID.test(hash) ||
    !parents.every((parent) => OBJECT_ID.test(parent)) ||
    !/^\d+$/.test(date)
  ) {
    throw new Error("Unexpected commit header");
  }
  return {
    hash,
    parents,
    author,
    email,
    date: Number(date),
    committer,
    body: messageBody(message)
  };
}

/** The fields of `-z` output, each of which Git ends with a NUL. */
function nulFields(output: string) {
  const fields = output.split("\0");
  if (fields.pop() !== "") {
    throw new Error("Unterminated diff-tree output");
  }
  return fields;
}

/**
 * Line counts by the path each entry has after the commit. Only names whose invalid UTF-8
 * decodes alike can share a path, and those then share the last entry's counts.
 */
function parseNumstat(output: string) {
  const fields = nulFields(output);
  const counts = new Map<string, LineCounts>();
  for (let index = 0; index < fields.length;) {
    const match = /^(\d+|-)\t(\d+|-)\t(.*)$/s.exec(fields[index++]!);
    let path = match?.[3];
    if (path === "") {
      // A rename leaves the path out. Its source and destination follow as two fields.
      path = fields[index + 1];
      index += 2;
    }
    if (!match || !path) {
      throw new Error("Unexpected diff-tree line counts");
    }
    // Git prints `-` for both counts of content it treats as binary.
    const binary = match[1] === "-" || match[2] === "-";
    counts.set(path, {
      additions: binary ? null : Number(match[1]),
      deletions: binary ? null : Number(match[2])
    });
  }
  return counts;
}

/** The entries of `--name-status`, each with the line counts `--numstat` gives for its path. */
function parseFileChanges(output: string, counts: Map<string, LineCounts>) {
  const fields = nulFields(output);
  const changes: GitFileChange[] = [];
  for (let index = 0; index < fields.length;) {
    // A rename carries its similarity, as in `R064`, and names the source and the destination.
    const type = CHANGE_TYPES.get(/^([AMDRT])\d*$/.exec(fields[index++]!)?.[1] ?? "");
    const oldFilePath = fields[index++];
    const newFilePath = type === "R" ? fields[index++] : oldFilePath;
    if (type === undefined || oldFilePath === undefined || newFilePath === undefined) {
      throw new Error("Unexpected diff-tree status");
    }
    const { additions, deletions } = counts.get(newFilePath) ?? {
      additions: null,
      deletions: null
    };
    changes.push({ oldFilePath, newFilePath, type, additions, deletions });
  }
  return changes;
}

export async function commitDetails(
  git: SimpleGit,
  input: { commitHash: string; dateType: DateType }
): Promise<QueryResult<"commitDetails">> {
  try {
    if (RANGE.test(input.commitHash)) {
      return { commitDetails: null };
    }
    const header = parseHeader(await git.raw(showArgs(input.commitHash, input.dateType)));
    // The diff needs the first parent from the header. Both listings describe that one diff, so
    // they run side by side.
    const [nameStatus, numstat] = await Promise.all([
      git.raw(diffTreeArgs("--name-status", header.hash, header.parents[0])),
      git.raw(diffTreeArgs("--numstat", header.hash, header.parents[0]))
    ]);
    const fileChanges = parseFileChanges(nameStatus, parseNumstat(numstat));
    return { commitDetails: { ...header, fileChanges } };
  } catch {
    // Git failed, the request was cancelled, or the revision does not name one commit.
    return { commitDetails: null };
  }
}
