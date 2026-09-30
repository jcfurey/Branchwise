import { rm } from "node:fs/promises";
import path from "node:path";

import type { ExtensionContext, Memento } from "vscode";

import { logger } from "@/extension/util/logger";
import type { GitRepoSet } from "@/types";

/** Workspace-state key of the per-repository records. Earlier releases wrote the same key. */
const REPO_STATES_KEY = "repoStates";
/** Global-state key of the avatar cache that releases before avatars were dropped kept. */
const AVATAR_CACHE_KEY = "avatarCache";

/** Whether `value` is an object literal as JSON produces it, rather than null, a list or a scalar. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  // Compared by shape rather than identity, so objects made in another realm count too.
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === null || Object.getPrototypeOf(prototype) === null;
}

/** Wait for a storage write in the background, logging a failure instead of leaving it unhandled. */
function settle(write: Thenable<void>, what: string) {
  void Promise.resolve(write).catch((error: unknown) => {
    logger.warn(`Unable to ${what}`, error);
  });
}

/**
 * The extension's saved data: one record per repository in workspace storage. Creating it also
 * clears what earlier releases cached for avatars.
 */
export class ExtensionState {
  private readonly workspaceState: Memento;

  constructor(context: ExtensionContext) {
    this.workspaceState = context.workspaceState;

    const { globalState } = context;
    if (globalState.get(AVATAR_CACHE_KEY) !== undefined) {
      settle(globalState.update(AVATAR_CACHE_KEY, undefined), "clear the old avatar cache");
    }
    // Activation does not wait for the folder to go, and there is nothing to do if it cannot.
    void rm(path.join(context.globalStoragePath, "avatars"), {
      recursive: true,
      force: true
    }).catch(() => {});
  }

  /**
   * The saved records by repository path. An entry that is not an object, which only damaged
   * storage can hold, is left out; the others are returned as stored.
   */
  getRepos(): GitRepoSet {
    const stored: unknown = this.workspaceState.get(REPO_STATES_KEY, {});
    if (!isPlainObject(stored)) {
      return {};
    }
    const entries = Object.entries(stored);
    if (entries.every(([, record]) => isPlainObject(record))) {
      return stored as GitRepoSet;
    }
    return Object.fromEntries(entries.filter(([, record]) => isPlainObject(record))) as GitRepoSet;
  }

  saveRepos(gitRepoSet: GitRepoSet): void {
    settle(this.workspaceState.update(REPO_STATES_KEY, gitRepoSet), "save the repository records");
  }
}
