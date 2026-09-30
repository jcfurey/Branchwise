import * as fs from "node:fs";
import * as path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { isRepoWithinPath } from "@/backend/utils/repoPath";
import { selectWatchedRepo, watchGitRepo } from "@/extension/watchers/git-repo.watcher";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";

type Handler = (uri: { fsPath: string }) => void;
const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  watchers: [] as { base: string; change: Handler; create: Handler; delete: Handler }[]
}));
vi.mock("vscode", () => ({
  workspace: {
    createFileSystemWatcher: ({ base }: { base: string }) => {
      const watcher = { base } as (typeof mocks.watchers)[number];
      mocks.watchers.push(watcher);
      return {
        onDidChange: (handler: Handler) => (watcher.change = handler),
        onDidCreate: (handler: Handler) => (watcher.create = handler),
        onDidDelete: (handler: Handler) => (watcher.delete = handler),
        dispose: () => mocks.watchers.splice(mocks.watchers.indexOf(watcher), 1)
      };
    }
  },
  RelativePattern: class {
    constructor(
      public base: string,
      public pattern: string
    ) {}
  },
  Disposable: class {
    constructor(public dispose: () => void) {}
  }
}));
vi.mock("@/extension/rpc/rpc-notify", () => ({ rpcNotify: { notify: mocks.notify } }));
vi.mock("@/extension/util/logger", () => ({ logger: { debug: vi.fn(), warn: vi.fn() } }));

const dirs: string[] = [];
let main: string;
let worktree: string;
let parent: string;
let submodule: string;

beforeAll(() => {
  main = makeRepo();
  worktree = main + "-worktree";
  git(["worktree", "add", "-b", "topic", worktree], main);
  const child = makeRepo();
  parent = makeRepo();
  git(["-c", "protocol.file.allow=always", "submodule", "add", child, "module"], parent);
  git(["commit", "-m", "add module"], parent);
  submodule = path.join(parent, "module");
  dirs.push(main, worktree, child, parent);
});

afterAll(() => {
  for (const dir of dirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

let lifetime: ReturnType<typeof watchGitRepo>;
beforeEach(() => {
  vi.clearAllMocks();
  lifetime = watchGitRepo();
});
afterEach(() => lifetime.dispose());

/** Modification times of every file below `dirs`. */
function snapshot(roots: string[]) {
  const files = new Map<string, number>();
  for (const root of roots) {
    for (const entry of fs.readdirSync(root, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) {
        const file = path.join(entry.parentPath, entry.name);
        files.set(file, fs.statSync(file).mtimeMs);
      }
    }
  }
  return files;
}

/** Commit in `repo` and report each Git file the commit touched to the watchers that cover it. */
async function commitAndReport(repo: string) {
  const gitDirs = [
    gitOutput(["rev-parse", "--absolute-git-dir"], repo),
    path.resolve(repo, gitOutput(["rev-parse", "--git-common-dir"], repo))
  ].map((dir) => fs.realpathSync(dir));
  const before = snapshot(gitDirs);
  await new Promise((resolve) => setTimeout(resolve, 20));
  fs.writeFileSync(path.join(repo, "change.txt"), repo);
  git(["add", "change.txt"], repo);
  git(["commit", "-m", "change"], repo);
  const after = snapshot(gitDirs);
  const touched = [...new Set([...before.keys(), ...after.keys()])].filter(
    (file) => before.get(file) !== after.get(file)
  );
  // None of them is below the work tree, where the previous watcher looked.
  expect(touched.filter((file) => isRepoWithinPath(file, repo))).toEqual([]);
  for (const file of touched) {
    for (const watcher of mocks.watchers) {
      if (isRepoWithinPath(file, watcher.base)) {
        (after.has(file) ? watcher.change : watcher.delete)({ fsPath: file });
      }
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 400));
}

describe("repository watcher", () => {
  // Each case runs Git several times, which can take seconds on a busy Windows runner.
  it.each([
    ["a linked worktree", () => worktree, 3],
    ["a submodule", () => submodule, 2]
  ])(
    "refreshes once for a commit in %s",
    async (_name, repo, watcherCount) => {
      selectWatchedRepo(repo(), "git");
      await vi.waitFor(() => expect(mocks.watchers).toHaveLength(watcherCount), {
        timeout: 10_000
      });
      await commitAndReport(repo());
      expect(mocks.notify.mock.calls).toEqual([["repo.updated", { path: repo() }]]);
    },
    30_000
  );

  it("refreshes for an interrupted merge but not for new objects", async () => {
    selectWatchedRepo(worktree, "git");
    await vi.waitFor(() => expect(mocks.watchers).toHaveLength(3));
    const gitDir = fs.realpathSync(gitOutput(["rev-parse", "--absolute-git-dir"], worktree));
    const common = fs.realpathSync(
      path.resolve(worktree, gitOutput(["rev-parse", "--git-common-dir"], worktree))
    );
    const report = (file: string) => {
      for (const watcher of mocks.watchers) {
        if (isRepoWithinPath(file, watcher.base)) {
          watcher.create({ fsPath: file });
        }
      }
    };
    report(path.join(common, "objects", "ab", "cdef"));
    report(path.join(common, "worktrees", "other", "HEAD"));
    report(path.join(common, "HEAD"));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mocks.notify).not.toHaveBeenCalled();
    report(path.join(gitDir, "MERGE_HEAD"));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(mocks.notify).toHaveBeenCalledOnce();
  });

  it("does not add Git directory watchers for a repository that is no longer selected", async () => {
    selectWatchedRepo(worktree, "git");
    selectWatchedRepo(main, "git");
    await vi.waitFor(() => expect(mocks.watchers).toHaveLength(2));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(mocks.watchers.map((watcher) => watcher.base)).toEqual([
      main,
      fs.realpathSync(path.join(main, ".git"))
    ]);
  });
});
