import path from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { gitClientFactory } from "@/backend/gitClient";
import { compareCommits, loadComparison, loadHistory } from "@/backend/queries/history";
import { loadWorktrees } from "@/backend/queries/repository";
import { submoduleLinks } from "@/backend/queries/workspace";
import type { CleanupPlan, SubmodulePlan, SyncPlan } from "@/backend/types";
import { normalizeRepoPath } from "@/backend/utils/repoPath";
import {
  requireBranchName,
  requireRemote,
  resolveCommit,
  splitRemoteRef
} from "@/backend/utils/validation";

export async function loadSubmodulePlan(
  git: SimpleGit,
  file: string,
  binary: string,
  signal?: AbortSignal
): Promise<SubmodulePlan> {
  const link = (await submoduleLinks(git)).find((entry) => entry.path === file);
  if (!link) {
    throw new Error(
      l10n.t("This submodule pointer changed or is conflicted. Refresh the workspace.")
    );
  }
  const root = (await git.raw(["rev-parse", "--show-toplevel"])).replace(/\n$/, "");
  const child = normalizeRepoPath(path.join(root, link.path));
  const childGit = gitClientFactory(child, binary, signal).getInstance();
  if (
    normalizeRepoPath((await childGit.raw(["rev-parse", "--show-toplevel"])).replace(/\n$/, "")) !==
    child
  ) {
    throw new Error(l10n.t("Initialize the submodule before inspecting its commits."));
  }
  return {
    path: file,
    child,
    recorded: link.recorded,
    committed: link.committed,
    parentHead: await resolveCommit(git, "HEAD").catch(() => null),
    head: await resolveCommit(childGit, "HEAD")
  };
}

export async function submoduleComparison(
  git: SimpleGit,
  file: string,
  staged: boolean,
  binary: string,
  signal?: AbortSignal
) {
  const plan = await loadSubmodulePlan(git, file, binary, signal);
  const left = staged ? plan.committed : plan.recorded;
  const right = staged ? plan.recorded : plan.head;
  const comparison =
    left === null
      ? null
      : await loadComparison(
          gitClientFactory(plan.child, binary, signal).getInstance(),
          left,
          right,
          false
        );
  return { plan, comparison };
}

export async function loadSyncPlan(
  git: SimpleGit,
  branch: string,
  remote: string,
  remoteBranch: string
): Promise<SyncPlan> {
  await requireRemote(git, remote);
  await Promise.all([requireBranchName(git, branch), requireBranchName(git, remoteBranch)]);
  const local = await resolveCommit(git, `refs/heads/${branch}`);
  const remoteHead = await resolveCommit(git, `refs/remotes/${remote}/${remoteBranch}`).catch(
    () => null
  );
  const [incoming, outgoing, counts] =
    remoteHead === null
      ? [
          { entries: [], more: false },
          await loadHistory(
            git,
            {
              text: "",
              author: "",
              since: "",
              until: "",
              path: "",
              revision: local,
              follow: false
            },
            0
          ),
          `${(await git.raw(["rev-list", "--count", local])).trim()} 0`
        ]
      : await Promise.all([
          compareCommits(git, local, remoteHead, "right", 0),
          compareCommits(git, local, remoteHead, "left", 0),
          git.raw(["rev-list", "--left-right", "--count", `${local}...${remoteHead}`])
        ]);
  const [ahead = 0, behind = 0] = counts.trim().split(/\s+/).map(Number);
  return {
    branch,
    remote,
    remoteBranch,
    local,
    remoteHead,
    incoming,
    outgoing,
    ahead,
    behind,
    canFastForward: remoteHead !== null && ahead === 0
  };
}

export async function loadUpstreamPlan(git: SimpleGit) {
  const branch = (await git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"])).trim();
  const ref = (
    await git.raw(["for-each-ref", "--format=%(upstream)", `refs/heads/${branch}`])
  ).trim();
  if (!ref.startsWith("refs/remotes/")) {
    throw new Error(l10n.t("Configure a remote upstream for the current branch first."));
  }
  const upstream = await splitRemoteRef(git, ref.slice("refs/remotes/".length));
  return loadSyncPlan(git, branch, upstream.remote, upstream.branch);
}

export async function loadCleanupPlan(git: SimpleGit): Promise<CleanupPlan> {
  const base = await resolveCommit(git, "HEAD");
  const [worktrees, refs, defaults] = await Promise.all([
    loadWorktrees(git),
    git.raw([
      "for-each-ref",
      "--merged=" + base,
      "--format=%(refname:lstrip=2)%00%(objectname)",
      "refs/heads/"
    ]),
    git.raw(["for-each-ref", "--format=%(symref)", "refs/remotes/"])
  ]);
  const protectedBranches = new Set(["main", "master", ...worktrees.map((item) => item.branch)]);
  const remotes = await git.getRemotes();
  for (const ref of defaults.trim().split("\n")) {
    const remote = remotes
      .map((item) => `refs/remotes/${item.name}/`)
      .filter((prefix) => ref.startsWith(prefix))
      .toSorted((a, b) => b.length - a.length)[0];
    if (remote) {
      protectedBranches.add(ref.slice(remote.length));
    }
  }
  return {
    base,
    branches: refs
      .trim()
      .split("\n")
      .filter(Boolean)
      .flatMap((line) => {
        const [name = "", hash = ""] = line.split("\0");
        return protectedBranches.has(name) ? [] : [{ name, hash }];
      })
  };
}
