import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import { realpath } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { PARSED_OUTPUT_ARGS } from "@/backend/gitClient";
import { selectWatchedRepo, watchGitRepo } from "@/extension/watchers/git-repo.watcher";

type FileHandler = (uri: { fsPath: string }) => void;

const probe = vi.hoisted(() => ({
  watchers: [] as {
    base: string;
    /** The pattern, and any arguments after it. */
    request: unknown[];
    onChange?: FileHandler;
    live: boolean;
    disposals: number;
  }[],
  sent: [] as unknown[][],
  debug: vi.fn(),
  warn: vi.fn()
}));
vi.mock("vscode", () => ({
  workspace: {
    createFileSystemWatcher: (pattern: { base: string; glob: string }, ...rest: unknown[]) => {
      const record: (typeof probe.watchers)[number] = {
        base: pattern.base,
        request: [pattern.glob, ...rest],
        live: true,
        disposals: 0
      };
      probe.watchers.push(record);
      return {
        onDidCreate: () => undefined,
        onDidChange: (handler: FileHandler) => {
          record.onChange = handler;
        },
        onDidDelete: () => undefined,
        dispose: () => {
          record.live = false;
          record.disposals++;
        }
      };
    }
  },
  RelativePattern: class {
    base: string;
    glob: string;
    constructor(base: string, glob: string) {
      this.base = base;
      this.glob = glob;
    }
  }
}));
vi.mock("@/extension/rpc/rpc-notify", () => ({
  rpcNotify: { notify: (...args: unknown[]) => void probe.sent.push(args) }
}));
vi.mock("@/extension/util/logger", () => ({ logger: { debug: probe.debug, warn: probe.warn } }));
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, realpath: vi.fn(actual.realpath) };
});

const realpathSpy = vi.mocked(realpath);
const skipOnWindows = it.skipIf(process.platform === "win32");

function runGit(cwd: string, ...args: string[]) {
  execFileSync("git", args, { cwd, stdio: "pipe" });
}

/** A repository with one commit, at `dir`. */
function createRepo(dir: string) {
  fs.mkdirSync(dir, { recursive: true });
  runGit(dir, "init", "-q");
  fs.writeFileSync(path.join(dir, "readme.txt"), "watched");
  runGit(dir, "add", ".");
  runGit(dir, "commit", "-q", "-m", "start");
  return dir;
}

let root: string;
const repos = { main: "", linked: "", separate: "", separateGitDir: "", bare: "", link: "" };
/** A stand-in Git executable that appends its working directory and arguments to `gitCalls`. */
let wrapper: string;
let gitCalls: string;

beforeAll(() => {
  // The watcher resolves paths as the system does, which on Windows expands short folder names.
  root = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "bw-repo-watch-")));
  repos.main = createRepo(path.join(root, "main"));
  fs.mkdirSync(path.join(repos.main, "sub"));
  repos.linked = path.join(root, "linked");
  runGit(repos.main, "worktree", "add", "-q", "-b", "side", repos.linked);
  repos.separate = path.join(root, "separate");
  repos.separateGitDir = path.join(root, "separate.git");
  runGit(root, "init", "-q", "--separate-git-dir", repos.separateGitDir, repos.separate);
  repos.bare = path.join(root, "bare.git");
  runGit(root, "clone", "-q", "--bare", repos.main, repos.bare);
  if (process.platform !== "win32") {
    repos.link = path.join(root, "link");
    fs.symlinkSync(repos.main, repos.link);
  }
  gitCalls = path.join(root, "git-calls.log");
  wrapper = path.join(root, "git-wrapper");
  fs.writeFileSync(
    wrapper,
    `#!/bin/sh\nprintf '%s\\t%s\\n' "$(pwd -P)" "$*" >> '${gitCalls}'\nexec git "$@"\n`,
    { mode: 0o755 }
  );
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

let lifetime: ReturnType<typeof watchGitRepo>;
beforeEach(() => {
  probe.watchers.length = 0;
  probe.sent = [];
  vi.clearAllMocks();
  fs.rmSync(gitCalls, { force: true });
  lifetime = watchGitRepo();
});
afterEach(() => {
  lifetime.dispose();
  vi.useRealTimers();
});

const liveBases = () => probe.watchers.filter(({ live }) => live).map(({ base }) => base);
const loggedGitCalls = () =>
  fs.existsSync(gitCalls) ? fs.readFileSync(gitCalls, "utf8").split("\n").filter(Boolean) : [];

