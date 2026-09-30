import { realpath } from "node:fs/promises";
import path from "node:path";

import * as vscode from "vscode";

import { createGit } from "@/backend/gitClient";
import { isRepoWithinPath } from "@/backend/utils/repoPath";
import { rpcNotify } from "@/extension/rpc/rpc-notify";
import { logger } from "@/extension/util/logger";

/** Quiet time after the last relevant file event before the graph is told to refresh. */
const REFRESH_DELAY_MS = 250;
/** The longest a steady stream of events can hold back a refresh, from its first event. */
const REFRESH_MAX_WAIT_MS = 2000;
/** How long an action's trailing file events stay ignored after the action ends. */
const QUIET_PERIOD_MS = 1500;

/** Decides whether a file, given relative to a watched directory with `/` separators, counts. */
type Rule = (relative: string) => boolean;

const below = (relative: string, dir: string) => relative === dir || relative.startsWith(`${dir}/`);

/**
 * The work tree counts except for its own `.git` entry, which the Git directory rules cover.
 * Lock files count here: `yarn.lock` or `Cargo.lock` are the user's files, not Git's.
 */
const workTreeRule: Rule = (relative) => !below(relative, ".git");

/**
 * What each worktree keeps for itself: the checked-out commit, the index, its own settings and
 * operations in progress, such as a merge, a rebase, a cherry-pick sequence or a bisection.
 */
const WORKTREE_STATE =
  /^(?:HEAD|index|config\.worktree|MERGE_HEAD|CHERRY_PICK_HEAD|REVERT_HEAD|BISECT_[A-Z_]+)$|^(?:rebase-merge|rebase-apply|sequencer)(?:\/|$)/;
/** What all worktrees share: branches and tags, remote and upstream settings, shallow history. */
const SHARED_STATE = /^(?:config|packed-refs|shallow)$|^refs(?:\/|$)/;
/** Refs a linked worktree keeps in its own directory, such as `refs/bisect/…`. */
const WORKTREE_REFS = /^refs(?:\/|$)/;

/**
 * Git writes `<name>.lock` and renames it over `<name>`, so in a Git directory only the rename
 * changes anything.
 */
const isGitLock = (relative: string) => relative.endsWith(".lock");

/** A rule for a Git directory: a file counts when one of `patterns` names it. */
const gitDirRule =
  (...patterns: RegExp[]): Rule =>
  (relative) =>
    !isGitLock(relative) && patterns.some((pattern) => pattern.test(relative));

const ownGitDirRule = gitDirRule(WORKTREE_STATE, SHARED_STATE);
const linkedGitDirRule = gitDirRule(WORKTREE_STATE, WORKTREE_REFS);
const commonDirRule = gitDirRule(SHARED_STATE);

/** `file` relative to `base` with `/` separators, or undefined when it is not inside `base`. */
function relativePath(base: string, file: string): string | undefined {
  const relative = path.relative(base, file).split(path.sep).join("/");
  return relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)
    ? undefined
    : relative;
}

function counts(rule: Rule, base: string, file: string): boolean {
  const relative = relativePath(base, file);
  return relative !== undefined && rule(relative);
}

/** Git actions the extension is running, by the repository path each was muted with. */
const runningActions = new Map<string, number>();
/** When the quiet period after each repository's last action ends, on `performance.now()`. */
const quietUntil = new Map<string, number>();

/** Whether an action runs, or has just ended, in `repo`, a repository inside it or around it. */
function isMuted(repo: string): boolean {
  const now = performance.now();
  for (const [other, end] of quietUntil) {
    if (end <= now) {
      quietUntil.delete(other);
    }
  }
  const overlaps = (other: string) =>
    isRepoWithinPath(repo, other) || isRepoWithinPath(other, repo);
  return [...runningActions.keys(), ...quietUntil.keys()].some(overlaps);
}

/**
 * Stop reacting to file events in `repo`, and in repositories that contain it or that it
 * contains, while the extension runs a Git action there. The graph refreshes by itself afterwards.
 */
export function muteGitRepoWatcher(repo: string): void {
  runningActions.set(repo, (runningActions.get(repo) ?? 0) + 1);
}

/**
 * End one action muted with the same `repo` string. After the last one, events stay ignored for
 * a quiet period, because the file system reports the action's writes a little later.
 */
export function unmuteGitRepoWatcher(repo: string): void {
  const running = runningActions.get(repo);
  if (running === undefined) {
    return;
  }
  if (running > 1) {
    runningActions.set(repo, running - 1);
    return;
  }
  runningActions.delete(repo);
  quietUntil.set(repo, performance.now() + QUIET_PERIOD_MS);
}

