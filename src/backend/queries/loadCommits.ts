import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import type { DateType, GitCommitNode, GitLogEntry, GitRef, QueryResult } from "@/backend/types";
import { branchListRef } from "@/backend/utils/refs";
import { remoteVisibility } from "@/backend/utils/remoteVisibility";

type LoadCommitsInput = {
  branchName: string;
  maxCommits: number;
  showRemoteBranches: boolean;
  hiddenRemotes?: string[];
  hard: boolean;
  dateType: DateType;
  showUncommittedChanges: boolean;
};

/** Hash, parents, author name, author email, timestamp and subject. */
const FIELDS_PER_COMMIT = 6;

/** A full SHA-1 or SHA-256 object ID, as `%H` and `%P` print them. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

const incompleteRecord = () => new Error(l10n.t("Git returned an incomplete graph record."));

/**
 * Commits from the graph's `git log -z`, which ends every field with NUL. Output that is cut
 * short or out of step throws instead of shifting fields into the wrong commits. Content is
 * taken as Git gives it: a timestamp Git leaves empty, as it does for a malformed author line,
 * becomes `NaN`.
 */
export function parseLog(stdout: string): GitLogEntry[] {
  if (stdout === "") {
    return [];
  }
  if (!stdout.endsWith("\0")) {
    throw incompleteRecord();
  }
  const fields = stdout.slice(0, -1).split("\0");
  if (fields.length % FIELDS_PER_COMMIT !== 0) {
    throw incompleteRecord();
  }
  const entries: GitLogEntry[] = [];
  for (let start = 0; start < fields.length; start += FIELDS_PER_COMMIT) {
    const hash = fields[start]!;
    const parents = fields[start + 1]!;
    const date = fields[start + 4]!;
    const parentHashes = parents === "" ? [] : parents.split(" ");
    if (!OBJECT_ID.test(hash) || !parentHashes.every((parent) => OBJECT_ID.test(parent))) {
      throw incompleteRecord();
    }
    entries.push({
      hash,
      parentHashes,
      author: fields[start + 2]!,
      email: fields[start + 3]!,
      date: /^[0-9]+$/.test(date) ? Number(date) : Number.NaN,
      message: fields[start + 5]!
    });
  }
  return entries;
}

/**
 * HEAD's commit and the labels in `git show-ref -d --head` output. A tag object's own line never
 * matches a commit; the `^{}` line after it names the commit the tag chain ends at, so each tag
 * labels one commit at most. Other namespaces, such as `refs/stash`, give no labels.
 */
function parseRefs(stdout: string, showRemoteBranches: boolean, hidden: ReadonlySet<string>) {
  let head: string | null = null;
  const labels: GitRef[] = [];
  for (const line of stdout.split(/\r\n|\r|\n/)) {
    const space = line.indexOf(" ");
    if (space < 0) {
      continue;
    }
    const hash = line.slice(0, space);
    const ref = line.slice(space + 1);
    if (ref === "HEAD") {
      head = hash;
      continue;
    }
    const full = ref.endsWith("^{}") ? ref.slice(0, -"^{}".length) : ref;
    if (full.startsWith("refs/heads/")) {
      labels.push({ hash, name: full.slice("refs/heads/".length), type: "head" });
    } else if (full.startsWith("refs/tags/")) {
      labels.push({ hash, name: full.slice("refs/tags/".length), type: "tag" });
    } else if (showRemoteBranches && full.startsWith("refs/remotes/")) {
      const name = full.slice("refs/remotes/".length);
      if (!hidden.has(name)) {
        labels.push({ hash, name, type: "remote" });
      }
    }
  }
  return { head, labels };
}

/**
 * Changed entries in the working tree. Status fails without a work tree, as in a bare
 * repository, which has nothing to show; only then is Git asked which case it is, so the usual
 * load keeps to one process. Any other failure is passed on.
 */
async function workingTreeChanges(git: SimpleGit) {
  try {
    return (await git.status(["--untracked-files=all"])).files.length;
  } catch (error) {
    const inWorkTree = await git.raw(["rev-parse", "--is-inside-work-tree"]).then(
      (output) => output.trim() !== "false",
      () => true
    );
    if (inWorkTree) {
      throw error;
    }
    return 0;
  }
}

export async function loadCommits(
  git: SimpleGit,
  input: LoadCommitsInput
): Promise<Omit<QueryResult<"loadCommits">, "repo" | "branchName">> {
  const { branchName, showRemoteBranches, hard } = input;
  // Callers send whole numbers from 1 up. Anything else rounds down, to one commit at least.
  const pageSize = Math.max(1, Math.floor(input.maxCommits) || 1);
  const [refs, visibility] = await Promise.all([
    git.raw(["show-ref", ...(showRemoteBranches ? [] : ["--heads", "--tags"]), "-d", "--head"]),
    // Even with a branch filter, hidden remotes lose their labels.
    remoteVisibility(git, input)
  ]);
  const { head, labels } = parseRefs(refs, showRemoteBranches, visibility.excluded);

  // HEAD is named by its hash, so a detached checkout is included and an unborn one is skipped.
  const revisions = branchName
    ? [branchListRef(branchName)]
    : ["--branches", "--tags", ...visibility.logArgs, ...(head === null ? [] : [head])];
  const timestamp = input.dateType === "Author Date" ? "%at" : "%ct";
  // One commit more than the page tells whether more history exists.
  const entries = parseLog(
    await git.raw([
      "log",
      "-z",
      `--max-count=${pageSize + 1}`,
      `--format=%H%x00%P%x00%an%x00%ae%x00${timestamp}%x00%s`,
      "--date-order",
      ...revisions,
      "--"
    ])
  );

  const commits: GitCommitNode[] = entries
    .slice(0, pageSize)
    .map((entry) => Object.assign(entry, { refs: [] }));
  const byHash = new Map(commits.map((commit) => [commit.hash, commit]));
  for (const label of labels) {
    byHash.get(label.hash)?.refs.push(label);
  }

  // Changes are shown on top of HEAD's commit, so they need that commit on the page.
  let uncommittedChanges = 0;
  if (input.showUncommittedChanges && head !== null && byHash.has(head)) {
    uncommittedChanges = await workingTreeChanges(git);
    if (uncommittedChanges > 0) {
      commits.unshift({
        hash: "*",
        parentHashes: [head],
        author: "*",
        email: "",
        date: Math.floor(Date.now() / 1000),
        message: "",
        refs: []
      });
    }
  }

  return {
    commits,
    head,
    moreCommitsAvailable: entries.length > pageSize,
    hard,
    uncommittedChanges
  };
}