/** Wait until the lookup has resolved every path it asked for, and a little longer. */
async function lookupDone(paths = 3) {
  await vi.waitFor(() => expect(realpathSpy.mock.calls.length).toBeGreaterThanOrEqual(paths));
  await Promise.allSettled(realpathSpy.mock.results.map(({ value }) => value));
  await new Promise((resolve) => setTimeout(resolve, 50));
}

/** Report a change of `relative` below the watcher on `base`, and let any refresh go out. */
function reportChange(base: string, relative: string) {
  const watcher = probe.watchers.find((candidate) => candidate.live && candidate.base === base);
  watcher!.onChange!({ fsPath: path.join(base, relative) });
  vi.advanceTimersByTime(250);
  const refreshed = probe.sent.length;
  probe.sent = [];
  return refreshed;
}

describe("the Git directory lookup", () => {
  skipOnWindows("asks the configured Git twice, in the repository", async () => {
    selectWatchedRepo(repos.main, wrapper);
    await vi.waitFor(() => expect(liveBases()).toHaveLength(2));
    const prefix = PARSED_OUTPUT_ARGS.join(" ");
    expect(loggedGitCalls().toSorted()).toEqual(
      [
        `${repos.main}\t${prefix} rev-parse --absolute-git-dir`,
        `${repos.main}\t${prefix} rev-parse --git-common-dir`
      ].toSorted()
    );
  });

  skipOnWindows(
    "runs nothing and changes nothing when the same repository is selected",
    async () => {
      selectWatchedRepo(repos.main, wrapper);
      await vi.waitFor(() => expect(liveBases()).toHaveLength(2));
      selectWatchedRepo(repos.main, wrapper);
      selectWatchedRepo(repos.main, "/no/such/git");
      await new Promise((resolve) => setTimeout(resolve, 300));
      expect(loggedGitCalls()).toHaveLength(2);
      expect(probe.watchers.map(({ disposals }) => disposals)).toEqual([0, 0]);
      expect(probe.warn).not.toHaveBeenCalled();
    }
  );

  it.each([
    ["a directory outside any repository", () => fs.mkdtempSync(path.join(root, "plain-"))],
    ["a directory that does not exist", () => path.join(root, "missing")]
  ])("keeps only the work tree watcher for %s and warns once", async (_name, dir) => {
    const repo = dir();
    expect(() => selectWatchedRepo(repo, "git")).not.toThrow();
    await vi.waitFor(() => expect(probe.warn).toHaveBeenCalled());
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(probe.warn).toHaveBeenCalledExactlyOnceWith(
      `Unable to find the Git directory of ${repo}`,
      expect.any(Error)
    );
    expect(liveBases()).toEqual([repo]);
  });

  it("warns when Git cannot be started", async () => {
    selectWatchedRepo(repos.main, path.join(root, "no-git-here"));
    await vi.waitFor(() => expect(probe.warn).toHaveBeenCalledOnce());
    expect(liveBases()).toEqual([repos.main]);
  });

  it("adds nothing once the lifetime has ended", async () => {
    selectWatchedRepo(repos.main, "git");
    lifetime.dispose();
    await lookupDone();
    expect(liveBases()).toEqual([]);
  });
});

const real = (file: string) => fs.realpathSync.native(file);

describe("watched directories", () => {
  it("watches each directory recursively, for every kind of event", async () => {
    selectWatchedRepo(repos.main, "git");
    await lookupDone();
    expect(probe.watchers.map(({ request }) => request)).toEqual([["**/*"], ["**/*"]]);
  });

  it.each([
    ["an ordinary repository", () => [repos.main, real(path.join(repos.main, ".git"))]],
    [
      "a linked worktree",
      () => [
        repos.linked,
        real(path.join(repos.main, ".git", "worktrees", "linked")),
        real(path.join(repos.main, ".git"))
      ]
    ],
    [
      "a subdirectory of a work tree",
      () => [path.join(repos.main, "sub"), real(path.join(repos.main, ".git"))]
    ],
    ["a separate Git directory", () => [repos.separate, real(repos.separateGitDir)]],
    // The bare repository is its own Git directory, so it is watched once.
    ["a bare repository", () => [repos.bare]]
  ])("watches %s", async (_name, expected) => {
    const [repo] = expected();
    selectWatchedRepo(repo!, "git");
    await lookupDone();
    expect(liveBases()).toEqual(expected());
  });

  skipOnWindows(
    "watches a symlinked repository at its link, and its real Git directory",
    async () => {
      selectWatchedRepo(repos.link, "git");
      await lookupDone();
      const gitDir = real(path.join(repos.main, ".git"));
      expect(liveBases()).toEqual([repos.link, gitDir]);
      vi.useFakeTimers();
      probe.watchers[1]!.onChange!({ fsPath: path.join(gitDir, "HEAD") });
      vi.advanceTimersByTime(250);
      // The graph knows the repository by the path it selected.
      expect(probe.sent).toEqual([["repo.updated", { path: repos.link }]]);
    }
  );

  it("counts each event in a bare repository once, by the work tree rule", async () => {
    selectWatchedRepo(repos.bare, "git");
    await lookupDone();
    vi.useFakeTimers();
    expect(reportChange(repos.bare, "objects/ab/cdef")).toBe(1);
    expect(
      probe.debug.mock.calls.filter(([line]) => String(line).startsWith("Repository file"))
    ).toHaveLength(1);
    // Every file in it is Git's, so its lock files are ignored as in any Git directory.
    expect(reportChange(repos.bare, "refs/heads/main.lock")).toBe(0);
    expect(reportChange(repos.bare, "packed-refs.lock")).toBe(0);
  });
});