/**
 * The repository's Git directory and common directory as real paths, and the real path of `repo`
 * itself. They differ only in a linked worktree, where the common directory is the main
 * repository's. Git prints the common directory relative to `repo` when it is inside it.
 */
async function findGitDirs(repo: string, gitPath: string) {
  const git = createGit(repo, gitPath);
  const resolve = async (option: string) =>
    realpath(path.resolve(repo, (await git.raw(["rev-parse", option])).replace(/\n$/, "")));
  const [gitDir, commonDir, workTree] = await Promise.all([
    resolve("--absolute-git-dir"),
    resolve("--git-common-dir"),
    realpath(repo)
  ]);
  return { gitDir, commonDir, workTree };
}

/** Watchers on one selected repository, and the refresh they have scheduled. */
interface RepoWatch {
  readonly repo: string;
  dispose(): void;
}

function watchRepo(repo: string, gitPath: string): RepoWatch {
  const watchers: vscode.FileSystemWatcher[] = [];
  let closed = false;
  let refresh: ReturnType<typeof setTimeout> | undefined;
  /** When the oldest event the graph has not been told about arrived. */
  let firstUnreported: number | undefined;

  const sendRefresh = () => {
    refresh = undefined;
    firstUnreported = undefined;
    logger.debug(`Sending repo.updated notification: ${repo}`);
    void rpcNotify.notify("repo.updated", { path: repo });
  };

  const watch = (base: string, rule: Rule) => {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(base, "**/*")
    );
    const listener = (kind: string) => (uri: vscode.Uri) => {
      if (closed || !counts(rule, base, uri.fsPath) || isMuted(repo)) {
        return;
      }
      logger.debug(`Repository file ${kind}: ${uri.fsPath}`);
      const now = performance.now();
      firstUnreported ??= now;
      const deadline = firstUnreported + REFRESH_MAX_WAIT_MS;
      clearTimeout(refresh);
      refresh = setTimeout(sendRefresh, Math.max(0, Math.min(REFRESH_DELAY_MS, deadline - now)));
    };
    watcher.onDidCreate(listener("created"));
    watcher.onDidChange(listener("changed"));
    watcher.onDidDelete(listener("deleted"));
    watchers.push(watcher);
  };

  /** Whether `repo` is itself a Git directory, as a bare repository is. */
  let isGitDir = false;
  // The work tree is watched at once and as given, so events echo the path the graph selected.
  watch(repo, (relative) => workTreeRule(relative) && !(isGitDir && isGitLock(relative)));
  void findGitDirs(repo, gitPath).then(
    ({ gitDir, commonDir, workTree }) => {
      if (closed) {
        return;
      }
      const dirs: [string, Rule][] =
        gitDir === commonDir
          ? [[gitDir, ownGitDirRule]]
          : [
              [gitDir, linkedGitDirRule],
              [commonDir, commonDirRule]
            ];
      for (const [dir, rule] of dirs) {
        if (dir === workTree) {
          // Watched once already: its files count by the work tree rule, but its locks are Git's.
          isGitDir = true;
        } else {
          watch(dir, rule);
        }
      }
    },
    (error: unknown) => logger.warn(`Unable to find the Git directory of ${repo}`, error)
  );

  return {
    repo,
    dispose() {
      closed = true;
      clearTimeout(refresh);
      for (const watcher of watchers.splice(0)) {
        watcher.dispose();
      }
    }
  };
}

/** The watcher lifetime that `selectWatchedRepo` retargets, and what it watches now. */
let receiver: { watch: RepoWatch | undefined } | undefined;

/**
 * Start a lifetime in which `selectWatchedRepo` picks the repository to watch. The newest lifetime
 * receives selections. Disposing any lifetime stops selections until the next one starts, forgets
 * every mute, and removes the watchers this lifetime created.
 */
export function watchGitRepo(): vscode.Disposable {
  const lifetime: { watch: RepoWatch | undefined } = { watch: undefined };
  receiver = lifetime;
  let disposed = false;
  return {
    dispose() {
      if (disposed) {
        return;
      }
      disposed = true;
      receiver = undefined;
      runningActions.clear();
      quietUntil.clear();
      lifetime.watch?.dispose();
      lifetime.watch = undefined;
    }
  };
}

/**
 * Watch `repo` in place of the repository watched before, and tell the graph when its work tree,
 * HEAD, index, refs or an operation in progress changes. Nothing happens without a lifetime, or
 * when `repo` is already watched. `gitPath` runs the one lookup of its Git directories.
 */
export function selectWatchedRepo(repo: string, gitPath: string): void {
  const lifetime = receiver;
  if (lifetime === undefined || lifetime.watch?.repo === repo) {
    return;
  }
  lifetime.watch?.dispose();
  lifetime.watch = watchRepo(repo, gitPath);
}
