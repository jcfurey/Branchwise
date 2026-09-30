import type { SimpleGit } from "simple-git";

/**
 * The full ref of a branch-list entry. Branch lists name remote-tracking branches
 * `remotes/<remote>/<branch>`. A full ref cannot be read as an option, a tag, or a path.
 */
export function branchListRef(branch: string) {
  return branch.startsWith("remotes/") ? `refs/${branch}` : `refs/heads/${branch}`;
}

/**
 * Short names of the branches under `refs/heads/` or `refs/remotes/`. Unlike `git branch`, the
 * output is neither localized nor colored, and it never includes a detached HEAD, an operation in
 * progress, or a symbolic ref such as `origin/HEAD`.
 */
export async function refNames(git: SimpleGit, namespace: "refs/heads/" | "refs/remotes/") {
  const output = await git.raw([
    "for-each-ref",
    "--format=%(if)%(symref)%(then)%(else)%(refname)%(end)",
    namespace
  ]);
  return output
    .split("\n")
    .filter((ref) => ref.startsWith(namespace))
    .map((ref) => ref.slice(namespace.length));
}

/** The checked-out branch, or null for a detached or unborn HEAD. */
export async function currentBranch(git: SimpleGit, branches: readonly string[]) {
  const head = (await git.raw(["symbolic-ref", "--quiet", "HEAD"]).catch(() => "")).trim();
  const name = head.startsWith("refs/heads/") ? head.slice("refs/heads/".length) : null;
  return name !== null && branches.includes(name) ? name : null;
}
