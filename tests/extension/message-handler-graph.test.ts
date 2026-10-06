import { beforeEach, describe, expect, it, vi } from "vitest";

import { gitClientFactory } from "@/backend/gitClient";
import { commitDetails } from "@/backend/queries/commitDetails";
import { loadBranches } from "@/backend/queries/loadBranches";
import { loadCommits } from "@/backend/queries/loadCommits";
import { loadRemotes } from "@/backend/queries/loadRemotes";
import type { QueryResult } from "@/backend/types";
import { logger } from "@/extension/util/logger";
import { selectWatchedRepo } from "@/extension/watchers/git-repo.watcher";
import type { GitRepoSet } from "@/types";

import { legacyPage } from "@tests/extension/legacy-page";

const commands = vi.hoisted(() => ({ executeCommand: vi.fn() }));

vi.mock("vscode", () => ({
  l10n: {
    t: (message: string, ...values: string[]) =>
      values.reduce((sentence, value, index) => sentence.replace(`{${index}}`, value), message)
  },
  commands,
  Uri: { from: (parts: object) => parts }
}));
vi.mock("@/backend/gitClient", () => ({
  gitClientFactory: vi.fn((repo: string, _gitPath: string, signal?: AbortSignal) => ({
    getInstance: () => ({ repo, signal })
  }))
}));
vi.mock("@/backend/queries/loadCommits", () => ({ loadCommits: vi.fn() }));
vi.mock("@/backend/queries/loadBranches", () => ({ loadBranches: vi.fn() }));
vi.mock("@/backend/queries/commitDetails", () => ({ commitDetails: vi.fn() }));
vi.mock("@/backend/queries/loadRemotes", () => ({ loadRemotes: vi.fn() }));
vi.mock("@/extension/watchers/git-repo.watcher", () => ({
  selectWatchedRepo: vi.fn(),
  muteGitRepoWatcher: vi.fn(),
  unmuteGitRepoWatcher: vi.fn()
}));
vi.mock("@/extension/util/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

const HASH = "0123456789abcdef0123456789abcdef01234567";

type Commits = Omit<QueryResult<"loadCommits">, "repo" | "branchName">;
const noCommits: Commits = {
  commits: [],
  head: null,
  moreCommitsAvailable: false,
  hard: true,
  uncommittedChanges: 0
};

const settings = {
  gitPath: () => "/opt/git",
  dateType: () => "Commit Date" as const,
  showSignatures: () => false,
  showUncommittedChanges: () => false
};

const commitsOf = (repo: string, requestId: string) => ({
  command: "loadCommits" as const,
  repo,
  requestId,
  branchName: "main",
  maxCommits: 50,
  showRemoteBranches: true,
  hard: true
});

const branchesOf = (repo: string, requestId: string) => ({
  command: "loadBranches" as const,
  repo,
  requestId,
  showRemoteBranches: false,
  hard: true
});

/** The signal a graph read got through its client, for the call-th read of `query`. */
function signalOf(query: typeof loadCommits | typeof loadBranches, call = 0) {
  const client = vi.mocked(query).mock.calls[call]?.[0] as unknown as { signal: AbortSignal };
  return client.signal;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(loadCommits).mockResolvedValue(noCommits);
});

