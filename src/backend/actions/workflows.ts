import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { requireIdle } from "@/backend/actions/rebase";
import { fetchRemote } from "@/backend/actions/remote";
import { loadBisect } from "@/backend/queries/bisect";
import { loadOperation } from "@/backend/queries/repository";
import { loadCleanupPlan, loadSubmodulePlan, loadSyncPlan } from "@/backend/queries/workflows";
import type { WorkflowAction } from "@/backend/types";
import { runGit } from "@/backend/utils/runGit";
import { requireCurrentBranch, resolveCommit } from "@/backend/utils/validation";

async function requireClean(git: SimpleGit) {
  if (!(await git.status()).isClean()) {
    throw new Error(l10n.t("Commit or stash your changes before changing revisions."));
  }
}

export async function runWorkflowAction(
  git: SimpleGit,
  action: WorkflowAction,
  binary: string
): Promise<void> {
  switch (action.kind) {
    case "fetch":
      await fetchRemote(git, { requestId: "", remote: action.remote, prune: false });
      return;
    case "submodulePointer": {
      await requireIdle(git);
      const current = await loadSubmodulePlan(git, action.plan.path, binary);
      if (JSON.stringify(current) !== JSON.stringify(action.plan)) {
        throw new Error(
          l10n.t("The submodule or parent revision changed. Review its pointer again.")
        );
      }
      const target = action.operation === "stage" ? current.head : current.committed;
      if (target === null) {
        await git.raw(["update-index", "--force-remove", "--", current.path]);
      } else {
        await git.raw(["update-index", "--add", "--cacheinfo", "160000", target, current.path]);
      }
      return;
    }
    case "sync": {
      const { plan } = action;
      const current = await loadSyncPlan(git, plan.branch, plan.remote, plan.remoteBranch);
      if (current.local !== plan.local || current.remoteHead !== plan.remoteHead) {
        throw new Error(l10n.t("The local or fetched remote branch changed. Refresh the preview."));
      }
      if (action.operation === "pull") {
        await requireIdle(git);
        await requireCurrentBranch(git, plan.branch, plan.local);
        await requireClean(git);
        if (!current.canFastForward || !current.remoteHead) {
          throw new Error(
            l10n.t(
              "This branch cannot be fast-forwarded. Inspect its incoming and outgoing commits."
            )
          );
        }
        // Merge the reviewed commit. A second fetch must not silently expand the plan.
        await git.raw(["merge", "--ff-only", "--no-autostash", current.remoteHead]);
      } else {
        if (action.force && !plan.remoteHead) {
          throw new Error(
            l10n.t("Fetch and inspect the remote branch before a force-with-lease push.")
          );
        }
        // An object ID fixes the exact source even if another Git client moves the branch.
        await runGit(git, [
          "push",
          ...(action.force
            ? [`--force-with-lease=refs/heads/${plan.remoteBranch}:${plan.remoteHead}`]
            : []),
          "--",
          plan.remote,
          `${plan.local}:refs/heads/${plan.remoteBranch}`
        ]);
        if (action.setUpstream) {
          await git.raw([
            "branch",
            `--set-upstream-to=${plan.remote}/${plan.remoteBranch}`,
            "--",
            plan.branch
          ]);
        }
      }
      return;
    }
    case "cleanup": {
      await requireIdle(git);
      const current = await loadCleanupPlan(git);
      if (
        current.base !== action.plan.base ||
        action.plan.branches.length === 0 ||
        new Set(action.plan.branches.map((item) => item.name)).size !==
          action.plan.branches.length ||
        action.plan.branches.some(
          (item) =>
            !current.branches.some(
              (candidate) => candidate.name === item.name && candidate.hash === item.hash
            )
        )
      ) {
        throw new Error(
          l10n.t("The branch cleanup plan changed. Review the merged branches again.")
        );
      }
      let deleted = 0;
      try {
        for (const branch of action.plan.branches) {
          // Compare-and-delete refuses a branch moved by another Git client.
          // eslint-disable-next-line no-await-in-loop
          await git.raw(["update-ref", "-d", `refs/heads/${branch.name}`, branch.hash]);
          deleted++;
          // Match git branch -d's cleanup of the deleted branch's configuration.
          // eslint-disable-next-line no-await-in-loop
          await git.raw(["config", "--remove-section", `branch.${branch.name}`]).catch(() => {});
        }
      } catch (error) {
        throw new Error(
          l10n.t(
            "Deleted {0} branches before stopping: {1}",
            deleted,
            error instanceof Error ? error.message : String(error)
          ),
          { cause: error }
        );
      }
      return;
    }
    case "bisectStart": {
      await requireIdle(git);
      await requireClean(git);
      const [head, good, bad] = await Promise.all([
        resolveCommit(git, "HEAD"),
        resolveCommit(git, action.good),
        resolveCommit(git, action.bad)
      ]);
      if (head !== action.expectedHead) {
        throw new Error(l10n.t("The checkout changed. Review the bisect range again."));
      }
      if (good === bad) {
        throw new Error(l10n.t("Choose different good and bad commits."));
      }
      await runGit(git, ["bisect", "start", bad, good, "--"], binary, {
        ...process.env,
        LC_ALL: "C"
      });
      return;
    }
    case "bisectMark": {
      const current = await loadBisect(git);
      if (!current || current.id !== action.state.id) {
        throw new Error(l10n.t("The bisect session changed. Refresh its status."));
      }
      if ((await loadOperation(git)) !== null) {
        throw new Error(l10n.t("Finish the Git operation in progress before continuing bisect."));
      }
      await requireClean(git);
      if (action.mark !== "reset" && (current.firstBad || current.ambiguous)) {
        throw new Error(
          l10n.t("This bisect is complete. Reset it to return to the original checkout.")
        );
      }
      const mark =
        action.mark === "good" || action.mark === "bad" ? current.terms[action.mark] : action.mark;
      try {
        await runGit(git, ["bisect", mark], binary, { ...process.env, LC_ALL: "C" });
      } catch (error) {
        if (!(await loadBisect(git))?.ambiguous) {
          throw error;
        }
      }
      return;
    }
  }
}
