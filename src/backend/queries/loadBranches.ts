import type { SimpleGit } from "simple-git";

import type { QueryResult } from "@/backend/types";
import { currentBranch, refNames } from "@/backend/utils/refs";
import { remoteVisibility } from "@/backend/utils/remoteVisibility";

type BranchListRequest = {
  showRemoteBranches: boolean;
  hiddenRemotes?: string[];
  /** Returned unchanged for the view. */
  hard: boolean;
  /** Returned unchanged; `git` is already bound to the repository. */
  repo: string;
  /** Unused: `git` already runs the configured executable. */
  gitPath: string;
};

/**
 * The branch list of the dropdown and filter: the checked-out branch first, then the other local
 * branches, then the visible remote-tracking branches as `remotes/<remote>/<branch>`, each group
 * in Git's ref-name order whatever `branch.sort` says. Symbolic refs are left out. A HEAD that is
 * detached, unborn or unreadable gives a null `head`; any other failed read rejects.
 */
export async function loadBranches(
  git: SimpleGit,
  input: BranchListRequest
): Promise<QueryResult<"loadBranches">> {
  const [local, remote, { excluded }] = await Promise.all([
    refNames(git, "refs/heads/"),
    input.showRemoteBranches ? refNames(git, "refs/remotes/") : [],
    // The graph hides the same refs, so the list and the graph agree.
    remoteVisibility(git, input)
  ]);
  const head = await currentBranch(git, local);
  const visibleRemote = remote
    .filter((name) => !excluded.has(name))
    .map((name) => `remotes/${name}`);
  // A local branch named `remotes/<name>` reads the same as a remote-tracking entry; list it once.
  const branches = new Set(head === null ? [] : [head]);
  for (const name of [...local, ...visibleRemote]) {
    branches.add(name);
  }
  // The caller spreads this over its own fields, so it must carry no other keys.
  return { repo: input.repo, branches: [...branches], head, hard: input.hard, isRepo: true };
}