describe("graph reads", () => {
  it("pass the request's options and the current settings to the backend", async () => {
    vi.mocked(loadBranches).mockResolvedValue({
      repo: "/r",
      branches: [],
      head: null,
      hard: true,
      isRepo: true
    });
    vi.mocked(commitDetails).mockResolvedValue({ commitDetails: null });
    const page = legacyPage({ config: settings });

    await page.send(commitsOf("/r", "c"));
    await page.send({ ...branchesOf("/r", "b"), hiddenRemotes: ["up"] });
    await page.send({ command: "commitDetails", repo: "/r", requestId: "d", commitHash: HASH });

    expect(vi.mocked(loadCommits).mock.calls[0]?.[1]).toStrictEqual({
      branchName: "main",
      maxCommits: 50,
      hiddenRemotes: [],
      hiddenBranchPatterns: [],
      showRemoteBranches: true,
      hard: true,
      dateType: "Commit Date",
      showUncommittedChanges: false,
      showSignatures: false
    });
    expect(vi.mocked(loadBranches).mock.calls[0]?.[1]).toStrictEqual({
      showRemoteBranches: false,
      hiddenRemotes: ["up"],
      hard: true,
      repo: "/r",
      gitPath: "/opt/git"
    });
    expect(vi.mocked(commitDetails).mock.calls[0]?.[1]).toStrictEqual({
      commitHash: HASH,
      dateType: "Commit Date"
    });
    expect(gitClientFactory).toHaveBeenCalledWith("/r", "/opt/git", expect.any(AbortSignal));
  });

  it("stop every kind of read when another repository is read", async () => {
    const branches = Promise.withResolvers<QueryResult<"loadBranches">>();
    vi.mocked(loadBranches).mockReturnValueOnce(branches.promise);
    const page = legacyPage({ config: settings });

    const branchRead = page.send(branchesOf("/one", "b"));
    await page.send(commitsOf("/two", "c"));
    expect(signalOf(loadBranches).aborted).toBe(true);
    branches.resolve({ repo: "/one", branches: ["main"], head: "main", hard: true, isRepo: true });
    await branchRead;

    expect(page.received.map((message) => message.command)).toEqual(["loadCommits"]);
    expect(vi.mocked(selectWatchedRepo).mock.calls).toEqual([
      ["/one", "/opt/git"],
      ["/two", "/opt/git"]
    ]);
  });

  // Decision handler Q6: a watcher that cannot start is logged and does not fail the read.
  it("answer normally when the repository watcher fails to start", async () => {
    const failure = new Error("watch fail");
    vi.mocked(selectWatchedRepo).mockImplementationOnce(() => {
      throw failure;
    });
    const page = legacyPage({ config: settings });

    await page.send(commitsOf("/w", "first"));
    await page.send(commitsOf("/w", "second"));

    expect(page.received).toEqual([
      expect.objectContaining({ command: "loadCommits", requestId: "first" }),
      expect.objectContaining({ command: "loadCommits", requestId: "second" })
    ]);
    expect(selectWatchedRepo).toHaveBeenCalledOnce();
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith(
      "Unable to select repository: /w",
      failure
    );
  });

  // Decision handler Q14: what the request says about itself wins over the backend's fields.
  it("echo the request's own fields over same-named fields of the backend's result", async () => {
    const intruder = { command: "refresh", repo: "/elsewhere", requestId: "stale" };
    vi.mocked(loadCommits).mockResolvedValueOnce({
      ...noCommits,
      ...intruder,
      branchName: "other",
      visibilityKey: "stale"
    } as Commits);
    vi.mocked(loadBranches).mockResolvedValueOnce({
      ...intruder,
      branches: [],
      head: null,
      hard: true,
      isRepo: true,
      visibilityKey: "stale"
    } as QueryResult<"loadBranches">);
    vi.mocked(commitDetails).mockResolvedValueOnce({
      ...intruder,
      commitDetails: null
    } as QueryResult<"commitDetails">);
    vi.mocked(loadRemotes).mockResolvedValueOnce({
      ...intruder,
      remotes: [],
      upstream: null,
      pushRemote: null
    });
    const page = legacyPage({ config: settings });

    await page.send({ ...commitsOf("/r", "c"), visibilityKey: "fresh" });
    await page.send(branchesOf("/r", "b"));
    await page.send({ command: "commitDetails", repo: "/r", requestId: "d", commitHash: HASH });
    await page.send({ command: "loadRemotes", repo: "/r", requestId: "l", branchName: null });

    expect(page.received).toEqual([
      expect.objectContaining({
        command: "loadCommits",
        repo: "/r",
        requestId: "c",
        branchName: "main",
        visibilityKey: "fresh"
      }),
      expect.objectContaining({ command: "loadBranches", repo: "/r", requestId: "b" }),
      expect.objectContaining({ command: "commitDetails", repo: "/r", requestId: "d" }),
      expect.objectContaining({ command: "loadRemotes", repo: "/r", requestId: "l", status: null })
    ]);
    // A request without a key clears the backend's, so nothing stale reaches the page.
    expect(page.received[1]).toHaveProperty("visibilityKey", undefined);
  });
});