/**
 * Report each file alone below `base`, and expect a refresh for exactly the `counted` ones. The
 * comparison names every file whose outcome differs.
 */
function expectCounted(base: string, counted: string[], ignored: string[]) {
  const outcomes = Object.fromEntries(
    [...counted, ...ignored].map((file) => [file, reportChange(base, file)])
  );
  expect(outcomes).toEqual(
    Object.fromEntries([...counted.map((file) => [file, 1]), ...ignored.map((file) => [file, 0])])
  );
}

describe("which files count", () => {
  it("in an ordinary repository", async () => {
    selectWatchedRepo(repos.main, "git");
    await lookupDone();
    vi.useFakeTimers();
    const gitDir = fs.realpathSync.native(path.join(repos.main, ".git"));

    expectCounted(
      repos.main,
      [
        "notes.txt",
        "",
        ".gitignore",
        ".github/x",
        "sub/.git/index",
        "node_modules/x/y",
        "Cargo.lock",
        "web/yarn.lock"
      ],
      [".git", ".git/index", ".git/index.lock", "..", "../outside"]
    );
    expectCounted(
      gitDir,
      [
        "HEAD",
        "index",
        "refs",
        "refs/heads/x",
        "packed-refs",
        "config",
        "config.worktree",
        "shallow",
        "MERGE_HEAD",
        "CHERRY_PICK_HEAD",
        "REVERT_HEAD",
        "BISECT_LOG",
        "BISECT_HEAD",
        "BISECT_EXPECTED_REV",
        "rebase-merge",
        "rebase-merge/done",
        "rebase-apply/0001",
        "sequencer/todo"
      ],
      [
        "",
        "..",
        "../readme.txt",
        "ORIG_HEAD",
        "FETCH_HEAD",
        "REBASE_HEAD",
        "AUTO_MERGE",
        "MERGE_MSG",
        "MERGE_MODE",
        "SQUASH_MSG",
        "COMMIT_EDITMSG",
        "logs/HEAD",
        "objects/ab/cdef",
        "refsx",
        "refs/heads/x.lock",
        "packed-refs.lock",
        "config.lock",
        "index.lock",
        "HEAD.lock",
        "shallow.lock",
        "config.worktree.lock",
        "BISECT_",
        "BISECT_log",
        "sequencerx",
        "modules/x/HEAD",
        "worktrees/x/HEAD",
        "hooks/pre-commit",
        "info/exclude",
        "description",
        "head"
      ]
    );
  });

  it("in a linked worktree", async () => {
    selectWatchedRepo(repos.linked, "git");
    await lookupDone();
    vi.useFakeTimers();
    const ownDir = fs.realpathSync.native(path.join(repos.main, ".git", "worktrees", "linked"));
    const commonDir = fs.realpathSync.native(path.join(repos.main, ".git"));

    expectCounted(
      ownDir,
      [
        "HEAD",
        "index",
        "MERGE_HEAD",
        "rebase-merge/done",
        "refs/bisect/bad",
        "refs/worktree/x",
        "config.worktree"
      ],
      // Git keeps `shallow`, `config` and `packed-refs` in the common directory only.
      [
        "config",
        "packed-refs",
        "shallow",
        "logs/HEAD",
        "ORIG_HEAD",
        "refs/bisect/bad.lock",
        "config.worktree.lock",
        ".."
      ]
    );
    // The common directory's own HEAD, index and settings belong to the main worktree.
    expectCounted(
      commonDir,
      ["refs/heads/x", "packed-refs", "config", "shallow"],
      [
        "HEAD",
        "index",
        "MERGE_HEAD",
        "config.worktree",
        "worktrees/linked/HEAD",
        "objects/aa/bb",
        "refs/heads/x.lock"
      ]
    );
  });
});
