import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { loadAbsorbPlan } from "@/backend/queries/absorb";
import { loadBisect } from "@/backend/queries/bisect";
import { loadBranchFocus } from "@/backend/queries/branchFocus";
import { loadConflictForecast } from "@/backend/queries/conflictForecast";
import { loadAmendPlan, loadRewordPlan } from "@/backend/queries/editCommit";
import { historyQuery } from "@/backend/queries/history";
import { loadPushStatus } from "@/backend/queries/pushStatus";
import { loadReplayForecast } from "@/backend/queries/replayForecast";
import { loadSafetyNet, loadSafetyUndo } from "@/backend/queries/safetyNet";
import { loadSplitPlan } from "@/backend/queries/splitCommit";
import {
  loadBulkSyncPlan,
  loadSyncPlan,
  loadUpstreamPlan,
  loadCleanupPlan,
  loadFastForwardPlan,
  submoduleComparison
} from "@/backend/queries/workflows";
import { loadWorkingTree } from "@/backend/queries/workingTree";
import { loadWorkspace } from "@/backend/queries/workspace";
import type {
  BranchDetails,
  OperationKind,
  OperationState,
  RebasePlan,
  RefDetails,
  RepositoryQuery,
  RepositoryQueryData,
  RepositoryState,
  StashDetails,
  WorkspaceOperation,
  WorktreeDetails
} from "@/backend/types";
import { autosquashPlan } from "@/backend/utils/autosquash";
import { normalizeRepoPath } from "@/backend/utils/repoPath";
import { requireBranchName, requireRemote, resolveCommit } from "@/backend/utils/validation";

export async function gitDirectory(git: SimpleGit) {
  return (await git.raw(["rev-parse", "--absolute-git-dir"])).replace(/\n$/, "");
}

