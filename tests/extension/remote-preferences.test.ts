import { rmSync } from "node:fs";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { gitClientFactory } from "@/backend/gitClient";
import * as repositoryQueries from "@/backend/queries/repository";
import type { RepositoryAction, RepositoryQueryData } from "@/backend/types";
import type { ExtensionState } from "@/old-extension/extensionState";
import { registerMessageHandlers } from "@/old-extension/messageHandler";
import { createRepoManager } from "@/old-extension/repoManager";
import type { GitRepoSet } from "@/types";

import { git, makeRepo } from "@tests/backend/helpers";

let repo: string;
beforeEach(() => {
  repo = makeRepo();
  for (const name of ["origin", "origin2", "team/upstream"]) {
    git(["remote", "add", name, "."], repo);
  }
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(repo, { recursive: true, force: true });
});

function setup(hiddenRemotes: string[]) {
  const saved = {
    repos: { [repo]: { columnWidths: [100, 300, 80, 80, 80], hiddenRemotes } } as GitRepoSet
  };
  const saveRepos = vi.fn((repos: GitRepoSet) => {
    saved.repos = repos;
  });
  const manager = createRepoManager({
    getRepos: () => saved.repos,
    saveRepos
  } as unknown as ExtensionState);
  const handlers = new Map<string, (message: unknown) => void | Promise<void>>();
  const post = vi.fn();
  const lifetime = registerMessageHandlers(
    {
      post,
      onMessage: (name, handler) => {
        handlers.set(name, handler as (message: unknown) => void | Promise<void>);
      },
      dispose: vi.fn()
    },
    {
      config: { gitPath: () => "git" },
      repoManager: manager,
      gitClient: gitClientFactory(repo, "git"),
      extensionState: { setLastActiveRepo: vi.fn() }
    } as unknown as Parameters<typeof registerMessageHandlers>[1]
  );
  return {
    saved,
    manager,
    post,
    saveRepos,
    lifetime,
    action: (action: RepositoryAction) =>
      handlers.get("repositoryAction")!({
        command: "repositoryAction",
        repo,
        requestId: "action",
        action
      }),
    state: () =>
      handlers.get("repositoryQuery")!({
        command: "repositoryQuery",
        repo,
        requestId: "state",
        query: { kind: "state" }
      }),
    select: () => handlers.get("selectRepo")!({ command: "selectRepo", repo })
  };
}

it("persists an exact remote rename, including slashes, and sends preferences before success", async () => {
  const { action, saved, post, lifetime } = setup(["origin", "origin2", "team/upstream"]);
  try {
    await action({ kind: "renameRemote", name: "team/upstream", newName: "team/mirror" });
    expect(saved.repos[repo]).toEqual({
      columnWidths: [100, 300, 80, 80, 80],
      hiddenRemotes: ["origin", "origin2", "team/mirror"]
    });
    expect(post.mock.calls.map(([message]) => message.command)).toEqual([
      "repoState",
      "repositoryAction"
    ]);
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ status: null }));
  } finally {
    lifetime.dispose();
  }
});

it("cleans removed preferences, leaves visible renames visible, and restores saved state on selection", async () => {
  const { action, select, saved, post, lifetime } = setup(["origin", "team/upstream"]);
  try {
    await action({ kind: "removeRemote", name: "origin" });
    expect(saved.repos[repo]?.hiddenRemotes).toEqual(["team/upstream"]);
    await action({ kind: "renameRemote", name: "origin2", newName: "mirror" });
    await action({ kind: "addRemote", name: "origin", url: ".", fetch: false });
    expect(saved.repos[repo]?.hiddenRemotes).toEqual(["team/upstream"]);
    post.mockClear();
    await select();
    expect(post).toHaveBeenCalledExactlyOnceWith({
      command: "repoState",
      repo,
      state: saved.repos[repo]
    });
  } finally {
    lifetime.dispose();
  }
});

it("does not change preferences when Git rejects a rename or removal", async () => {
  const { action, saved, saveRepos, post, lifetime } = setup(["origin"]);
  try {
    await action({ kind: "renameRemote", name: "origin", newName: "origin2" });
    await action({ kind: "removeRemote", name: "missing" });
    expect(saved.repos[repo]?.hiddenRemotes).toEqual(["origin"]);
    expect(saveRepos).not.toHaveBeenCalled();
    expect(post.mock.calls).toHaveLength(2);
    expect(
      post.mock.calls.every(
        ([message]) => message.command === "repositoryAction" && message.status !== null
      )
    ).toBe(true);
  } finally {
    lifetime.dispose();
  }
});

it("reconciles external changes while keeping orphan ref groups and configured empty remotes hidden", async () => {
  const { state, saved, saveRepos, post, lifetime } = setup(["origin", "orphan", "team/upstream"]);
  try {
    git(["update-ref", "refs/remotes/orphan/topic", "HEAD"], repo);
    git(["remote", "rename", "origin", "external"], repo);
    await state();
    expect(saved.repos[repo]?.hiddenRemotes).toEqual(["orphan", "team/upstream"]);
    expect(post).toHaveBeenCalledWith(expect.objectContaining({ command: "repoState" }));
    expect(post).toHaveBeenLastCalledWith(
      expect.objectContaining({ command: "repositoryQuery", status: null })
    );
    saveRepos.mockClear();
    await state();
    expect(saveRepos).not.toHaveBeenCalled();
  } finally {
    lifetime.dispose();
  }
});

it("keeps preferences when a repository state refresh fails", async () => {
  const { state, saved, saveRepos, post, lifetime } = setup(["origin"]);
  try {
    rmSync(repo, { recursive: true, force: true });
    await state();
    expect(saved.repos[repo]?.hiddenRemotes).toEqual(["origin"]);
    expect(saveRepos).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        command: "repositoryQuery",
        status: expect.any(String),
        data: null
      })
    );
  } finally {
    lifetime.dispose();
  }
});

it("does not prune preferences changed while an older state query was running", async () => {
  const { state, saved, manager, lifetime } = setup(["missing"]);
  try {
    const snapshot = await repositoryQueries.loadRepositoryState(
      gitClientFactory(repo, "git").getInstance()
    );
    const pending = Promise.withResolvers<RepositoryQueryData>();
    vi.spyOn(repositoryQueries, "repositoryQuery").mockReturnValueOnce(pending.promise);
    const loading = state();
    const updated = { columnWidths: [90, 80, 80, 80], hiddenRemotes: ["missing", "origin"] };
    manager.setRepoState(repo, updated);
    pending.resolve({ kind: "state", state: snapshot });
    await loading;
    expect(saved.repos[repo]).toBe(updated);
    await state();
    expect(saved.repos[repo]?.hiddenRemotes).toEqual(["origin"]);
  } finally {
    lifetime.dispose();
  }
});
