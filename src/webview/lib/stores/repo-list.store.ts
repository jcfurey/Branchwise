import { signal } from "@preact/signals";

import type { GitRepo } from "@/types";
import { rpcClient } from "@/webview/lib/rpc/rpc-client";

// This module is part of an import cycle through the RPC client, so its top level creates
// state only; the client is used inside `load`.

/** The repositories the picker offers, absent until the first scan answers. */
const repos = signal<Array<GitRepo> | undefined>(undefined);

/** Scans are numbered as they start. */
let scansStarted = 0;
/** The number of the scan whose answer was stored last. An older answer arriving later loses. */
let newestAnswered = 0;

/**
 * The repositories of the workspace. A plain object whose members are looked up when called, so
 * that tests can replace them with spies.
 */
export const repoListStore = {
  /** The current list. Read in a render or effect, it subscribes that reader to changes. */
  get(): Array<GitRepo> | undefined {
    return repos.value;
  },

  /**
   * Ask the extension to scan the workspace, and keep its answer unless a newer scan has already
   * answered. The request is posted before this returns. A failed scan rejects, and leaves the
   * list as it was.
   */
  async load(): Promise<Array<GitRepo>> {
    const scan = ++scansStarted;
    const { repos: found } = await rpcClient.request("repo.scan", null);
    if (scan > newestAnswered) {
      newestAnswered = scan;
      repos.value = found;
    }
    return found;
  },

  /**
   * Offer a repository the extension selected, which a scan may not have found. It takes the
   * place of an entry with the same path, and the list is sorted by path again.
   */
  add(repo: GitRepo): void {
    const others = (repos.peek() ?? []).filter((listed) => listed.path !== repo.path);
    repos.value = [...others, repo].toSorted((a, b) => a.path.localeCompare(b.path));
  }
};
