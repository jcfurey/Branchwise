import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { gitProcessOf } from "@/backend/gitClient";
import type { ContainingRefs, RefDetails } from "@/backend/types";
import { remoteVisibility, type RemoteVisibility } from "@/backend/utils/remoteVisibility";

const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * The branches that contain `hash`, less those the graph hides: remote-tracking branches of hidden
 * remotes, or all of them while remote branches are off, and branches matching the hidden-branch
 * patterns other than the checked-out one and the one chosen. Symbolic refs such as `origin/HEAD`
 * are left out, as the branch list leaves them out.
 */
async function containingBranches(git: SimpleGit, hash: string, visibility: RemoteVisibility) {
  const showRemotes = visibility.showRemoteBranches !== false;
  const [listed, { excluded, hiddenBranches }] = await Promise.all([
    git.raw([
      "for-each-ref",
      `--contains=${hash}`,
      "--format=%(if)%(symref)%(then)%(else)%(HEAD)%(refname)%(end)",
      "refs/heads/",
      ...(showRemotes ? ["refs/remotes/"] : [])
    ]),
    remoteVisibility(git, visibility)
  ]);
  let head: string | undefined;
  const local: string[] = [];
  const remote: string[] = [];
  // Not trimmed: `%(HEAD)` is `*` for the checked-out branch and a space for any other.
  for (const line of listed.split(/\r?\n/)) {
    const ref = line.slice(1);
    if (ref.startsWith("refs/heads/")) {
      const name = ref.slice("refs/heads/".length);
      if (line.startsWith("*")) {
        head = name;
      } else if (!hiddenBranches.has(name)) {
        local.push(name);
      }
    } else if (ref.startsWith("refs/remotes/")) {
      const name = ref.slice("refs/remotes/".length);
      if (!excluded.has(name)) {
        remote.push(`remotes/${name}`);
      }
    }
  }
  return [...(head === undefined ? [] : [head]), ...local, ...remote];
}

/**
 * The tags that contain `hash`. `creatordate` is the tagger's date for an annotated tag and the
 * commit's date for a lightweight one, so the first is the earliest release with the commit.
 */
async function containingTags(git: SimpleGit, hash: string): Promise<RefDetails[]> {
  const listed = await git.raw([
    "for-each-ref",
    `--contains=${hash}`,
    "--sort=creatordate",
    "--format=%(refname:lstrip=2)%00%(objectname)%00%(*objectname)",
    "refs/tags/"
  ]);
  return listed
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [name = "", object = "", peeled = ""] = line.split("\0");
      // An annotated tag names its commit through `*objectname`; a lightweight one is the commit.
      return { name, hash: peeled || object };
    });
}

/**
 * The nearest tag reachable from the commit's first parent, with its commit. Git fails for a
 * root commit and when no tag is reachable; both mean there is nothing to follow.
 */
async function precedingTag(git: SimpleGit, hash: string): Promise<RefDetails | null> {
  try {
    const name = (await git.raw(["describe", "--tags", "--abbrev=0", `${hash}^`])).trim();
    if (name === "") {
      return null;
    }
    const commit = (
      await git.raw(["rev-parse", "--verify", "--quiet", `refs/tags/${name}^{commit}`])
    ).trim();
    return { name, hash: commit };
  } catch (error) {
    // A cancelled request must not read as a commit without a tag before it.
    if (gitProcessOf(git)?.abort?.aborted === true) {
      throw error;
    }
    return null;
  }
}

/**
 * Where a commit has gone since: the branches and tags that contain it, and the tag it follows.
 * `--contains` walks history for every ref, which can take a while in a repository with
 * thousands of them, so the page asks for this separately, after the details are shown, and
 * cancels it when they close. Nothing on disk changes.
 */
export async function loadContainingRefs(
  git: SimpleGit,
  hash: string,
  visibility: RemoteVisibility
): Promise<ContainingRefs> {
  // A full ID only: anything else could be read as an option or name many commits.
  if (!OBJECT_ID.test(hash)) {
    throw new Error(l10n.t("{0} is not a full commit ID.", hash));
  }
  const [branches, tags, follows] = await Promise.all([
    containingBranches(git, hash, visibility),
    containingTags(git, hash),
    precedingTag(git, hash)
  ]);
  return { branches, tags, follows };
}
