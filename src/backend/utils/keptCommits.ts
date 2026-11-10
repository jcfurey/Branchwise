import type { SimpleGit } from "simple-git";

/**
 * Whether `commit` or a commit it descends from is in no branch, tag or remote-tracking branch,
 * so that only a HEAD pointing there keeps it within reach. Moving such a HEAD away, or removing
 * the worktree it belongs to, leaves those commits with no name to find them by.
 */
export async function keptOnlyByHead(git: SimpleGit, commit: string) {
  const lonely = await git
    .raw(["rev-list", "--max-count=1", commit, "--not", "--branches", "--tags", "--remotes"])
    .catch(() => "");
  return lonely.trim() !== "";
}
