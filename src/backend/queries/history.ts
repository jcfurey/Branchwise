import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { loadStatistics } from "@/backend/queries/statistics";
import type {
  BatchPlan,
  Comparison,
  FileRestorePlan,
  HistoryFilter,
  HistoryPage,
  HistoryQuery,
  HistoryQueryData,
  ReflogEntry,
  StagedPlan
} from "@/backend/types";
import {
  differsFromIndex,
  fileSnapshot,
  HISTORY_FORMAT,
  HISTORY_PAGE_SIZE,
  historyPage,
  literalPath,
  pageOffset,
  parseHistory,
  repoFile
} from "@/backend/utils/history";
import { remoteVisibility, type RemoteVisibility } from "@/backend/utils/remoteVisibility";
import { readGitWithInput } from "@/backend/utils/runGit";
import { resolveCommit } from "@/backend/utils/validation";

const logArgs = (offset: number) => [
  "log",
  "-z",
  "--format=" + HISTORY_FORMAT,
  "--date-order",
  "--max-count=" + (HISTORY_PAGE_SIZE + 1),
  "--skip=" + pageOffset(offset)
];

/** How many matching branch and tag names a search lists above its results. */
const REF_SUGGESTIONS = 20;

/** A branch, remote branch or tag, by full name, with the commit it points to. */
type RefTip = { ref: string; name: string; tag: boolean; commit: string };

/**
 * Every visible branch, remote branch and tag that points to a commit, directly or through
 * annotated tags. Branches follow the graph's remote visibility and hidden-branch patterns.
 */
async function refTips(git: SimpleGit, visibility: RemoteVisibility): Promise<RefTip[]> {
  const [output, { excluded, hiddenBranches }] = await Promise.all([
    git.raw([
      "for-each-ref",
      "--format=%(refname)%00%(objecttype)%00%(objectname)%00%(*objecttype)%00%(*objectname)",
      "refs/heads/",
      "refs/tags/",
      "refs/remotes/"
    ]),
    remoteVisibility(git, visibility)
  ]);
  const tips: RefTip[] = [];
  for (const line of output.split("\n")) {
    const [ref, type, object, peeledType, peeled] = line.split("\0");
    if (!ref) {
      continue;
    }
    const commit = type === "commit" ? object : peeledType === "commit" ? peeled : undefined;
    if (commit === undefined) {
      continue;
    }
    const kind = /^refs\/(heads|tags|remotes)\//.exec(ref)?.[1];
    const name = ref.slice(`refs/${kind}/`.length);
    if (
      kind === "remotes" &&
      (visibility.showRemoteBranches === false || excluded.has(name) || name.endsWith("/HEAD"))
    ) {
      continue;
    }
    if (kind === "heads" && hiddenBranches.has(name)) {
      continue;
    }
    tips.push({ ref, name, tag: kind === "tags", commit: commit! });
  }
  return tips;
}

/** Whether a branch or tag name matches a search field: literal text, or a regular expression. */
function nameMatcher(pattern: string, regex: boolean): (name: string) => boolean {
  if (!regex) {
    const needle = pattern.toLowerCase();
    return (name) => name.toLowerCase().includes(needle);
  }
  let expression: RegExp;
  try {
    expression = new RegExp(pattern, "i");
  } catch {
    throw new Error(l10n.t("'{0}' is not a valid regular expression.", pattern));
  }
  return (name) => expression.test(name);
}

