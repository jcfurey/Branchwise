/** How hard `git reset` moves the branch: `--soft`, `--mixed` or `--hard`. */
export type GitResetMode = "soft" | "mixed" | "hard";

/**
 * Values of the `branchwise.dateType` setting. Producers read the author time for exactly
 * `"Author Date"` and the committer time for anything else.
 */
export type DateType = "Author Date" | "Commit Date";

/**
 * How a path changed in a commit. Git's type changes are folded into `"M"`, and copies are
 * never detected, so no other letter appears.
 */
export type GitFileChangeType = "A" | "M" | "D" | "R";

/**
 * A branch, tag or remote-tracking label on a commit. `"head"` means a local branch, not HEAD.
 * `name` drops the namespace (`main`, `v1.0`, `origin/main`), and `hash` is the full ID of the
 * commit the ref resolves to, with annotated tags peeled.
 */
export type GitRef = { hash: string; name: string; type: "head" | "tag" | "remote" };

/** One commit as the graph's log reports it. */
export type GitLogEntry = {
  /** Full lowercase object ID. */
  hash: string;
  /** First parent first; empty for a root or shallow-boundary commit. */
  parentHashes: string[];
  author: string;
  email: string;
  /**
   * Unix seconds, from the author or committer time as `DateType` chooses. `NaN` when Git gave
   * no usable timestamp, which reaches the webview as `null`.
   */
  date: number;
  /** The subject line only. */
  message: string;
};

/**
 * A row of the graph: a log entry and the labels pointing at it. A row with `hash` `"*"` stands
 * for the uncommitted changes.
 */
export type GitCommitNode = GitLogEntry & { refs: GitRef[] };

/** One changed path, compared with the commit's first parent or the empty tree. */
export type GitFileChange = {
  /** The source of a rename; otherwise the same as `newFilePath`, even for an added file. */
  oldFilePath: string;
  newFilePath: string;
  type: GitFileChangeType;
  /** Line counts, or `null` for a binary file or when no count matched the path. */
  additions: number | null;
  deletions: number | null;
};

/** What the details panel shows for one commit. */
export type GitCommitDetails = {
  /** The resolved commit's full ID, which may be spelt differently from the request. */
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: number;
  /** The committer's name alone. */
  committer: string;
  /** The whole message with line endings made `\n` and trailing newlines removed. */
  body: string;
  fileChanges: GitFileChange[];
};
