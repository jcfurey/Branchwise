import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import type { ActionPayload } from "@/backend/types";
import { runGit } from "@/backend/utils/runGit";

/** Whether `MERGE_HEAD` exists. A check that fails, for example once cancelled, counts as no. */
async function mergeInProgress(git: SimpleGit) {
  const head = await git.raw(["rev-parse", "--verify", "--quiet", "MERGE_HEAD"]).catch(() => "");
  return head.trim() !== "";
}

/**
 * Merge `revision` into the checked-out branch. Git's messages may be translated, so a merge that
 * this call left stopped is recognised by `MERGE_HEAD` alone. When one was already in progress,
 * Git refuses to start, and its own message is the better explanation.
 */
async function merge(git: SimpleGit, revision: string, createNewCommit: boolean, binary: string) {
  const alreadyMerging = await mergeInProgress(git);
  const args = ["merge", ...(createNewCommit ? ["--no-ff"] : []), "--no-edit", "--end-of-options"];
  try {
    await runGit(git, [...args, revision], binary);
  } catch (error) {
    if (!alreadyMerging && (await mergeInProgress(git))) {
      throw new Error(
        l10n.t(
          "The merge stopped on conflicts. Resolve and stage the conflicted files, then continue or abort the merge from the status strip."
        ),
        { cause: error }
      );
    }
    throw error;
  }
}

/**
 * Merge a local branch. Its short name gives the nicer message "Merge branch 'feature'", but only
 * when Git resolves that name to the branch rather than, say, a tag of the same name.
 */
export async function mergeBranch(
  git: SimpleGit,
  input: ActionPayload<"mergeBranch">,
  binary: string
) {
  const fullRef = `refs/heads/${input.branchName}`;
  const resolved = await git
    .raw([
      "rev-parse",
      "--verify",
      "--quiet",
      "--symbolic-full-name",
      "--end-of-options",
      input.branchName
    ])
    .catch(() => "");
  const revision = resolved.trim() === fullRef ? input.branchName : fullRef;
  await merge(git, revision, input.createNewCommit, binary);
}

export async function mergeCommit(
  git: SimpleGit,
  input: ActionPayload<"mergeCommit">,
  binary: string
) {
  await merge(git, input.commitHash, input.createNewCommit, binary);
}
