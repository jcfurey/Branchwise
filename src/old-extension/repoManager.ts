import { access } from "node:fs/promises";

import type { ExtensionState } from "@/old-extension/extensionState";
import type { GitRepoSet, GitRepoState } from "@/types";

/** The saved view state of every repository, for the life of the extension. */
export type RepoManager = {
  /** A new object with every record, keyed by repository path in ascending order. */
  getRepos: () => GitRepoSet;
  /** Forget the repositories whose folders are gone, and resolve to their paths. */
  pruneMissing: () => Promise<string[]>;
  /** Keep `state` itself as the record of `repo`. */
  setRepoState: (repo: string, state: GitRepoState) => void;
  /**
   * Hide exactly `names`, sorted and without repeats. Returns the new record, or undefined when
   * the saved list already reads the same.
   */
  updateHiddenRemotes: (repo: string, names: string[]) => GitRepoState | undefined;
};

/**
 * Only an error saying that the path, or a folder on the way to it, does not exist proves that a
 * repository is gone. A denied or unavailable drive may come back, so its records stay.
 */
const GONE = new Set(["ENOENT", "ENOTDIR"]);

async function isGone(folder: string): Promise<boolean> {
  try {
    await access(folder);
    return false;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    return code !== undefined && GONE.has(code);
  }
}

/**
 * Keep the records that `extensionState` holds, reading its storage once and writing every change
 * straight back. Records are compared by identity elsewhere, so a record is replaced by a new
 * object when it changes and otherwise kept as it is.
 */
export function createRepoManager(extensionState: ExtensionState): RepoManager {
  // Insertion order is the order in which repositories were first saved.
  const records = new Map(Object.entries(extensionState.getRepos()));

  const persist = () => extensionState.saveRepos(Object.fromEntries(records));

  const setRepoState = (repo: string, state: GitRepoState) => {
    records.set(repo, state);
    persist();
  };

  return {
    getRepos: () => {
      const sorted = [...records].toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      return Object.fromEntries(sorted);
    },

    pruneMissing: async () => {
      const folders = [...records.keys()];
      const gone = await Promise.all(folders.map(isGone));
      const removed = folders.filter((_, index) => gone[index]);
      if (removed.length > 0) {
        for (const folder of removed) {
          records.delete(folder);
        }
        persist();
      }
      return removed;
    },

    setRepoState,

    updateHiddenRemotes: (repo, names) => {
      const wanted = [...new Set(names)].toSorted();
      const saved = records.get(repo);
      const current = saved?.hiddenRemotes ?? [];
      if (current.length === wanted.length && current.every((name, i) => name === wanted[i])) {
        return undefined;
      }
      const record: GitRepoState = { ...(saved ?? { columnWidths: null }), hiddenRemotes: wanted };
      setRepoState(repo, record);
      return record;
    }
  };
}
