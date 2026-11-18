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

/** The local branch name, including an unborn branch, or an empty string for detached HEAD. */
export async function headBranchName(git: SimpleGit) {
  const ref = (await git.raw(["symbolic-ref", "--quiet", "HEAD"])).trim();
  return ref.startsWith("refs/heads/") ? ref.slice("refs/heads/".length) : "";
}

/** The checked-out branch, or null for a detached or unborn HEAD. */
export async function currentBranch(git: SimpleGit, branches: readonly string[]) {
  const name = await headBranchName(git).catch(() => "");
  return branches.includes(name) ? name : null;
}
