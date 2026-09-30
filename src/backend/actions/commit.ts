import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import type { ActionPayload, GitResetMode } from "@/backend/types";

const RESET_MODES: ReadonlySet<string> = new Set<GitResetMode>(["soft", "mixed", "hard"]);

/**
 * Refuse anything but a commit ID, full or abbreviated to Git's minimum of four digits, so that
 * Git cannot read the value as a branch, a path or an option.
 */
function requireCommitId(commitHash: string) {
  if (!/^[0-9a-f]{4,64}$/i.test(commitHash)) {
    throw new Error(l10n.t("Choose a valid commit."));
  }
}

/** `-m <parent>` for a merge commit's 1-based parent, or nothing for 0. */
function mainlineArgs(parentIndex: number) {
  if (!Number.isSafeInteger(parentIndex) || parentIndex < 0) {
    throw new Error(l10n.t("Choose a valid mainline parent for the selected merge commits."));
  }
  return parentIndex === 0 ? [] : ["-m", String(parentIndex)];
}

export async function checkoutCommit(git: SimpleGit, input: ActionPayload<"checkoutCommit">) {
  requireCommitId(input.commitHash);
  await git.raw(["checkout", "--detach", "--no-guess", input.commitHash, "--"]);
}

export async function cherrypickCommit(git: SimpleGit, input: ActionPayload<"cherrypickCommit">) {
  requireCommitId(input.commitHash);
  const mainline = mainlineArgs(input.parentIndex);
  await git.raw(["cherry-pick", ...mainline, input.commitHash]);
}

export async function revertCommit(git: SimpleGit, input: ActionPayload<"revertCommit">) {
  requireCommitId(input.commitHash);
  const mainline = mainlineArgs(input.parentIndex);
  // Nobody could answer an editor here, so Git's message is used as is.
  await git.raw(["revert", "--no-edit", ...mainline, input.commitHash]);
}

export async function resetToCommit(git: SimpleGit, input: ActionPayload<"resetToCommit">) {
  requireCommitId(input.commitHash);
  if (!RESET_MODES.has(input.resetMode)) {
    throw new Error(l10n.t("Choose a soft, mixed or hard reset."));
  }
  // `--` makes Git read the commit as a revision, never as a path to reset.
  await git.raw(["reset", `--${input.resetMode}`, input.commitHash, "--"]);
}
