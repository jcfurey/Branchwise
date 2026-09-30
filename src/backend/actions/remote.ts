import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import type { ActionPayload } from "@/backend/types";
import { runGit } from "@/backend/utils/runGit";
import { requireBranchName, requireRemote } from "@/backend/utils/validation";

export async function pushBranch(git: SimpleGit, input: ActionPayload<"pushBranch">) {
  await requireRemote(git, input.remote);
  await requireBranchName(git, input.branchName);
  await requireBranchName(git, input.remoteBranch);
  if (
    input.expectedRemoteHash !== undefined &&
    !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(input.expectedRemoteHash)
  ) {
    throw new Error(l10n.t("Fetch and inspect the remote branch before a force-with-lease push."));
  }
  await runGit(git, [
    "push",
    ...(input.setUpstream ? ["--set-upstream"] : []),
    ...(input.expectedRemoteHash === undefined
      ? []
      : [`--force-with-lease=refs/heads/${input.remoteBranch}:${input.expectedRemoteHash}`]),
    "--",
    input.remote,
    `refs/heads/${input.branchName}:refs/heads/${input.remoteBranch}`
  ]);
}

export async function fetchRemote(git: SimpleGit, input: ActionPayload<"fetchRemote">) {
  const prune = input.prune ? "--prune" : "--no-prune";
  if (input.remote === null) {
    await runGit(git, ["fetch", "--all", prune]);
    return;
  }
  await requireRemote(git, input.remote);
  await runGit(git, ["fetch", prune, "--", input.remote]);
}

export async function pullBranch(git: SimpleGit, input: ActionPayload<"pullBranch">) {
  await requireRemote(git, input.remote);
  await requireBranchName(git, input.branchName);
  await requireBranchName(git, input.remoteBranch);
  const head = (await git.raw(["symbolic-ref", "--quiet", "HEAD"])).trim();
  if (head !== `refs/heads/${input.branchName}`) {
    throw new Error(l10n.t("Check out branch '{0}' before pulling it.", input.branchName));
  }
  await runGit(git, [
    "pull",
    "--ff-only",
    "--no-rebase",
    "--",
    input.remote,
    `refs/heads/${input.remoteBranch}`
  ]);
}
