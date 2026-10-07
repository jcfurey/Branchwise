import type { SimpleGit } from "simple-git";

import { branchListRef } from "@/backend/utils/refs";

/**
 * Classify the requested commits against real ancestry, including parents outside the page.
 * With `tag`, `branch` is a tag's name, and the history is that of the commit the tag names.
 */
export async function loadBranchFocus(
  git: SimpleGit,
  branch: string,
  hashes: string[],
  tag = false
) {
  // Exact ref lookup also rejects revision expressions such as main~1.
  const ref = tag ? `refs/tags/${branch}` : branchListRef(branch);
  const target = (await git.raw(["show-ref", "--verify", "--hash", ref])).trim();
  // An annotated tag names a tag object; its history is that of the commit it points to.
  const tip = tag
    ? (await git.raw(["rev-parse", "--verify", `${target}^{commit}`])).trim()
    : target;
  const wanted = new Set(hashes);
  const [firstParents, ancestors] = await Promise.all([
    git.raw(["rev-list", "--first-parent", tip, "--"]),
    git.raw(["rev-list", tip, "--"])
  ]);
  const direct = firstParents
    .trim()
    .split("\n")
    .filter((hash) => wanted.has(hash));
  const directSet = new Set(direct);
  const merged = ancestors
    .trim()
    .split("\n")
    .filter((hash) => wanted.has(hash) && !directSet.has(hash));
  return { tip, direct, merged };
}
