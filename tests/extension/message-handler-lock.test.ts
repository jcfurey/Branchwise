import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { pushBranch } from "@/backend/actions/remote";
import { deleteTag } from "@/backend/actions/tag";
import { gitClientFactory } from "@/backend/gitClient";
import { loadRemotes } from "@/backend/queries/loadRemotes";
import { logger } from "@/extension/util/logger";
import { muteGitRepoWatcher, unmuteGitRepoWatcher } from "@/extension/watchers/git-repo.watcher";

import { legacyPage } from "@tests/extension/legacy-page";

vi.mock("vscode", () => ({ l10n: { t: (message: string) => message } }));
// The real client factory, watched: it refuses missing folders as it does in the extension.
vi.mock("@/backend/gitClient", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/backend/gitClient")>();
  return { ...real, gitClientFactory: vi.fn(real.gitClientFactory) };
});
// The folders are not repositories, so actions run without the Safety Net's records.
vi.mock("@/backend/actions/safetyNet", () => ({
  recordedAction: async (_git: unknown, _request: unknown, work: () => Promise<unknown>) => ({
    result: await work(),
    record: null
  })
}));
vi.mock("@/backend/actions/tag", () => ({ addTag: vi.fn(), deleteTag: vi.fn(), pushTag: vi.fn() }));
vi.mock("@/backend/actions/remote", () => ({
  fetchRemote: vi.fn(),
  pullBranch: vi.fn(),
  pushBranch: vi.fn()
}));
vi.mock("@/backend/queries/loadRemotes", () => ({ loadRemotes: vi.fn() }));
vi.mock("@/extension/watchers/git-repo.watcher", () => ({
  selectWatchedRepo: vi.fn(),
  muteGitRepoWatcher: vi.fn(),
  unmuteGitRepoWatcher: vi.fn()
}));
vi.mock("@/extension/util/logger", () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() }
}));

const BUSY = "Another Git operation is running in this repository. Wait for it to finish.";
const CANCELLED = "The Git operation was cancelled.";

let root: string;
let one: string;
let two: string;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(deleteTag).mockResolvedValue(undefined);
  root = mkdtempSync(join(tmpdir(), "branchwise-lock-"));
  one = join(root, "one");
  two = join(root, "two");
  mkdirSync(one);
  mkdirSync(two);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** The abort signal of the Git client made last, which is the one the running action uses. */
function latestSignal(): AbortSignal {
  const signal = vi.mocked(gitClientFactory).mock.lastCall?.[2];
  if (signal === undefined) {
    throw new Error("No client was made with a signal");
  }
  return signal;
}

/** Make the next push wait for `gate`, failing as simple-git does once its signal fires. */
function holdPush(gate: Promise<void>) {
  vi.mocked(pushBranch).mockImplementationOnce(() => {
    const signal = latestSignal();
    return new Promise<void>((resolve, reject) => {
      signal.addEventListener("abort", () => reject(new Error("process killed")), { once: true });
      void gate.then(resolve);
    });
  });
}

const push = (repo: string, requestId: string) => ({
  command: "pushBranch" as const,
  repo,
  requestId,
  branchName: "main",
  remote: "origin",
  remoteBranch: "main",
  setUpstream: false
});

const dropTag = (repo: string, requestId: string) => ({
  command: "deleteTag" as const,
  repo,
  requestId,
  tagName: "v1"
});

describe("cancelling an action", () => {
  it("needs the repository the action runs in", async () => {
    const gate = Promise.withResolvers<void>();
    holdPush(gate.promise);
    const page = legacyPage();

    const pushing = page.send(push(one, "p"));
    const signal = latestSignal();
    await page.send({ command: "cancelAction", repo: two, requestId: "p" });
    expect(signal.aborted).toBe(false);
    await page.send({ command: "cancelAction", repo: one, requestId: "p" });
    expect(signal.aborted).toBe(true);
    await pushing;

    expect(page.received).toEqual([
      { command: "pushBranch", status: CANCELLED, requestId: "p", repo: one }
    ]);
  });

  it("still reports success when the backend finishes despite the cancel", async () => {
    const gate = Promise.withResolvers<void>();
    vi.mocked(pushBranch).mockReturnValueOnce(gate.promise);
    const page = legacyPage();

    const pushing = page.send(push(one, "p"));
    await page.send({ command: "cancelAction", repo: one, requestId: "p" });
    gate.resolve();
    await pushing;

    expect(page.received).toEqual([
      { command: "pushBranch", status: null, requestId: "p", repo: one }
    ]);
  });
});

