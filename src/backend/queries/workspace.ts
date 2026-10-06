import { stat } from "node:fs/promises";
import path from "node:path";

import type { SimpleGit } from "simple-git";

import { gitClientFactory } from "@/backend/gitClient";
import { loadOperationKind } from "@/backend/queries/repository";
import type { WorkspaceEntry } from "@/backend/types";
import { isRepoWithinPath, normalizeRepoPath } from "@/backend/utils/repoPath";

export async function submoduleLinks(git: SimpleGit) {
  const [index, tree] = await Promise.all([
    git.raw(["ls-files", "--stage", "-z"]),
    git.raw(["ls-tree", "-r", "-z", "HEAD"]).catch(() => "")
  ]);
  const committed = new Map<string, string>();
  for (const entry of tree.split("\0")) {
    const match = /^160000 commit ([a-f0-9]+)\t([\s\S]+)$/.exec(entry);
    if (match) {
      committed.set(match[2]!, match[1]!);
    }
  }
  return index.split("\0").flatMap((entry) => {
    const match = /^160000 ([a-f0-9]+) 0\t([\s\S]+)$/.exec(entry);
    return match
      ? [{ path: match[2]!, recorded: match[1]!, committed: committed.get(match[2]!) ?? null }]
      : [];
  });
}

/**
 * What needs attention in a repository besides its changed files: which branches have an
 * upstream, how many other branches are ahead of theirs, how many stashes there are and when it
 * last fetched. One ref listing answers the branch questions; the stash count needs a second Git
 * process only when there is a stash.
 */
async function attention(git: SimpleGit, directory: string) {
  const [refs, remotes, fetched] = await Promise.all([
    git.raw([
      "for-each-ref",
      "--format=%(refname)%00%(HEAD)%00%(upstream:short)%00%(upstream:track)",
      "refs/heads/",
      "refs/stash"
    ]),
    git.raw(["remote"]),
    // FETCH_HEAD is rewritten by every fetch, even one that brings nothing new.
    stat(path.join(directory, "FETCH_HEAD")).then(
      (file) => Math.floor(file.mtimeMs / 1000),
      () => null
    )
  ]);
  let upstream: string | null = null;
  let aheadBranches = 0;
  let stashed = false;
  for (const line of refs.split("\n").filter(Boolean)) {
    const [name = "", head = "", tracked = "", track = ""] = line.split("\0");
    if (name === "refs/stash") {
      stashed = true;
    } else if (head === "*") {
      upstream = tracked || null;
    } else if (/ahead \d+/.test(track)) {
      aheadBranches++;
    }
  }
  const stashes = stashed
    ? Number((await git.raw(["rev-list", "--walk-reflogs", "--count", "refs/stash"])).trim())
    : 0;
  return {
    upstream,
    aheadBranches,
    stashes,
    remotes: remotes.split("\n").filter(Boolean).length,
    fetched
  };
}

/**
 * The repositories `repos`, their submodules and their submodules' submodules, each with its
 * parent: the superproject of a submodule, otherwise the innermost listed repository holding it.
 * Bound concurrency keeps a workspace with many submodules responsive.
 */
export async function loadWorkspace(
  repos: string[],
  binary: string,
  signal?: AbortSignal
): Promise<WorkspaceEntry[]> {
  const queue = [...new Set(repos.map(normalizeRepoPath))];
  const visited = new Set<string>();
  const entries = new Map<string, WorkspaceEntry>();
  const parents = new Map<
    string,
    Pick<WorkspaceEntry, "parent" | "submodulePath" | "recorded" | "committed">
  >();
  while (queue.length > 0) {
    signal?.throwIfAborted();
    const batch = queue.splice(0, 4).filter((repo) => !visited.has(repo));
    for (const repo of batch) {
      visited.add(repo);
    }
    // Discover children from this batch before scheduling the next bounded batch.
    // eslint-disable-next-line no-await-in-loop
    const results = await Promise.all(
      batch.map(async (repo) => {
        const entry: WorkspaceEntry = {
          path: repo,
          parent: null,
          submodulePath: null,
          recorded: null,
          committed: null,
          head: null,
          branch: "",
          dirty: 0,
          ahead: 0,
          behind: 0,
          initialized: false,
          error: null,
          operation: null,
          conflicts: 0,
          stashes: 0,
          detached: false,
          upstream: null,
          aheadBranches: 0,
          remotes: 0,
          fetched: null
        };
        try {
          const git = gitClientFactory(repo, binary, signal).getInstance();
          const [top = "", directory = ""] = (
            await git.raw(["rev-parse", "--show-toplevel", "--absolute-git-dir"])
          ).split("\n");
          if (normalizeRepoPath(top) !== repo) {
            return { entry, children: [] };
          }
          entry.initialized = true;
          const [status, head, children, operation, extra] = await Promise.all([
            git.status(),
            git.raw(["rev-parse", "--verify", "--quiet", "HEAD"]),
            submoduleLinks(git),
            loadOperationKind(git, directory),
            attention(git, directory)
          ]);
          Object.assign(entry, extra, {
            head: head.trim() || null,
            branch: status.detached ? "" : (status.current ?? ""),
            dirty: status.files.length,
            ahead: status.ahead,
            behind: status.behind,
            operation,
            conflicts: status.conflicted.length,
            detached: status.detached
          });
          return { entry, children };
        } catch (error) {
          signal?.throwIfAborted();
          entry.error = error instanceof Error ? error.message : String(error);
          return { entry, children: [] };
        }
      })
    );
    for (const { entry, children } of results) {
      entries.set(entry.path, entry);
      for (const child of children) {
        const childPath = normalizeRepoPath(path.join(entry.path, child.path));
        parents.set(childPath, {
          parent: entry.path,
          submodulePath: child.path,
          recorded: child.recorded,
          committed: child.committed
        });
        if (!visited.has(childPath) && !queue.includes(childPath)) {
          queue.push(childPath);
        }
      }
    }
  }
  const list = [...entries.values()].map((entry) =>
    Object.assign(entry, parents.get(entry.path), {
      error: !entry.initialized && parents.has(entry.path) ? null : entry.error
    })
  );
  // A repository cloned inside another one, rather than added as its submodule, goes under the
  // nearest repository whose folder holds it.
  const paths = list.map((entry) => entry.path);
  for (const entry of list) {
    if (entry.parent === null) {
      entry.parent = enclosingRepo(entry.path, paths);
    }
  }
  return list.toSorted((a, b) => a.path.localeCompare(b.path));
}

/** The innermost of `repos` whose folder holds `repo`, or null. */
function enclosingRepo(repo: string, repos: string[]): string | null {
  let best: string | null = null;
  for (const candidate of repos) {
    if (
      candidate !== repo &&
      isRepoWithinPath(repo, candidate) &&
      (best === null || candidate.length > best.length)
    ) {
      best = candidate;
    }
  }
  return best;
}