describe("selecting a repository", () => {
  it("logs a watcher that fails to start and still sends the saved state", async () => {
    const failure = new Error("watch fail");
    vi.mocked(selectWatchedRepo).mockImplementationOnce(() => {
      throw failure;
    });
    const page = legacyPage();

    await expect(page.send({ command: "selectRepo", repo: "/q" })).resolves.toBeUndefined();

    expect(page.received).toEqual([
      { command: "repoState", repo: "/q", state: { columnWidths: null } }
    ]);
    expect(logger.debug).toHaveBeenCalledExactlyOnceWith(
      "Unable to select repository: /q",
      failure
    );
  });

  it("counts as new once the panel was shown again, stopping the reads still running", async () => {
    const held = Promise.withResolvers<Commits>();
    vi.mocked(loadCommits).mockReturnValueOnce(held.promise);
    const page = legacyPage({ config: settings });

    await page.send({ command: "selectRepo", repo: "/r" });
    const reading = page.send(commitsOf("/r", "held"));
    await page.send({ command: "selectRepo", repo: "/r" });
    expect(signalOf(loadCommits).aborted).toBe(false);

    page.lifetime.onPanelShown();
    expect(signalOf(loadCommits).aborted).toBe(false);
    await page.send({ command: "selectRepo", repo: "/r" });
    expect(signalOf(loadCommits).aborted).toBe(true);
    held.resolve(noCommits);
    await reading;

    expect(vi.mocked(selectWatchedRepo).mock.calls).toEqual([
      ["/r", "/opt/git"],
      ["/r", "/opt/git"]
    ]);
    expect(page.received.map((message) => message.command)).toEqual([
      "repoState",
      "repoState",
      "repoState"
    ]);
  });
});

describe("saving view state", () => {
  it("creates a minimal record for a repository saved for the first time", async () => {
    const setRepoState = vi.fn();
    const page = legacyPage({ repoManager: { getRepos: () => ({}), setRepoState } });

    await page.send({ command: "saveRepoState", repo: "/new", state: {} });

    expect(setRepoState).toHaveBeenCalledExactlyOnceWith("/new", { columnWidths: null });
    expect(page.received).toEqual([]);
  });

  it("stores the sent fields as they are over the saved ones", async () => {
    const saved: GitRepoSet = { "/r": { columnWidths: [1, 2], hiddenRemotes: ["x"] } };
    const setRepoState = vi.fn();
    const page = legacyPage({ repoManager: { getRepos: () => saved, setRepoState } });

    await page.send({
      command: "saveRepoState",
      repo: "/r",
      state: { hiddenRemotes: ["z", "a", "a"] }
    });

    expect(setRepoState).toHaveBeenCalledExactlyOnceWith("/r", {
      columnWidths: [1, 2],
      hiddenRemotes: ["z", "a", "a"]
    });
  });
});

describe("commit diffs", () => {
  it.each([
    ["A", "dir/new.txt", "dir/new.txt", "new.txt (Added by 01234567)"],
    ["D", "old/gone/old.txt", "old/gone/old.txt", "old.txt (Deleted by 01234567)"],
    ["M", "m.txt", "m.txt", "m.txt (01234567^ ↔ 01234567)"],
    ["R", "a/from.txt", "b/to.txt", "to.txt (01234567^ ↔ 01234567)"]
  ])("title a change of type %s after its file", async (type, oldFilePath, newFilePath, title) => {
    commands.executeCommand.mockResolvedValueOnce(undefined);
    const page = legacyPage();

    await page.send({
      command: "viewDiff",
      repo: "/repo",
      commitHash: HASH,
      oldFilePath,
      newFilePath,
      type
    });

    expect(commands.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "vscode.diff",
      expect.objectContaining({ path: oldFilePath, query: `commit=${HASH}%5E&repo=%2Frepo` }),
      expect.objectContaining({ path: newFilePath, query: `commit=${HASH}&repo=%2Frepo` }),
      title,
      { preview: true }
    );
    expect(page.received).toEqual([{ command: "viewDiff", success: true }]);
  });

  it("logs a diff VS Code refused and tells the page", async () => {
    const refusal = new Error("no editor");
    commands.executeCommand.mockRejectedValueOnce(refusal);
    const page = legacyPage();

    await page.send({
      command: "viewDiff",
      repo: "/repo",
      commitHash: HASH,
      oldFilePath: "a",
      newFilePath: "a",
      type: "M"
    });

    expect(logger.error).toHaveBeenCalledExactlyOnceWith(
      "Unable to open the diff of a at 01234567",
      refusal
    );
    expect(page.received).toEqual([{ command: "viewDiff", success: false }]);
  });
});
