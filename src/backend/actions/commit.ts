import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import type { ActionPayload, GitResetMode } from "@/backend/types";
import { abbrevCommit } from "@/backend/utils/string";
import { untrackedInTheWay } from "@/backend/utils/untracked";

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
  const head = async () => (await git.raw(["rev-parse", "--verify", "HEAD"])).trim();
  const before = await head();
  // Nobody could answer an editor here, so Git's message is used as is.
  await git.raw(["revert", "--no-edit", ...mainline, input.commitHash]);
  // A revert that would change nothing commits nothing. Git says so on its standard output
  // alone and exits with status 1, which reads as success here; the unmoved HEAD tells.
  if ((await head()) === before) {
    throw new Error(
      l10n.t(
        "There is nothing to revert: the current branch no longer has the changes of commit {0}.",
        abbrevCommit(input.commitHash)
      )
    );
  }
}

/** How many files in the way of a hard reset its refusal names. */
const NAMED_FILES = 5;

/**
 * Refuse a hard reset to `commitHash` while untracked files stand where it would write the
 * commit's files. Git replaces them without asking, and unlike changes to tracked files, which
 * the Safety Net keeps, they were never in a commit or a stash.
 */
export async function requireNothingInTheWay(git: SimpleGit, commitHash: string) {
  requireCommitId(commitHash);
  const files = await untrackedInTheWay(git, commitHash, NAMED_FILES + 1);
  if (files.length > 0) {
    throw new Error(
      l10n.t(
        "A hard reset to this commit would overwrite untracked files, which nothing could bring back: {0}. Move, commit or delete them first.",
        files.slice(0, NAMED_FILES).join(", ") + (files.length > NAMED_FILES ? ", …" : "")
      )
    );
  }
}

export async function resetToCommit(git: SimpleGit, input: ActionPayload<"resetToCommit">) {
  requireCommitId(input.commitHash);
  if (!RESET_MODES.has(input.resetMode)) {
    throw new Error(l10n.t("Choose a soft, mixed or hard reset."));
  }
  if (input.resetMode === "hard") {
    await requireNothingInTheWay(git, input.commitHash);
  }
  // `--` makes Git read the commit as a revision, never as a path to reset.
  await git.raw(["reset", `--${input.resetMode}`, input.commitHash, "--"]);
}
