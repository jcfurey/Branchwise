import path from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { gitClientFactory } from "@/backend/gitClient";
import { compareCommits, loadComparison, loadHistory } from "@/backend/queries/history";
import { loadOperationKind, loadWorktrees } from "@/backend/queries/repository";
import { submoduleLinks } from "@/backend/queries/workspace";
import type {
  BulkSkipReason,
  BulkSyncPlan,
  CleanupPlan,
  FastForwardPlan,
  SubmodulePlan,
  SyncPlan
} from "@/backend/types";
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

/**
 * What a pull or push across the workspace would do here, and what it leaves alone and why.
 * Nothing is forced and nothing merges: a pull only fast-forwards the checked-out branch, on a
 * clean work tree, to the upstream already fetched; a push only sends the branches whose
 * remote upstream they are strictly ahead of. A merge, rebase, pick or bisect stopped partway
 * skips the whole repository.
 */
export async function loadBulkSyncPlan(
  git: SimpleGit,
  operation: "pull" | "push"
): Promise<BulkSyncPlan> {
  const [status, stopped, refs] = await Promise.all([
    git.status(),
    loadOperationKind(git),
    git.raw([
      "for-each-ref",
      "--format=%(refname:lstrip=2)%00%(upstream)%00%(upstream:track)",
      "refs/heads/"
    ])
  ]);
  const current = status.detached ? "" : (status.current ?? "");
  const plan: BulkSyncPlan = { operation, syncs: [], skipped: [] };
  const skip = (branch: string, reason: BulkSkipReason) => {
    plan.skipped.push({ branch, reason });
    return plan;
  };
  if (stopped !== null) {
    return skip(current, "operation");
  }
  const branches = refs
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      const [name = "", upstream = "", track = ""] = line.split("\0");
      return {
        name,
        // A local branch as upstream has nowhere to pull from or push to.
        upstream: upstream.startsWith("refs/remotes/") ? upstream.slice(13) : "",
        gone: track === "[gone]",
        ahead: /ahead \d+/.test(track),
        behind: /behind \d+/.test(track)
      };
    });
  const here = branches.find((branch) => branch.name === current);
  if (operation === "pull") {
    if (!status.isClean()) {
      return skip(current, "uncommitted");
    }
    if (current === "") {
      return skip("", "detached");
    }
    if (!here?.upstream) {
      return skip(current, "noUpstream");
    }
    if (here.gone) {
      return skip(current, "upstreamGone");
    }
    if (!here.behind) {
      return skip(current, "upToDate");
    }
    if (here.ahead) {
      return skip(current, "diverged");
    }
    plan.syncs.push(await loadUpstreamPlan(git));
    return plan;
  }
  if (current !== "" && here !== undefined && !here.upstream) {
    skip(current, "noUpstream");
  }
  for (const branch of branches) {
    if (!branch.upstream) {
      continue;
    }
    if (branch.gone) {
      skip(branch.name, "upstreamGone");
    } else if (branch.ahead && branch.behind) {
      skip(branch.name, "diverged");
    } else if (branch.ahead) {
      // One branch at a time keeps the number of Git processes bounded.
      // eslint-disable-next-line no-await-in-loop
      const upstream = await splitRemoteRef(git, branch.upstream);
      // eslint-disable-next-line no-await-in-loop
      plan.syncs.push(await loadSyncPlan(git, branch.name, upstream.remote, upstream.branch));
    }
  }
  if (plan.syncs.length === 0 && plan.skipped.length === 0) {
    skip(current, branches.some((branch) => branch.upstream) ? "upToDate" : "noUpstream");
  }
  return plan;
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

/**
 * The local branches whose upstream has commits they lack, split into those that can move
 * forward to their upstream and those that cannot: a branch with commits of its own has
 * diverged, a branch checked out in another worktree would leave that worktree behind its
 * branch, and the branch checked out here moves only with a clean work tree.
 */
export async function loadFastForwardPlan(git: SimpleGit): Promise<FastForwardPlan> {
  const [branches, refs, worktrees, status] = await Promise.all([
    git.raw([
      "for-each-ref",
      "--format=%(refname:lstrip=2)%00%(objectname)%00%(upstream)%00%(upstream:short)%00%(upstream:track)",
      "refs/heads/"
    ]),
    git.raw([
      "for-each-ref",
      "--format=%(refname)%00%(objectname)",
      "refs/heads/",
      "refs/remotes/"
    ]),
    loadWorktrees(git),
    git.status()
  ]);
  const hashOf = new Map(
    refs
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("\0") as [string, string])
  );
  const here = status.detached ? "" : (status.current ?? "");
  const elsewhere = new Set(
    worktrees
      .map((worktree) => worktree.branch)
      .filter((branch) => branch !== "" && branch !== here)
  );
  const plan: FastForwardPlan = { branches: [], skipped: [] };
  for (const line of branches.split("\n").filter(Boolean)) {
    const [name = "", from = "", upstreamRef = "", upstream = "", track = ""] = line.split("\0");
    const to = hashOf.get(upstreamRef);
    const behind = Number(track.match(/behind (\d+)/)?.[1] ?? 0);
    if (to === undefined || behind === 0) {
      continue;
    }
    if (/ahead \d+/.test(track)) {
      plan.skipped.push({ name, upstream, reason: "diverged" });
    } else if (elsewhere.has(name)) {
      plan.skipped.push({ name, upstream, reason: "worktree" });
    } else if (name === here && !status.isClean()) {
      plan.skipped.push({ name, upstream, reason: "uncommitted" });
    } else {
      plan.branches.push({ name, upstream, from, to, behind, current: name === here });
    }
  }
  return plan;
}
