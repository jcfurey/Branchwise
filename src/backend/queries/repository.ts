import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { loadBisect } from "@/backend/queries/bisect";
import { loadBranchFocus } from "@/backend/queries/branchFocus";
import { historyQuery } from "@/backend/queries/history";
import {
  loadSyncPlan,
  loadUpstreamPlan,
  loadCleanupPlan,
  submoduleComparison
} from "@/backend/queries/workflows";
import { loadWorkingTree } from "@/backend/queries/workingTree";
import { loadWorkspace } from "@/backend/queries/workspace";
import type {
  OperationKind,
  OperationState,
  RebasePlan,
  RefDetails,
  RepositoryQuery,
  RepositoryQueryData,
  RepositoryState,
  StashDetails,
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

export async function loadOperation(git: SimpleGit): Promise<OperationState | null> {
  const directory = await gitDirectory(git);
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

export async function loadRepositoryState(git: SimpleGit): Promise<RepositoryState> {
  const [remotes, pushDefault, branches, remoteRefs, tagRefs, worktrees, status, operation] =
    await Promise.all([
      git.getRemotes(),
      git.getConfig("remote.pushDefault"),
      git.raw([
        "for-each-ref",
        "--format=%(refname:lstrip=2)%00%(upstream)%00%(upstream:track)%00%(objectname)",
        "refs/heads/"
      ]),
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
      loadOperation(git)
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
    branches: branches
      .trimEnd()
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [name = "", upstream = "", tracking = "", hash = ""] = line.split("\0");
        return {
          name,
          hash,
          upstream: upstream.replace(/^refs\/(heads|remotes)\//, ""),
          ahead: Number(tracking.match(/ahead (\d+)/)?.[1] ?? 0),
          behind: Number(tracking.match(/behind (\d+)/)?.[1] ?? 0),
          gone: tracking === "[gone]"
        };
      }),
    remoteBranches: parseRefs(remoteRefs, "symref"),
    tags: parseRefs(tagRefs, "peeled"),
    worktrees,
    head: status.detached ? "" : (status.current ?? ""),
    operation,
    conflicts: status.conflicted
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
    case "workspace":
      return {
        kind: "workspace",
        entries: await loadWorkspace(workspace.repos, workspace.binary, workspace.signal)
      };
    case "history":
    case "compare":
    case "compareCommits":
    case "reflog":
    case "restorePlan":
    case "stagedPlan":
    case "batchPlan":
      return historyQuery(git, query);
    case "state":
      return { kind: "state", state: await loadRepositoryState(git) };
    case "stashes":
      return { kind: "stashes", stashes: await loadStashes(git) };
    case "rebasePlan": {
      const plan = await loadRebasePlan(git, query.base);
      return { kind: "rebasePlan", plan: query.autosquash ? autosquashPlan(plan) : plan };
    }
    case "lease": {
      await requireRemote(git, query.remote);
      await requireBranchName(git, query.branch);
      const hash = await resolveCommit(git, `refs/remotes/${query.remote}/${query.branch}`);
      return { kind: "lease", hash };
    }
  }
}