export async function readOptional(filename: string) {
  try {
    return await readFile(filename, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

/** `directory` is the repository's Git directory, when the caller has it already. */
export async function loadOperation(
  git: SimpleGit,
  directory?: string
): Promise<OperationState | null> {
  directory ??= await gitDirectory(git);
  const files = [
    "rebase-merge/head-name",
    "rebase-apply/head-name",
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "sequencer/todo"
  ];
  const contents = await Promise.all(files.map((file) => readOptional(path.join(directory, file))));
  let kind: OperationKind | undefined;
  if (contents[0] !== null || contents[1] !== null) {
    kind = "rebase";
  } else if (contents[2] !== null) {
    kind = "merge";
  } else if (contents[3] !== null || contents[5]?.startsWith("pick ")) {
    kind = "cherry-pick";
  } else if (contents[4] !== null || contents[5]?.startsWith("revert ")) {
    kind = "revert";
  }
  if (kind === undefined) {
    return null;
  }
  const head = await resolveCommit(git, "HEAD");
  return {
    kind,
    id: createHash("sha256")
      .update(JSON.stringify([kind, head, contents]))
      .digest("hex")
  };
}

/**
 * The operation stopped partway, counting a bisect, which the repository state leaves to its own
 * view since a bisect does not block other work the way a stopped merge does.
 */
export async function loadOperationKind(
  git: SimpleGit,
  directory?: string
): Promise<WorkspaceOperation | null> {
  directory ??= await gitDirectory(git);
  const [operation, bisect] = await Promise.all([
    loadOperation(git, directory),
    readOptional(path.join(directory, "BISECT_START"))
  ]);
  return operation?.kind ?? (bisect === null ? null : "bisect");
}

export async function loadWorktrees(git: SimpleGit): Promise<WorktreeDetails[]> {
  const text = await git.raw(["worktree", "list", "--porcelain", "-z"]);
  return text
    .split("\0\0")
    .filter(Boolean)
    .map((record) => {
      const fields = new Map(
        record.split("\0").map((line) => {
          const separator = line.indexOf(" ");
          return separator < 0 ? [line, ""] : [line.slice(0, separator), line.slice(separator + 1)];
        })
      );
      return {
        path: normalizeRepoPath(fields.get("worktree") ?? ""),
        head: fields.get("HEAD") ?? "",
        branch: (fields.get("branch") ?? "").replace(/^refs\/heads\//, ""),
        bare: fields.has("bare"),
        locked: fields.has("locked"),
        prunable: fields.has("prunable")
      };
    });
}

/**
 * Parses `name NUL hash NUL extra` lines. For remote refs, `extra` names the
 * target of a symbolic ref such as origin/HEAD, which is skipped. For tags it
 * is the commit an annotated tag points to, which replaces the tag object's hash.
 */
function parseRefs(text: string, extra: "symref" | "peeled"): RefDetails[] {
  return text
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .flatMap((line) => {
      const [name = "", hash = "", third = ""] = line.split("\0");
      if (extra === "symref" && third !== "") {
        return [];
      }
      return [{ name, hash: extra === "peeled" && third !== "" ? third : hash }];
    });
}

/**
 * Parses `name NUL upstream NUL tracking NUL hash NUL date` lines of local branches. `merged`
 * names the branches HEAD already contains.
 */
function parseBranches(text: string, merged: ReadonlySet<string>): BranchDetails[] {
  return text
    .trimEnd()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", upstream = "", tracking = "", hash = "", date = ""] = line.split("\0");
      return {
        name,
        hash,
        upstream: upstream.replace(/^refs\/(heads|remotes)\//, ""),
        ahead: Number(tracking.match(/ahead (\d+)/)?.[1] ?? 0),
        behind: Number(tracking.match(/behind (\d+)/)?.[1] ?? 0),
        gone: tracking === "[gone]",
        date: Number(date) || 0,
        merged: merged.has(name)
      };
    });
}

export async function loadRepositoryState(git: SimpleGit): Promise<RepositoryState> {
  const [
    remotes,
    pushDefault,
    branches,
    mergedBranches,
    remoteRefs,
    tagRefs,
    worktrees,
    status,
    operation,
    undo
  ] = await Promise.all([
    git.getRemotes(),
    git.getConfig("remote.pushDefault"),
    git.raw([
      "for-each-ref",
      "--format=%(refname:lstrip=2)%00%(upstream)%00%(upstream:track)%00%(objectname)%00%(committerdate:unix)",
      "refs/heads/"
    ]),
    // Before the first commit there is no HEAD to contain anything.
    git
      .raw(["for-each-ref", "--merged=HEAD", "--format=%(refname:lstrip=2)", "refs/heads/"])
      .catch(() => ""),
    git.raw([
      "for-each-ref",
      "--format=%(refname:lstrip=2)%00%(objectname)%00%(symref)",
      "refs/remotes/"
    ]),
    git.raw([
      "for-each-ref",
      "--format=%(refname:lstrip=2)%00%(objectname)%00%(*objectname)",
      "refs/tags/"
    ]),
    loadWorktrees(git),
    git.status(),
    loadOperation(git),
    // The header's Undo entry is a convenience; an unreadable journal only hides it.
    loadSafetyUndo(git).catch(() => null)
  ]);
  return {
    remotes: await Promise.all(
      remotes.map(async ({ name }) => ({
        name,
        fetchUrls: (await git.getConfig(`remote.${name}.url`)).values,
        pushUrls: (await git.getConfig(`remote.${name}.pushurl`)).values
      }))
    ),
    pushDefault: pushDefault.value,
    branches: parseBranches(branches, new Set(mergedBranches.split("\n").filter(Boolean))),
    remoteBranches: parseRefs(remoteRefs, "symref"),
    tags: parseRefs(tagRefs, "peeled"),
    worktrees,
    head: status.detached ? "" : (status.current ?? ""),
    operation,
    conflicts: status.conflicted,
    // The index column is blank for unstaged paths, `?` for untracked and `!` for ignored ones.
    staged: status.files.filter((file) => !" ?!".includes(file.index)).length,
    undo
  };
}

export async function loadStashes(git: SimpleGit): Promise<StashDetails[]> {
  const fields = (await git.raw(["stash", "list", "-z", "--format=%gd%x00%H%x00%gs"])).split("\0");
  const stashes: StashDetails[] = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    stashes.push({ ref: fields[index]!, hash: fields[index + 1]!, message: fields[index + 2]! });
  }
  return stashes;
}

export async function loadRebasePlan(git: SimpleGit, baseRef: string): Promise<RebasePlan> {
  const base = await resolveCommit(git, baseRef);
  const head = await resolveCommit(git, "HEAD");
  const branch = (await git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
  if ((await git.raw(["merge-base", base, head])).trim() !== base) {
    throw new Error(l10n.t("Choose an ancestor of the current branch for interactive rebase."));
  }
  // One process for every commit and its message; fields and records both end in NUL.
  const fields = (
    await git.raw([
      "log",
      "-z",
      "--reverse",
      "--topo-order",
      "--format=%H%x00%P%x00%B",
      `${base}..${head}`,
      "--"
    ])
  ).split("\0");
  const rows: { hash: string; parents: string[]; message: string }[] = [];
  for (let index = 0; index + 2 < fields.length; index += 3) {
    rows.push({
      hash: fields[index]!,
      parents: fields[index + 1]!.split(" ").filter(Boolean),
      message: fields[index + 2]!.trimEnd()
    });
  }
  if (rows.length === 0) {
    throw new Error(l10n.t("There are no commits after this commit on the current branch."));
  }
  if (rows.some((row) => row.parents.length > 1)) {
    throw new Error(
      l10n.t(
        "This range contains merge commits. Choose a linear range for interactive rebase, or use Rebase onto this branch to preserve merges."
      )
    );
  }
  return {
    base,
    head,
    branch,
    entries: rows.map(({ hash, message }) => ({ hash, action: "pick" as const, message }))
  };
}

/**
 * Turn a plan into a squash of `hashes`: the oldest of them stays Pick and the rest become
 * Squash, so Git offers every message for the combined commit. The commits must sit next to each
 * other in the plan, since squashing across an unselected commit would also move that commit.
 */
export function squashRebasePlan(plan: RebasePlan, hashes: string[]): RebasePlan {
  const chosen = new Set(hashes);
  if (chosen.size < 2) {
    throw new Error(l10n.t("Select at least two commits to squash."));
  }
  const positions = plan.entries.flatMap((entry, index) => (chosen.has(entry.hash) ? [index] : []));
  if (positions.length !== chosen.size) {
    throw new Error(l10n.t("Only commits on the current branch can be squashed."));
  }
  const first = positions[0]!;
  if (positions.at(-1)! - first + 1 !== positions.length) {
    throw new Error(l10n.t("Select consecutive commits to squash."));
  }
  return {
    ...plan,
    entries: plan.entries.map((entry, index) =>
      chosen.has(entry.hash)
        ? { ...entry, action: index === first ? ("pick" as const) : ("squash" as const) }
        : entry
    )
  };
}

export async function repositoryQuery(
  git: SimpleGit,
  query: RepositoryQuery,
  workspace: { repos: string[]; binary: string; signal?: AbortSignal } = {
    repos: [],
    binary: "git"
  }
): Promise<RepositoryQueryData> {
  switch (query.kind) {
    case "workingTree":
      return { kind: "workingTree", files: await loadWorkingTree(git) };
    case "branchFocus":
      return { kind: "branchFocus", ...(await loadBranchFocus(git, query.branch, query.hashes)) };
    case "pushStatus":
      return { kind: "pushStatus", ...(await loadPushStatus(git)) };
    case "conflictForecast":
      // While a merge, rebase or pick is under way, HEAD is not where the user will merge into.
      return {
        kind: "conflictForecast",
        conflicts: (await loadOperation(git)) === null ? await loadConflictForecast(git, query) : []
      };
    case "replayForecast":
      return { kind: "replayForecast", forecast: await loadReplayForecast(git, query) };
    case "bisect":
      return {
        kind: "bisect",
        state: await loadBisect(git),
        head: await resolveCommit(git, "HEAD").catch(() => null)
      };
    case "submodulePlan":
      return {
        kind: "submodulePlan",
        ...(await submoduleComparison(
          git,
          query.path,
          query.staged,
          workspace.binary,
          workspace.signal
        ))
      };
    case "syncPlan":
      return {
        kind: "syncPlan",
        plan: await loadSyncPlan(git, query.branch, query.remote, query.remoteBranch)
      };
    case "upstreamPlan":
      return { kind: "upstreamPlan", plan: await loadUpstreamPlan(git) };
    case "cleanupPlan":
      return { kind: "cleanupPlan", plan: await loadCleanupPlan(git) };
    case "fastForwardPlan":
      return { kind: "fastForwardPlan", plan: await loadFastForwardPlan(git) };
    case "bulkSyncPlan":
      return { kind: "bulkSyncPlan", plan: await loadBulkSyncPlan(git, query.operation) };
    case "workspace":
      return {
        kind: "workspace",
        entries: await loadWorkspace(workspace.repos, workspace.binary, workspace.signal)
      };
    case "history":
    case "compare":
    case "compareCommits":
    case "reflog":
    case "statistics":
    case "restorePlan":
    case "stagedPlan":
    case "batchPlan":
      return historyQuery(git, query);
    case "state":
      return { kind: "state", state: await loadRepositoryState(git) };
    case "stashes":
      return { kind: "stashes", stashes: await loadStashes(git) };
    case "rebasePlan": {
      let plan = await loadRebasePlan(git, query.base);
      if (query.autosquash) {
        plan = autosquashPlan(plan);
      }
      if (query.squash !== undefined) {
        plan = squashRebasePlan(plan, query.squash);
      }
      return { kind: "rebasePlan", plan };
    }
    case "editPlan":
      return { kind: "editPlan", plan: await loadRewordPlan(git, query.target) };
    case "amendPlan":
      return { kind: "amendPlan", plan: await loadAmendPlan(git, query.target) };
    case "splitPlan":
      return { kind: "splitPlan", plan: await loadSplitPlan(git, query.target) };
    case "absorbPlan":
      return { kind: "absorbPlan", plan: await loadAbsorbPlan(git) };
    case "lease": {
      await requireRemote(git, query.remote);
      await requireBranchName(git, query.branch);
      const hash = await resolveCommit(git, `refs/remotes/${query.remote}/${query.branch}`);
      return { kind: "lease", hash };
    }
    case "safetyNet":
      return { kind: "safetyNet", entries: await loadSafetyNet(git) };
  }
}
