import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

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
import { resolveCommit } from "@/backend/utils/validation";

const logArgs = (offset: number) => [
  "log",
  "-z",
  "--format=" + HISTORY_FORMAT,
  "--date-order",
  "--max-count=" + (HISTORY_PAGE_SIZE + 1),
  "--skip=" + pageOffset(offset)
];

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
  args.push("--fixed-strings", "--regexp-ignore-case");
  if (filter.author) {
    args.push("--author=" + filter.author);
  }
  const hashSearch = /^[a-f0-9]{7,64}$/i.test(filter.text.trim())
    ? await resolveCommit(git, filter.text.trim()).catch(() => null)
    : null;
  if (filter.text && !hashSearch) {
    args.push("--grep=" + filter.text);
  }
  if (filter.path && filter.follow) {
    args.push("--follow", "--name-status", "--diff-merges=first-parent");
  }
  if (hashSearch) {
    args.push("--max-count=1", hashSearch);
  } else if (filter.revision) {
    args.push(await resolveCommit(git, filter.revision));
  } else {
    args.push("--branches", "--tags", ...(await remoteVisibility(git, visibility)).logArgs);
    const head = await git.raw(["rev-parse", "--verify", "--quiet", "HEAD"]);
    if (head.trim()) {
      args.push(head.trim());
    }
  }
  args.push("--");
  if (filter.path) {
    args.push(literalPath(filter.path));
  }
  return historyPage(parseHistory(await git.raw(args)));
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

export async function loadReflog(git: SimpleGit, offset: number) {
  const fields = (
    await git.raw([
      "log",
      "-g",
      "--all",
      "-z",
      "--date=unix",
      "--format=%H%x00%gD%x00%gs",
      "--max-count=" + (HISTORY_PAGE_SIZE + 1),
      "--skip=" + pageOffset(offset)
    ])
  ).split("\0");
  const entries: ReflogEntry[] = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    const selector = fields[index + 1]!;
    entries.push({
      hash: fields[index]!,
      selector,
      message: fields[index + 2]!,
      date: Number(selector.match(/@\{(\d+)\}$/)?.[1] ?? 0)
    });
  }
  return { entries: entries.slice(0, HISTORY_PAGE_SIZE), more: entries.length > HISTORY_PAGE_SIZE };
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
      return { kind: "reflog", ...(await loadReflog(git, query.offset)) };
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
