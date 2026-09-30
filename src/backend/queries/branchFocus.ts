import type { SimpleGit } from "simple-git";

import { branchListRef } from "@/backend/utils/refs";

/** Classify the requested commits against real ancestry, including parents outside the page. */
export async function loadBranchFocus(git: SimpleGit, branch: string, hashes: string[]) {
  // Exact ref lookup also rejects revision expressions such as main~1.
  const tip = (await git.raw(["show-ref", "--verify", "--hash", branchListRef(branch)])).trim();
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
