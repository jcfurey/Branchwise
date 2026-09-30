import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

export async function requireRemote(git: SimpleGit, remote: string) {
  if (!(await git.getRemotes()).some((entry) => entry.name === remote)) {
    throw new Error(l10n.t("Remote '{0}' is not configured for this repository.", remote));
  }
}

/**
 * Whether Git accepts `ref` as a full ref name. `check-ref-format` reports an invalid name only
 * through its exit status, which simple-git ignores when stderr is empty, so ask for
 * `--normalize`, which prints the name only when it is valid. A name that Git would rewrite,
 * such as `a//b`, is refused too.
 */
async function isValidRef(git: SimpleGit, ref: string) {
  const normalized = await git.raw(["check-ref-format", "--normalize", ref]).catch(() => "");
  return normalized.replace(/\n$/, "") === ref;
}

/** Throw `message` unless `name` is a valid ref below `namespace`, such as `refs/heads/`. */
export async function requireRefName(
  git: SimpleGit,
  namespace: string,
  name: string,
  message: string
) {
  if (!name || name.startsWith("-") || !(await isValidRef(git, namespace + name))) {
    throw new Error(message);
  }
}

export async function requireBranchName(git: SimpleGit, branch: string) {
  // `git branch` also refuses the name HEAD.
  await requireRefName(
    git,
    "refs/heads/",
    branch === "HEAD" ? "" : branch,
    l10n.t("Enter a valid branch name.")
  );
}

export async function requireTagName(git: SimpleGit, tag: string) {
  await requireRefName(git, "refs/tags/", tag, l10n.t("Enter a valid tag name."));
}

export async function resolveCommit(git: SimpleGit, ref: string) {
  return (await git.raw(["rev-parse", "--verify", "--end-of-options", `${ref}^{commit}`])).trim();
}

export async function requireCurrentBranch(git: SimpleGit, branch: string, expectedHead?: string) {
  await requireBranchName(git, branch);
  const head = (await git.raw(["symbolic-ref", "--quiet", "HEAD"])).trim();
  if (head !== `refs/heads/${branch}`) {
    throw new Error(l10n.t("Check out branch '{0}' before running this operation.", branch));
  }
  if (expectedHead !== undefined && (await resolveCommit(git, "HEAD")) !== expectedHead) {
    throw new Error(l10n.t("The branch changed. Refresh the graph and try again."));
  }
}

export async function splitRemoteRef(git: SimpleGit, ref: string) {
  const remote = (await git.getRemotes())
    .map((item) => item.name)
    .filter((name) => ref.startsWith(name + "/"))
    .toSorted((a, b) => b.length - a.length)[0];
  if (remote === undefined) {
    throw new Error(l10n.t("The remote for '{0}' is no longer configured.", ref));
  }
  const branch = ref.slice(remote.length + 1);
  await requireBranchName(git, branch);
  return { remote, branch };
}
