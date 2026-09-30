import { signal } from "@preact/signals";

import { repoListStore } from "@/webview/lib/stores/repo-list.store";

/** Why the newest scan failed, for the page to show with Retry; `undefined` when it has not. */
export const repoListError = signal<string | undefined>(undefined);

/** Calls are numbered as they start, so that only the newest one reports. */
let newestCall = 0;

/**
 * Scan the workspace for repositories. The error is cleared, and the scan requested, before this
 * returns. The promise never rejects: a failure of this, the newest call, becomes the error.
 */
export async function loadRepoList(): Promise<void> {
  const call = ++newestCall;
  repoListError.value = undefined;
  try {
    await repoListStore.load();
  } catch (error: unknown) {
    if (call === newestCall) {
      repoListError.value = error instanceof Error ? error.message : String(error);
    }
  }
}
