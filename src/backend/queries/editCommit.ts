import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { loadStagedPlan } from "@/backend/queries/history";
import type { AmendPlan, EditPlan } from "@/backend/types";
import { readGitCode } from "@/backend/utils/runGit";
import { resolveCommit } from "@/backend/utils/validation";

/**
 * Find a commit of the checked-out branch that can be edited in place, or say why it cannot.
 * Only HEAD's first-parent line qualifies: a commit that arrived through a merge belongs to
 * another branch's history. HEAD itself is amended, so it may be a root or a merge; an older
 * commit is rewritten by an interactive rebase from its parent, which needs a parent and,
 * like the rebase editor, a range without merges.
 */
export async function loadEditPlan(git: SimpleGit, target: string): Promise<EditPlan> {
  // `symbolic-ref --quiet` prints nothing for a detached HEAD.
  const branch = (
    await git.raw(["symbolic-ref", "--quiet", "--short", "HEAD"]).catch(() => "")
  ).trim();
  if (branch === "") {
    throw new Error(l10n.t("Check out a branch to edit its commits."));
  }
  const [head, hash] = await Promise.all([resolveCommit(git, "HEAD"), resolveCommit(git, target)]);
  const notOnBranch = new Error(
    l10n.t(
      "Only commits on the checked-out branch can be edited, and not those it gained through a merge."
    )
  );
  if ((await readGitCode(git, ["merge-base", "--is-ancestor", hash, head], [0, 1])).code !== 0) {
    throw notOnBranch;
  }
  // HEAD's first parents back to the target. On its line, the oldest one's first parent is the
  // target; otherwise the walk stops where the target's own history joins it.
  const line = (await git.raw(["rev-list", "--first-parent", "--parents", head, `^${hash}`, "--"]))
    .split("\n")
    .filter(Boolean);
  if (line.length > 0 && line.at(-1)!.split(" ")[1] !== hash) {
    throw notOnBranch;
  }
  const [details, contained] = await Promise.all([
    git.raw(["log", "-1", "-z", "--format=%P%x00%B", hash, "--"]),
    git.raw([
      "for-each-ref",
      "--count=1",
      "--contains",
      hash,
      "--format=%(refname)",
      "refs/remotes/"
    ])
  ]);
  const [parents = "", message = ""] = details.split("\0");
  if (hash !== head) {
    const parent = parents.split(" ").find(Boolean);
    if (parent === undefined) {
      throw new Error(
        l10n.t(
          "The first commit can be edited only while it is the latest one, as there is nothing to rebase it onto."
        )
      );
    }
    const merges = await git.raw(["rev-list", "--count", "--min-parents=2", `${parent}..${head}`]);
    if (Number(merges.trim()) > 0) {
      throw new Error(
        l10n.t(
          "This commit or one after it is a merge, which rewriting would flatten. Edit a commit after the last merge instead."
        )
      );
    }
  }
  return {
    branch,
    head,
    target: hash,
    message: message.trimEnd(),
    later: line.length,
    pushed: contained.trim() !== ""
  };
}

/** Whether rewriting the commits after `plan`'s target has to wait for a clean working tree. */
function rebases(plan: EditPlan) {
  return plan.target !== plan.head;
}

/**
 * An edit of a commit's message. HEAD is amended whatever the working tree holds; an older
 * commit is rebased, which needs a clean working tree, as the rebase editor does.
 */
export async function loadRewordPlan(git: SimpleGit, target: string): Promise<EditPlan> {
  const plan = await loadEditPlan(git, target);
  if (rebases(plan) && !(await git.status()).isClean()) {
    throw new Error(l10n.t("Commit or stash your changes before rebasing."));
  }
  return plan;
}

/**
 * Adding the staged changes to a commit. HEAD is amended and keeps any unstaged changes. For
 * an older commit the staged changes become a fixup commit, and the autosquash rebase after it
 * needs a working tree with nothing else in it, untracked files included.
 */
export async function loadAmendPlan(git: SimpleGit, target: string): Promise<AmendPlan> {
  const plan = await loadEditPlan(git, target);
  const status = await git.status();
  // The index column is blank for unstaged paths, `?` for untracked and `!` for ignored ones.
  if (status.files.every((file) => " ?!".includes(file.index))) {
    throw new Error(l10n.t("Stage the changes to add to this commit first."));
  }
  if (rebases(plan) && status.files.some((file) => file.working_dir !== " ")) {
    throw new Error(
      l10n.t(
        "Stage or stash the unstaged and untracked changes first. The rebase that adds the staged changes needs a clean working tree."
      )
    );
  }
  return { ...plan, staged: await loadStagedPlan(git, plan.target) };
}
