import path from "node:path";

import type { SimpleGit } from "simple-git";

import { gitClientFactory } from "@/backend/gitClient";
import type { WorkspaceEntry } from "@/backend/types";
import { normalizeRepoPath } from "@/backend/utils/repoPath";

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

/** Bound concurrency keeps a workspace with many submodules responsive. */
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
          error: null
        };
        try {
          const git = gitClientFactory(repo, binary, signal).getInstance();
          const top = normalizeRepoPath(
            (await git.raw(["rev-parse", "--show-toplevel"])).replace(/\n$/, "")
          );
          if (top !== repo) {
            return { entry, children: [] };
          }
          entry.initialized = true;
          const [status, head, children] = await Promise.all([
            git.status(),
            git.raw(["rev-parse", "--verify", "--quiet", "HEAD"]),
            submoduleLinks(git)
          ]);
          Object.assign(entry, {
            head: head.trim() || null,
            branch: status.detached ? "" : (status.current ?? ""),
            dirty: status.files.length,
            ahead: status.ahead,
            behind: status.behind
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
  return [...entries.values()]
    .map((entry) =>
      Object.assign(entry, parents.get(entry.path), {
        error: !entry.initialized && parents.has(entry.path) ? null : entry.error
      })
    )
    .toSorted((a, b) => a.path.localeCompare(b.path));
}
