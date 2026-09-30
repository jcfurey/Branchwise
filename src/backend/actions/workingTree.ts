import { lstat, readlink } from "node:fs/promises";
import { join } from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import type { RepositoryEffect } from "@/backend/actions/repository";
import { loadWorkingTree } from "@/backend/queries/workingTree";
import type { WorkingTreeGroup } from "@/backend/types";
import { checkedWorktreePath, literalPath } from "@/backend/utils/history";

/**
 * Resolve index and HEAD contents to immutable blobs so reopened diffs cannot be stale. The
 * index is named by stage: `:<path>` would read a file named `0:foo` as stage 0 of `foo`.
 */
async function objectAt(git: SimpleGit, revision: string, file: string) {
  return (await git.raw(["rev-parse", "--verify", `${revision || ":0"}:${file}`])).trim();
}

export async function viewWorkingTreeFile(
  git: SimpleGit,
  path: string,
  group: WorkingTreeGroup
): Promise<RepositoryEffect> {
  const file = (await loadWorkingTree(git)).find(
    (entry) => entry.path === path && entry.group === group
  );
  if (!file) {
    throw new Error(
      l10n.t("The file's changes moved or disappeared. Refresh the graph and try again.")
    );
  }
  if (file.repository) {
    const root = (await git.raw(["rev-parse", "--show-toplevel"])).replace(/\n$/, "");
    return { kind: "nestedRepository", path: join(root, file.path.replace(/\/$/, "")) };
  }
  const destination = await checkedWorktreePath(git, file.path);
  if (group === "conflicts") {
    return { kind: "conflict", path: destination, status: file.status };
  }
  const staged = group === "staged";
  const added = group === "untracked" || file.status === "A";
  const [indexEntry, headEntry, stat] = await Promise.all([
    git.raw(["ls-files", "--stage", "-z", "--", literalPath(file.path)]),
    staged && !added ? git.raw(["ls-tree", "-z", "HEAD", "--", literalPath(file.oldPath)]) : "",
    lstat(destination).catch(() => null)
  ]);
  // An untracked symlink has no Git diff yet. Show its target, without opening the target file.
  if (group === "untracked" && stat?.isSymbolicLink()) {
    const target = await readlink(destination);
    return {
      kind: "document",
      text: `diff --git ${JSON.stringify("a/" + file.path)} ${JSON.stringify("b/" + file.path)}\nnew file mode 120000\n--- /dev/null\n+++ ${JSON.stringify("b/" + file.path)}\n@@ -0,0 +1 @@\n+${target}\n\\ No newline at end of file\n`
    };
  }
  // Gitlinks and symlinks need Git's patch instead of opening their target as a text file.
  if (
    /^(160000|120000) /.test(indexEntry) ||
    /^(160000|120000) /.test(headEntry) ||
    stat?.isDirectory() ||
    stat?.isSymbolicLink()
  ) {
    return {
      kind: "document",
      text: await git.raw([
        "diff",
        ...(staged ? ["--cached"] : []),
        "--no-ext-diff",
        "--no-textconv",
        "--submodule=short",
        "--",
        literalPath(file.oldPath),
        literalPath(file.path)
      ])
    };
  }
  const left = added ? null : await objectAt(git, staged ? "HEAD" : "", file.oldPath);
  const right = staged && file.status !== "D" ? await objectAt(git, "", file.path) : null;
  return {
    kind: "workingTreeDiff",
    before: file.oldPath,
    after: file.path,
    left,
    right,
    workingPath: !staged && file.status !== "D" ? destination : null,
    staged
  };
}
