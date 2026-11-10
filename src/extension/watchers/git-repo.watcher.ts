import { realpath } from "node:fs/promises";
import path from "node:path";

import * as vscode from "vscode";

import { createGit } from "@/backend/gitClient";
import { isRepoWithinPath } from "@/backend/utils/repoPath";
import { readGitWithInput } from "@/backend/utils/runGit";
import { rpcNotify } from "@/extension/rpc/rpc-notify";
import { logger } from "@/extension/util/logger";
import { repositoryReadsRunning } from "@/extension/watchers/repository-reads";

/** Quiet time after the last relevant file event before the graph is told to refresh. */
const REFRESH_DELAY_MS = 250;
/** The longest a steady stream of events can hold back a refresh, from its first event. */
const REFRESH_MAX_WAIT_MS = 2000;
/**
 * The longest a refresh waits, from its first event, for the page to finish reading the
 * repository for the refresh before it. A read that hangs must not stop refreshes for good.
 */
const REFRESH_HOLD_MS = 20_000;
/**
 * The most changed files one refresh asks Git about. With more, the refresh is simply sent: so
 * many changes at once are rarely all build output, and the question would cost as much.
 */
const IGNORE_CHECK_LIMIT = 100;
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

/**
 * Whether the graph can be seen. Behind another tab it is not told of changes: each notification
 * makes the page read the repository again, a round of Git processes for every file saved, and
 * showing the graph refreshes it anyway.
 */
let graphVisible = true;
/** The refreshes waiting to be sent, which hiding the graph drops. */
const waiting = new Set<() => void>();

/** Say whether the graph's panel is showing, as its view state reports. */
export function setGraphVisible(visible: boolean): void {
  graphVisible = visible;
  if (!visible) {
    for (const drop of waiting) {
      drop();
    }
  }
}

/**
 * Whether Git ignores every one of `files`, given from the top of `repo`'s work tree. A change
 * to an ignored file changes nothing the graph shows: not the uncommitted changes, not a ref. A
 * file that matches an ignore pattern but is tracked is not ignored, and Git does not list it.
 * `null` when Git cannot be asked at all, as for a folder that is gone.
 */
function onlyIgnored(repo: string, gitPath: string, files: string[]): Promise<boolean> | null {
  let git;
  try {
    git = createGit(repo, gitPath);
  } catch {
    return null;
  }
  // Git prints the ignored ones of the paths it is given, and exits with 1 when there are none.
  // It runs in the watched folder, which the paths are given from.
  return readGitWithInput(git, ["check-ignore", "-z", "--stdin"], files.join("\0") + "\0", {
    codes: [0, 1],
    cwd: repo
  }).then(
    (output) => {
      const ignored = new Set(output.split("\0"));
      return files.every((file) => ignored.has(file));
    },
    // Unanswered, the refresh goes out: one too many costs less than one too few.
    () => false
  );
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
  /**
   * The work tree files changed since the last refresh, from the top of the work tree, or
   * `null` once something changed that always counts: a file in a Git directory, or too many
   * files to ask Git about.
   */
  let changed: Set<string> | null = new Set();

  const sendRefresh = () => {
    // A refresh makes the page read the repository again, cancelling what it was reading.
    // While it still reads for the last one, this one waits, or steady changes would start
    // the reads over again and again without one of them ever being shown.
    const waited = performance.now() - (firstUnreported ?? performance.now());
    if (repositoryReadsRunning() && waited < REFRESH_HOLD_MS) {
      refresh = setTimeout(sendRefresh, REFRESH_DELAY_MS);
      return;
    }
    refresh = undefined;
    firstUnreported = undefined;
    const files = changed;
    changed = new Set();
    const notify = () => {
      logger.debug(`Sending repo.updated notification: ${repo}`);
      void rpcNotify.notify("repo.updated", { path: repo });
    };
    // A build that writes its output, or a server its log, would otherwise refresh the graph
    // for as long as it runs, a round of Git processes each time, for nothing it shows.
    const ignored =
      files === null || files.size === 0 ? null : onlyIgnored(repo, gitPath, [...files]);
    if (ignored === null) {
      notify();
      return;
    }
    void ignored.then((all) => {
      if (closed) {
        return;
      }
      if (all) {
        logger.debug(`Only ignored files changed, so no refresh: ${repo}`);
      } else {
        notify();
      }
    });
  };
  const dropRefresh = () => {
    clearTimeout(refresh);
    refresh = undefined;
    firstUnreported = undefined;
    changed = new Set();
  };
  waiting.add(dropRefresh);

  /** Watch `base`. `workTree` says that its files are the user's, which Git may ignore. */
  const watch = (base: string, rule: Rule, workTree = false) => {
    const watcher = vscode.workspace.createFileSystemWatcher(
      new vscode.RelativePattern(base, "**/*")
    );
    const listener = (kind: string) => (uri: vscode.Uri) => {
      if (closed || !graphVisible || !counts(rule, base, uri.fsPath) || isMuted(repo)) {
        return;
      }
      logger.debug(`Repository file ${kind}: ${uri.fsPath}`);
      // In a bare repository every file is Git's own, and there is no work tree to ask about.
      const file = workTree && !isGitDir ? relativePath(base, uri.fsPath) : undefined;
      if (file === undefined || changed === null || changed.size >= IGNORE_CHECK_LIMIT) {
        changed = null;
      } else {
        changed.add(file);
      }
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
  watch(repo, (relative) => workTreeRule(relative) && !(isGitDir && isGitLock(relative)), true);
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
      waiting.delete(dropRefresh);
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
 * receives selections. Disposing any lifetime stops selections until the next one starts and
 * removes its watchers. Running actions keep their mutes when the graph is closed and reopened.
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
