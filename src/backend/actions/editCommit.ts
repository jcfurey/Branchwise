import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { runHistoryAction } from "@/backend/actions/history";
import { interactiveRebase, requireIdle } from "@/backend/actions/rebase";
import { loadAmendPlan, loadRewordPlan } from "@/backend/queries/editCommit";
import { loadOperation, loadRebasePlan } from "@/backend/queries/repository";
import type { AmendPlan, EditPlan, RebasePlan } from "@/backend/types";
import { autosquashPlan } from "@/backend/utils/autosquash";
import { runGit } from "@/backend/utils/runGit";
import { requireCurrentBranch, resolveCommit } from "@/backend/utils/validation";

/** The rebase plan from the target's parent to HEAD, every commit picked. */
async function rebaseFromParent(git: SimpleGit, target: string) {
  return loadRebasePlan(git, `${target}^`);
}

/**
 * Give the target commit a new message. HEAD is amended with `--only`, so whatever is staged
 * stays staged; an older commit is reworded by an interactive rebase that picks everything
 * else. Either way the message is kept as typed apart from surrounding whitespace, and the
 * trees of every commit stay the same.
 */
export async function rewordCommit(
  git: SimpleGit,
  expected: EditPlan,
  message: string,
  binary: string
) {
  await requireIdle(git);
  await requireCurrentBranch(git, expected.branch, expected.head);
  if (!message.trim() || message.includes("\0")) {
    throw new Error(l10n.t("Enter a commit message."));
  }
  const plan = await loadRewordPlan(git, expected.target);
  if (plan.target !== plan.head) {
    const rebase = await rebaseFromParent(git, plan.target);
    const entry = rebase.entries.find((item) => item.hash === plan.target)!;
    entry.action = "reword";
    entry.message = message;
    await interactiveRebase(git, rebase, binary, true);
    return;
  }
  // A file keeps the message out of the command line, whose length Windows limits.
  const directory = await mkdtemp(path.join(os.tmpdir(), "branchwise-message-"));
  try {
    const file = path.join(directory, "message");
    await writeFile(file, message + "\n", { mode: 0o600 });
    // `--allow-empty` lets a commit that changes nothing keep doing so.
    await runGit(
      git,
      ["commit", "--amend", "--only", "--allow-empty", "--cleanup=whitespace", "--file", file],
      binary
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

/**
 * Make sure the fixup commit `fixup` folds into `target`. Autosquash matches a fixup to its
 * commit by subject, so another commit with the same subject leaves it picked; it then moves
 * after the target and the fixups already arranged for it.
 */
function foldInto(plan: RebasePlan, fixup: string, target: string): RebasePlan {
  const at = plan.entries.findIndex((entry) => entry.hash === fixup);
  let into = at - 1;
  while (into >= 0 && plan.entries[into]!.hash !== target) {
    if (!["fixup", "squash"].includes(plan.entries[into]!.action)) {
      break;
    }
    into--;
  }
  if (plan.entries[at]?.action === "fixup" && plan.entries[into]?.hash === target) {
    return plan;
  }
  const entries = plan.entries.filter((entry) => entry.hash !== fixup);
  let index = entries.findIndex((entry) => entry.hash === target) + 1;
  while (index < entries.length && ["fixup", "squash"].includes(entries[index]!.action)) {
    index++;
  }
  entries.splice(index, 0, { ...plan.entries[at]!, action: "fixup" });
  return { ...plan, entries };
}

/**
 * Add the staged changes to the target commit. HEAD is amended. For an older commit the staged
 * changes are committed as `fixup! <subject>`, as Create Fixup Commit does, and an autosquash
 * rebase from the target's parent folds that commit in at once. A rebase that stops on a
 * conflict stays in progress for the status strip to continue or abort; one refused before it
 * began gives the staged changes back as they were.
 */
export async function amendCommit(git: SimpleGit, expected: AmendPlan, binary: string) {
  await requireIdle(git);
  await requireCurrentBranch(git, expected.branch, expected.head);
  const plan = await loadAmendPlan(git, expected.target);
  if (plan.staged.tree !== expected.staged.tree) {
    throw new Error(l10n.t("The staged changes changed. Review them again."));
  }
  if (plan.target === plan.head) {
    await runGit(git, ["commit", "--amend", "--no-edit"], binary);
    return;
  }
  await runHistoryAction(git, { kind: "fixup", plan: plan.staged }, binary);
  const fixup = await resolveCommit(git, "HEAD");
  try {
    const rebase = foldInto(
      autosquashPlan(await rebaseFromParent(git, plan.target)),
      fixup,
      plan.target
    );
    await interactiveRebase(git, rebase, binary);
  } catch (error) {
    if ((await loadOperation(git)) === null && (await resolveCommit(git, "HEAD")) === fixup) {
      await git.raw(["reset", "--soft", `${fixup}^`, "--"]);
    }
    throw error;
  }
}