export async function loadHistory(
  git: SimpleGit,
  filter: HistoryFilter,
  offset: number,
  visibility: RemoteVisibility = {}
): Promise<HistoryPage> {
  const args = logArgs(offset);
  for (const [name, value] of [
    ["since", filter.since],
    ["until", filter.until]
  ] as const) {
    if (
      value &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        Number.isNaN(Date.parse(value)) ||
        new Date(value).toISOString().slice(0, 10) !== value)
    ) {
      throw new Error(l10n.t("Enter dates as YYYY-MM-DD."));
    }
    if (value) {
      args.push("--" + name + "=" + value + (name === "until" ? "T23:59:59" : "T00:00:00"));
    }
  }
  if (filter.since && filter.until && filter.since > filter.until) {
    throw new Error(l10n.t("The start date must come before the end date."));
  }
  const regex = filter.regex === true;
  args.push(regex ? "--extended-regexp" : "--fixed-strings", "--regexp-ignore-case");
  if (filter.author) {
    args.push("--author=" + filter.author);
  }
  if (filter.committer) {
    args.push("--committer=" + filter.committer);
  }
  const text = filter.text.trim();
  const hashSearch = /^[a-f0-9]{7,64}$/i.test(text)
    ? await resolveCommit(git, text).catch(() => null)
    : null;
  if (filter.text && !hashSearch) {
    args.push("--grep=" + filter.text);
  }
  if (filter.path && filter.follow) {
    args.push("--follow", "--name-status", "--diff-merges=first-parent");
  }

  // Branch and tag names: the commits they point to, and names to offer beside the results.
  const byName = !hashSearch && Boolean(filter.branch || filter.tag);
  const suggest = !hashSearch && text !== "" && offset === 0;
  const tips = byName || suggest ? await refTips(git, visibility) : [];
  let refs: string[] | undefined;
  if (suggest) {
    const matches = nameMatcher(text, regex);
    refs = tips
      .filter((tip) => matches(tip.name))
      .slice(0, REF_SUGGESTIONS)
      .map((tip) => tip.ref);
  }
  let commits: string[] | undefined;
  if (byName) {
    const branch = filter.branch ? nameMatcher(filter.branch, regex) : null;
    const tag = filter.tag ? nameMatcher(filter.tag, regex) : null;
    commits = [
      ...new Set(
        tips.filter((tip) => (tip.tag ? tag : branch)?.(tip.name) === true).map((tip) => tip.commit)
      )
    ];
    if (commits.length === 0) {
      return { entries: [], more: false, ...(refs ? { refs } : {}) };
    }
  }

  if (hashSearch) {
    args.push("--max-count=1", hashSearch);
  } else if (commits) {
    // Only the commits the names point to, newest first; any number of them fits on stdin.
    args.push("--no-walk=sorted", "--stdin");
  } else if (filter.revision) {
    args.push(await resolveCommit(git, filter.revision));
  } else {
    const { branchArgs, logArgs: refArgs } = await remoteVisibility(git, visibility);
    args.push(...branchArgs, "--tags", ...refArgs);
    const head = await git.raw(["rev-parse", "--verify", "--quiet", "HEAD"]);
    if (head.trim()) {
      args.push(head.trim());
    }
  }
  args.push("--");
  if (filter.path) {
    args.push(literalPath(filter.path));
  }
  const output = commits
    ? await readGitWithInput(git, args, commits.join("\n") + "\n")
    : await git.raw(args);
  return { ...historyPage(parseHistory(output)), ...(refs ? { refs } : {}) };
}

export async function compareCommits(
  git: SimpleGit,
  left: string,
  right: string,
  side: "left" | "right",
  offset: number
) {
  const [a, b] = await Promise.all([resolveCommit(git, left), resolveCommit(git, right)]);
  return historyPage(
    parseHistory(
      await git.raw([...logArgs(offset), side === "left" ? b + ".." + a : a + ".." + b, "--"])
    )
  );
}

export async function loadComparison(
  git: SimpleGit,
  left: string,
  right: string,
  mergeBase: boolean
): Promise<Comparison> {
  const [a, b] = await Promise.all([resolveCommit(git, left), resolveCommit(git, right)]);
  const base = mergeBase ? (await git.raw(["merge-base", a, b])).trim() : a;
  if (!base) {
    throw new Error(l10n.t("These revisions do not have a common ancestor."));
  }
  const [changes, leftOnly, rightOnly] = await Promise.all([
    git.raw([
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--name-status",
      "-z",
      "--find-renames",
      base,
      b,
      "--"
    ]),
    compareCommits(git, a, b, "left", 0),
    compareCommits(git, a, b, "right", 0)
  ]);
  const fields = changes.split("\0");
  const files: Comparison["files"] = [];
  for (let index = 0; index < fields.length && fields[index];) {
    const status = fields[index++]!;
    const before = fields[index++]!;
    const after = /^[RC]/.test(status) ? fields[index++]! : before;
    files.push({ status, before, after });
  }
  return { left: a, right: b, base, files, leftOnly, rightOnly };
}