describe("the repository lock", () => {
  it.each(["success", "failure"])(
    "keeps an action's lock across reopening and releases it after %s",
    async (outcome) => {
      const gate = Promise.withResolvers<void>();
      vi.mocked(pushBranch).mockReturnValueOnce(gate.promise);
      const page = legacyPage();
      const pushing = page.send(push(one, "p"));
      const signal = latestSignal();
      page.lifetime.dispose();
      const reopened = legacyPage();

      try {
        // A new page can reuse an id without cancelling the old page's request.
        await reopened.send({ command: "cancelAction", repo: one, requestId: "p" });
        expect(signal.aborted).toBe(false);
        await reopened.send(dropTag(one + "/", "blocked"));
        expect(reopened.postsOf("deleteTag")).toEqual([
          { command: "deleteTag", status: BUSY, requestId: "blocked", repo: one + "/" }
        ]);
        expect(deleteTag).not.toHaveBeenCalled();
        await reopened.send(dropTag(two, "other"));
        expect(deleteTag).toHaveBeenCalledOnce();
      } finally {
        if (outcome === "success") {
          gate.resolve();
        } else {
          gate.reject(new Error("Push failed"));
        }
        await pushing;
      }

      await reopened.send(dropTag(one, "after"));
      expect(reopened.postsOf("deleteTag").at(-1)).toEqual({
        command: "deleteTag",
        status: null,
        requestId: "after",
        repo: one
      });
      expect(deleteTag).toHaveBeenCalledTimes(2);
      reopened.lifetime.dispose();
    }
  );

  it("answers an action in a missing folder with simple-git's refusal and releases it", async () => {
    const missing = join(root, "missing");
    const page = legacyPage();

    await page.send(dropTag(missing, "first"));
    await page.send(dropTag(missing, "second"));

    expect(page.received.map((message) => "status" in message && message.status)).toEqual([
      "Cannot use simple-git on a directory that does not exist",
      "Cannot use simple-git on a directory that does not exist"
    ]);
    expect(deleteTag).not.toHaveBeenCalled();
    expect(vi.mocked(muteGitRepoWatcher).mock.calls).toEqual([[missing], [missing]]);
    expect(vi.mocked(unmuteGitRepoWatcher).mock.calls).toEqual([[missing], [missing]]);
  });

  it("does not mute the watcher for a refused action", async () => {
    const gate = Promise.withResolvers<void>();
    vi.mocked(pushBranch).mockReturnValueOnce(gate.promise);
    const page = legacyPage();

    const pushing = page.send(push(one, "p"));
    await page.send(dropTag(one, "refused"));
    expect(page.received).toEqual([
      { command: "deleteTag", status: BUSY, requestId: "refused", repo: one }
    ]);
    expect(muteGitRepoWatcher).toHaveBeenCalledOnce();
    gate.resolve();
    await pushing;
  });

  // Decision handler Q4: the lock compares normalized paths, as the submodule checks do.
  it.each([
    ["trailing separator", "/"],
    ["dot segments", "/../one/."]
  ])("treats a spelling with %s as the same repository", async (_case, suffix) => {
    const gate = Promise.withResolvers<void>();
    vi.mocked(pushBranch).mockReturnValueOnce(gate.promise);
    const page = legacyPage();

    const pushing = page.send(push(one, "p"));
    await page.send(dropTag(one + suffix, "same"));
    await page.send(dropTag(two, "other"));

    expect(page.postsOf("deleteTag")).toEqual([
      { command: "deleteTag", status: BUSY, requestId: "same", repo: one + suffix },
      { command: "deleteTag", status: null, requestId: "other", repo: two }
    ]);
    expect(deleteTag).toHaveBeenCalledOnce();
    gate.resolve();
    await pushing;
  });
});

it("keeps actions and remote reads running when the page's handlers are disposed", async () => {
  const deletion = Promise.withResolvers<void>();
  vi.mocked(deleteTag).mockReturnValueOnce(deletion.promise);
  const remotes = Promise.withResolvers<Awaited<ReturnType<typeof loadRemotes>>>();
  vi.mocked(loadRemotes).mockReturnValueOnce(remotes.promise);
  const page = legacyPage();

  const deleting = page.send(dropTag(one, "tag"));
  const signal = latestSignal();
  const reading = page.send({
    command: "loadRemotes",
    repo: one,
    requestId: "r",
    branchName: null
  });
  page.lifetime.dispose();
  page.lifetime.dispose();
  // One after the other, so that the answers arrive in a known order.
  deletion.resolve();
  await deleting;
  remotes.resolve({ remotes: ["origin"], upstream: null, pushRemote: null });
  await reading;

  expect(signal.aborted).toBe(false);
  expect(page.received).toEqual([
    { command: "deleteTag", status: null, requestId: "tag", repo: one },
    {
      command: "loadRemotes",
      repo: one,
      requestId: "r",
      remotes: ["origin"],
      upstream: null,
      pushRemote: null,
      status: null
    }
  ]);
});

// Decision handler Q2: a page that cannot receive costs a debug line, never an unhandled error.
describe("posting to a page that is gone", () => {
  let unhandled: unknown[];
  const record = (reason: unknown) => unhandled.push(reason);
  beforeEach(() => {
    unhandled = [];
    process.on("unhandledRejection", record);
  });
  afterEach(() => {
    process.off("unhandledRejection", record);
  });

  it("logs a post that throws", async () => {
    const closed = new Error("Webview is disposed");
    const page = legacyPage({
      post: () => {
        throw closed;
      }
    });

    await expect(page.send({ command: "selectRepo", repo: one })).resolves.toBeUndefined();
    await expect(page.send(dropTag(one, "tag"))).resolves.toBeUndefined();

    expect(vi.mocked(logger.debug).mock.calls).toEqual([
      [expect.stringContaining("repoState"), closed],
      [expect.stringContaining("deleteTag"), closed]
    ]);
    expect(deleteTag).toHaveBeenCalledOnce();
  });

  it("logs a post that rejects", async () => {
    const closed = new Error("Webview is disposed");
    const page = legacyPage({ post: () => Promise.reject(closed) });

    await page.send(dropTag(one, "tag"));
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logger.debug).toHaveBeenCalledExactlyOnceWith(
      expect.stringContaining("deleteTag"),
      closed
    );
    expect(unhandled).toEqual([]);
  });
});
