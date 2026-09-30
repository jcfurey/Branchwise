import { realpath } from "node:fs/promises";

import { createGit } from "@/backend/gitClient";
import { normalizeRepoPath } from "@/backend/utils/repoPath";

/**
 * The real top level of the work tree containing `directory`, as a repository key. Null outside a
 * work tree (including a Git directory or a bare repository), and whenever Git cannot answer.
 */
export async function workTreeRoot(directory: string, gitPath: string): Promise<string | null> {
  try {
    const output = await createGit(directory, gitPath).raw(["rev-parse", "--show-toplevel"]);
    // Only Git's terminator; a folder name may itself end in a newline.
    const topLevel = output.replace(/\n$/, "");
    return topLevel === "" ? null : normalizeRepoPath(await realpath(topLevel));
  } catch {
    return null;
  }
}

/**
 * The work trees of every initialized submodule of the superproject containing `repoPath`,
 * nested ones included, in Git's traversal order. Empty whenever Git cannot list them all.
 */
export async function getSubmodulePaths(repoPath: string, gitPath: string): Promise<string[]> {
  try {
    // NUL is the one byte a path cannot contain.
    const output = await createGit(repoPath, gitPath).raw([
      "submodule",
      "foreach",
      "--quiet",
      "--recursive",
      'printf "%s\\0" "$toplevel/$sm_path"'
    ]);
    return output
      .split("\0")
      .filter((entry) => entry !== "")
      .map(normalizeRepoPath);
  } catch {
    return [];
  }
}