/** The most reflog entries a view reads, so that filtering stays quick however long it is. */
export const REFLOG_LIMIT = 10_000;

/**
 * The operation a reflog message records, and its variant: `commit (amend): fix` is `commit` and
 * `amend`, `pull --rebase (finish): …` is `pull` and `finish`, `merge topic: Fast-forward` is
 * `merge`. A message in no such form, such as `update by push`, is `other`.
 */
export function reflogAction(message: string): { action: string; detail: string } {
  const match = /^([a-z][a-z-]*)(?: [^:(]*)?(?: \(([^)]*)\))?:/.exec(message);
  return { action: match?.[1] ?? "other", detail: match?.[2] ?? "" };
}

/** HEAD and the local branches: the refs whose reflog can be shown on its own. */
async function reflogRefs(git: SimpleGit) {
  const branches = await git.raw(["for-each-ref", "--format=%(refname)", "refs/heads/"]);
  return ["HEAD", ...branches.split("\n").filter(Boolean)];
}

/**
 * The commits among `hashes` that no branch, tag, remote branch or HEAD reaches: work that only
 * the reflog still remembers.
 */
async function unreachableCommits(git: SimpleGit, hashes: string[]) {
  if (hashes.length === 0) {
    return new Set<string>();
  }
  const head = (await git.raw(["rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => "")).trim();
  const output = await readGitWithInput(
    git,
    ["rev-list", "--stdin", "--not", "--branches", "--tags", "--remotes", ...(head ? [head] : [])],
    [...new Set(hashes)].join("\n") + "\n"
  ).catch(() => "");
  return new Set(output.split("\n").filter(Boolean));
}

/**
 * One page of a reflog: every ref's by default, or HEAD's or one branch's, newest first, narrowed
 * to one operation, to entries whose message, commit subject or ID holds `text`, and with
 * `lostOnly` to commits that only the reflog still reaches. Each entry says whether it is one.
 */
export async function loadReflog(
  git: SimpleGit,
  query: { offset: number; ref?: string; action?: string; text?: string; lostOnly?: boolean }
): Promise<{ entries: ReflogEntry[]; more: boolean; refs: string[]; actions: string[] }> {
  const offset = pageOffset(query.offset);
  const refs = await reflogRefs(git);
  const ref = query.ref ?? "";
  if (ref !== "" && !refs.includes(ref)) {
    throw new Error(l10n.t("{0} has no reflog. Choose HEAD or a local branch.", ref));
  }
  const fields = (
    await git
      .raw([
        "log",
        "-g",
        "-z",
        "--date=unix",
        "--format=%H%x00%gD%x00%gs%x00%s",
        "--max-count=" + REFLOG_LIMIT,
        ...(ref === "" ? ["--all"] : ["--end-of-options", ref])
      ])
      // A repository without commits has no reflog to walk.
      .catch((error: unknown) => {
        if (/does not have any commits|unknown revision|bad default revision/.test(String(error))) {
          return "";
        }
        throw error;
      })
  ).split("\0");
  const all: ReflogEntry[] = [];
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const selector = fields[index + 1]!;
    const message = fields[index + 2]!;
    all.push({
      hash: fields[index]!,
      selector,
      message,
      subject: fields[index + 3]!,
      date: Number(selector.match(/@\{(\d+)\}$/)?.[1] ?? 0),
      ref: selector.replace(/@\{[^}]*\}$/, ""),
      ...reflogAction(message),
      lost: false
    });
  }
  const actions = [...new Set(all.map((entry) => entry.action))].toSorted();
  const needle = (query.text ?? "").trim().toLowerCase();
  let matching = all.filter(
    (entry) =>
      (!query.action || entry.action === query.action) &&
      (needle === "" ||
        entry.message.toLowerCase().includes(needle) ||
        entry.subject.toLowerCase().includes(needle) ||
        entry.hash.startsWith(needle))
  );
  // Only commits nothing else reaches: one walk over every match, then page those.
  const lostEverywhere = query.lostOnly
    ? await unreachableCommits(
        git,
        matching.map((entry) => entry.hash)
      )
    : null;
  if (lostEverywhere !== null) {
    matching = matching.filter((entry) => lostEverywhere.has(entry.hash));
  }
  const entries = matching.slice(offset, offset + HISTORY_PAGE_SIZE);
  const lost =
    lostEverywhere ??
    (await unreachableCommits(
      git,
      entries.map((entry) => entry.hash)
    ));
  for (const entry of entries) {
    entry.lost = lost.has(entry.hash);
  }
  return {
    entries,
    more: matching.length > offset + HISTORY_PAGE_SIZE,
    refs,
    actions
  };
}

export async function sourceFile(git: SimpleGit, source: string, file: string) {
  const hash = await resolveCommit(git, source);
  const line = await git.raw(["ls-tree", "-z", hash, "--", literalPath(file)]);
  const match = /^(100644|100755|120000) blob ([a-f0-9]{40,64})\t/.exec(line);
  if (!match) {
    throw new Error(l10n.t("This revision does not contain that file."));
  }
  return { hash, mode: match[1]!, blob: match[2]! };
}

export async function loadRestorePlan(
  git: SimpleGit,
  source: string,
  sourcePath: string,
  destination: string
): Promise<FileRestorePlan> {
  const file = await sourceFile(git, source, sourcePath);
  const target = repoFile(destination);
  const [snapshot, status, differs] = await Promise.all([
    fileSnapshot(git, target),
    git.raw([
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignored",
      "-z",
      "--",
      literalPath(target)
    ]),
    differsFromIndex(git, target)
  ]);
  return {
    source: file.hash,
    sourcePath: repoFile(sourcePath),
    destination: target,
    snapshot,
    dirty: status.length > 0 || differs
  };
}

export async function loadStagedPlan(git: SimpleGit, target: string): Promise<StagedPlan> {
  const [head, hash] = await Promise.all([resolveCommit(git, "HEAD"), resolveCommit(git, target)]);
  if ((await git.raw(["merge-base", head, hash])).trim() !== hash) {
    throw new Error(l10n.t("Choose a commit on the current branch to fix up."));
  }
  const files = (await git.raw(["diff", "--cached", "--name-only", "-z", "--"]))
    .split("\0")
    .filter(Boolean);
  if (files.length === 0) {
    throw new Error(l10n.t("Stage the changes to include in the fixup commit first."));
  }
  return { head, target: hash, tree: (await git.raw(["write-tree"])).trim(), files };
}

export async function loadBatchPlan(git: SimpleGit, hashes: string[]): Promise<BatchPlan> {
  if (hashes.length === 0 || hashes.length > 100 || new Set(hashes).size !== hashes.length) {
    throw new Error(l10n.t("Select between 1 and 100 distinct commits."));
  }
  // One process lists every commit in the order given; a missing one fails the whole plan.
  const entries = parseHistory(
    await git.raw([
      "log",
      "--no-walk=unsorted",
      "-z",
      "--format=" + HISTORY_FORMAT,
      "--end-of-options",
      ...hashes.map((hash) => `${hash}^{commit}`),
      "--"
    ])
  );
  if (entries.length !== hashes.length) {
    throw new Error(l10n.t("Select between 1 and 100 distinct commits."));
  }
  return {
    head: await resolveCommit(git, "HEAD"),
    branch: (await git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim(),
    entries
  };
}

export async function historyQuery(
  git: SimpleGit,
  query: Exclude<HistoryQuery, { kind: "workspace" }>
): Promise<HistoryQueryData> {
  switch (query.kind) {
    case "history":
      return { kind: "history", page: await loadHistory(git, query.filter, query.offset, query) };
    case "compare":
      return {
        kind: "compare",
        comparison: await loadComparison(git, query.left, query.right, query.mergeBase)
      };
    case "compareCommits":
      return {
        kind: "compareCommits",
        page: await compareCommits(git, query.left, query.right, query.side, query.offset)
      };
    case "reflog":
      return { kind: "reflog", ...(await loadReflog(git, query)) };
    case "statistics":
      return { kind: "statistics", statistics: await loadStatistics(git, query) };
    case "restorePlan":
      return {
        kind: "restorePlan",
        plan: await loadRestorePlan(git, query.source, query.sourcePath, query.destination)
      };
    case "stagedPlan":
      return { kind: "stagedPlan", plan: await loadStagedPlan(git, query.target) };
    case "batchPlan":
      return { kind: "batchPlan", plan: await loadBatchPlan(git, query.hashes) };
  }
}
