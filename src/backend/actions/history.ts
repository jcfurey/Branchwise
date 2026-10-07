import {
  chmod,
  lstat,
  mkdtemp,
  readFile,
  readlink,
  rm,
  symlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { requireIdle, withRecoveryEditor } from "@/backend/actions/rebase";
import type { RepositoryEffect } from "@/backend/actions/repository";
import { gitClientFactory } from "@/backend/gitClient";
import { commitDetails } from "@/backend/queries/commitDetails";
import { loadBatchPlan, loadStagedPlan, sourceFile } from "@/backend/queries/history";
import { loadWorkspace, submoduleLinks } from "@/backend/queries/workspace";
import type { HistoryAction, RestoreBackup } from "@/backend/types";
import { checkedWorktreePath, fileSnapshot, repoFile } from "@/backend/utils/history";
import { readBlob, runGit, writeBlob } from "@/backend/utils/runGit";
import { abbrevCommit } from "@/backend/utils/string";
import { requireBranchName, requireCurrentBranch, resolveCommit } from "@/backend/utils/validation";

/**
 * Keep the destination's current contents as a Git object before a restore replaces them, byte
 * for byte and without filters, unless the file is missing or already holds the source.
 */
async function backupFile(
  git: SimpleGit,
  file: string,
  source: { mode: string; blob: string }
): Promise<Omit<RestoreBackup, "path" | "after"> | null> {
  const destination = await checkedWorktreePath(git, file);
  const stat = await lstat(destination).catch(() => null);
  if (stat === null) {
    return null;
  }
  const symlinked = stat.isSymbolicLink();
  const content = symlinked
    ? Buffer.from(await readlink(destination))
    : await readFile(destination);
  const blob = await writeBlob(git, content);
  const mode = symlinked ? "120000" : stat.mode & 0o111 ? "100755" : "100644";
  return blob === source.blob && mode === source.mode
    ? null
    : { blob, mode: stat.mode, symlink: symlinked };
}

export async function runHistoryAction(
  git: SimpleGit,
  action: HistoryAction,
  binary: string
): Promise<RepositoryEffect> {
  switch (action.kind) {
    case "previewFileRestore": {
      const { plan } = action;
      const file = await sourceFile(git, plan.source, plan.sourcePath);
      if ((await fileSnapshot(git, plan.destination)) !== plan.snapshot) {
        throw new Error(l10n.t("The file changed. Preview the restore again."));
      }
      const destination = await checkedWorktreePath(git, plan.destination);
      return {
        kind: "restoreDiff",
        hash: file.hash,
        sourcePath: plan.sourcePath,
        destination,
        exists: await lstat(destination).then(
          () => true,
          () => false
        )
      };
    }
    case "viewRangeFile":
      return {
        kind: "diff",
        left: action.left === null ? null : await resolveCommit(git, action.left),
        right: action.right === null ? null : await resolveCommit(git, action.right),
        before: repoFile(action.before),
        after: repoFile(action.after)
      };
    case "viewCommitChanges": {
      const hash = await resolveCommit(git, action.hash);
      const { commitDetails: details } = await commitDetails(git, {
        commitHash: hash,
        dateType: "Author Date"
      });
      if (details === null) {
        throw new Error(l10n.t("Unable to read the changes of commit {0}.", abbrevCommit(hash)));
      }
      return {
        kind: "changes",
        title: l10n.t("Changes in {0}", abbrevCommit(hash)),
        // As one file's diff opens: the old path at the first parent beside the new path at the
        // commit, so an added or deleted file compares with an empty side.
        files: details.fileChanges.map((change) => ({
          left: `${hash}^`,
          right: hash,
          before: change.oldFilePath,
          after: change.newFilePath
        }))
      };
    }
    case "viewRangeChanges": {
      const [base, right] = await Promise.all([
        resolveCommit(git, action.base),
        resolveCommit(git, action.right)
      ]);
      return {
        kind: "changes",
        title: `${abbrevCommit(base)} ↔ ${abbrevCommit(right)}`,
        // As the comparison opens each file: an added file has no left side, a deleted one no right.
        files: action.files.map((file) => ({
          left: file.status === "A" ? null : base,
          right: file.status === "D" ? null : right,
          before: repoFile(file.before),
          after: repoFile(file.after)
        }))
      };
    }
    case "viewHistoricalFile":
      return {
        kind: "historicalFile",
        hash: (await sourceFile(git, action.hash, action.path)).hash,
        path: repoFile(action.path)
      };
    case "recoverBranch":
      await requireBranchName(git, action.name);
      await git.raw(["branch", "--no-track", action.name, await resolveCommit(git, action.hash)]);
      return;
    case "submodule": {
      await requireIdle(git);
      const selected = (await submoduleLinks(git)).find((item) => item.path === action.path);
      if (!selected || selected.recorded !== action.recorded) {
        throw new Error(
          l10n.t("The recorded submodule revision changed. Refresh the workspace overview.")
        );
      }
      repoFile(selected.path);
      if (action.operation !== "sync") {
        const root = (await git.raw(["rev-parse", "--show-toplevel"])).replace(/\n$/, "");
        const children = await loadWorkspace([path.join(root, selected.path)], binary);
        await Promise.all(
          children
            .filter((entry) => entry.initialized)
            .map((entry) => requireIdle(gitClientFactory(entry.path, binary).getInstance()))
        );
      }
      const args =
        action.operation === "sync"
          ? ["sync", "--recursive"]
          : ["update", "--init", "--recursive", "--checkout"];
      await runGit(git, ["submodule", ...args, "--", selected.path], binary);
      return;
    }
    case "restoreFile": {
      await requireIdle(git);
      const { plan } = action;
      const file = await sourceFile(git, plan.source, plan.sourcePath);
      if ((await fileSnapshot(git, plan.destination)) !== plan.snapshot) {
        throw new Error(
          l10n.t("The file or its staged version changed. Preview the restore again.")
        );
      }
      const backup = await backupFile(git, plan.destination, file);
      const directory = await mkdtemp(path.join(os.tmpdir(), "branchwise-restore-"));
      const env = { ...process.env, GIT_INDEX_FILE: path.join(directory, "index") };
      try {
        // A private index lets Git apply file modes, symlinks and checkout filters
        // to a renamed destination without changing the user's staged content.
        await runGit(git, ["read-tree", "--empty"], binary, env);
        await runGit(
          git,
          [
            "update-index",
            "--add",
            "--cacheinfo",
            file.mode,
            file.blob,
            repoFile(plan.destination)
          ],
          binary,
          env
        );
        await runGit(
          git,
          ["checkout-index", "--force", "--", repoFile(plan.destination)],
          binary,
          env
        );
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
      return {
        kind: "restored",
        backup: backup && {
          ...backup,
          path: repoFile(plan.destination),
          after: await fileSnapshot(git, plan.destination)
        }
      };
    }
    case "undoRestore": {
      await requireIdle(git);
      const { backup } = action;
      if ((await fileSnapshot(git, backup.path)) !== backup.after) {
        throw new Error(
          l10n.t(
            "The file changed after the restore, so Undo would lose those changes. Its previous contents are Git object {0}.",
            backup.blob
          )
        );
      }
      const destination = await checkedWorktreePath(git, backup.path);
      const content = await readBlob(git, backup.blob);
      await rm(destination, { force: true });
      if (backup.symlink) {
        await symlink(content.toString(), destination);
      } else {
        await writeFile(destination, content, { mode: backup.mode & 0o777 });
        await chmod(destination, backup.mode & 0o777);
      }
      return;
    }
    case "fixup": {
      await requireIdle(git);
      const current = await loadStagedPlan(git, action.plan.target);
      if (current.head !== action.plan.head || current.tree !== action.plan.tree) {
        throw new Error(
          l10n.t("HEAD or the staged changes changed. Preview the fixup commit again.")
        );
      }
      await runGit(git, ["commit", "--fixup=" + current.target], binary);
      return;
    }
    case "batch": {
      await requireIdle(git);
      await requireCurrentBranch(git, action.plan.branch, action.plan.head);
      if (!(await git.status()).isClean()) {
        throw new Error(l10n.t("Commit or stash your changes before applying commits."));
      }
      const current = await loadBatchPlan(
        git,
        action.plan.entries.map((entry) => entry.hash)
      );
      const merges = current.entries.filter((entry) => entry.parentHashes.length > 1);
      if (
        merges.length > 0 &&
        (!Number.isSafeInteger(action.mainline) ||
          action.mainline < 1 ||
          merges.some((entry) => entry.parentHashes.length < action.mainline))
      ) {
        throw new Error(l10n.t("Choose a valid mainline parent for the selected merge commits."));
      }
      await withRecoveryEditor(
        git,
        [
          action.operation,
          "--no-edit",
          ...(merges.length > 0 ? ["--mainline", String(action.mainline)] : []),
          ...current.entries.map((entry) => entry.hash)
        ],
        binary
      );
      return;
    }
  }
}
