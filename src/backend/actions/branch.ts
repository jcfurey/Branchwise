import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import type { ActionPayload } from "@/backend/types";
import { refNames } from "@/backend/utils/refs";
import { runGit } from "@/backend/utils/runGit";
import { requireBranchName, splitRemoteRef } from "@/backend/utils/validation";

async function localBranchExists(git: SimpleGit, branch: string) {
  return (await refNames(git, "refs/heads/")).includes(branch);
}

/**
 * Switch to a local branch the caller knows exists. `--` keeps Git from reading the name as a
 * path, and `--no-guess` from creating a tracking branch should the branch vanish meanwhile.
 */
async function switchTo(git: SimpleGit, branch: string) {
  await git.raw(["checkout", "--no-guess", branch, "--"]);
}

export async function createBranch(git: SimpleGit, input: ActionPayload<"createBranch">) {
  await requireBranchName(git, input.branchName);
  await git.raw(["branch", "--", input.branchName, input.commitHash]);
}

export async function deleteBranch(git: SimpleGit, input: ActionPayload<"deleteBranch">) {
  // Refs such as `-D` arrive through clones and fetches, so the name is not validated.
  await git.raw(["branch", input.forceDelete ? "-D" : "-d", "--", input.branchName]);
}

export async function renameBranch(git: SimpleGit, input: ActionPayload<"renameBranch">) {
  await requireBranchName(git, input.newName);
  await git.raw(["branch", "-m", "--", input.oldName, input.newName]);
}

/**
 * The remote and branch that a remote-tracking name such as `team/origin/main` comes from. With a
 * fetch the remote must be known; without one, an unknown remote only means no tracking.
 */
async function trackedRemote(git: SimpleGit, remoteBranch: string, fetch: boolean) {
  try {
    return await splitRemoteRef(git, remoteBranch);
  } catch (error) {
    if (fetch) {
      throw error;
    }
    return null;
  }
}

/**
 * Check out a local branch. With `remoteBranch`, first bring it up to date with that
 * remote-tracking branch: create it tracking the remote, or fast-forward the existing branch.
 */
export async function checkoutBranch(git: SimpleGit, input: ActionPayload<"checkoutBranch">) {
  const { branchName, remoteBranch } = input;
  await requireBranchName(git, branchName);

  if (remoteBranch === null) {
    // Only a switch: Git would otherwise restore a same-named path or detach at a tag.
    if (!(await localBranchExists(git, branchName))) {
      throw new Error(l10n.t("The branch changed. Refresh the graph and try again."));
    }
    await switchTo(git, branchName);
    return;
  }

  const fetch = input.fetch === true;
  const source = await trackedRemote(git, remoteBranch, fetch);
  const trackingRef = `refs/remotes/${remoteBranch}`;
  if (fetch && source !== null) {
    // Update only this remote-tracking ref, following the remote even if it was rewound.
    await runGit(git, [
      "fetch",
      "--no-tags",
      "--",
      source.remote,
      `+refs/heads/${source.branch}:${trackingRef}`
    ]);
  }

  if (await localBranchExists(git, branchName)) {
    await switchTo(git, branchName);
    await git.raw(["merge", "--ff-only", trackingRef]);
    return;
  }
  // Explicit, so that `branch.autoSetupMerge` cannot change whether the branch tracks.
  await git.raw([
    "checkout",
    source === null ? "--no-track" : "--track",
    "-b",
    branchName,
    trackingRef
  ]);
}
