import { rmSync } from "node:fs";

import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { ExtensionContext } from "vscode";

import { gitClientFactory } from "@/backend/gitClient";
import { ExtensionState } from "@/old-extension/extensionState";
import { registerMessageHandlers } from "@/old-extension/messageHandler";
import { createRepoManager } from "@/old-extension/repoManager";
import type { GraphPreferences, RequestMessage } from "@/types";

import { makeRepo } from "@tests/backend/helpers";

let repo: string;
beforeEach(() => {
  repo = makeRepo();
});
afterEach(() => {
  rmSync(repo, { recursive: true, force: true });
});

it("merges preference patches in workspace storage and restores them after extension recreation", async () => {
  const disk = new Map<string, unknown>();
  const workspaceState = {
    get: (key: string, fallback: unknown) => structuredClone(disk.get(key) ?? fallback),
    update: vi.fn(async (key: string, value: unknown) => {
      disk.set(key, JSON.parse(JSON.stringify(value)));
    })
  };
  const globalState = { get: vi.fn(), update: vi.fn() };
  const context = {
    workspaceState,
    globalState,
    globalStoragePath: repo + "/storage"
  } as unknown as ExtensionContext;
  function activate() {
    const state = new ExtensionState(context);
    const manager = createRepoManager(state);
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
        gitClient: gitClientFactory(repo, "git"),
        repoManager: manager,
        extensionState: state
      } as unknown as Parameters<typeof registerMessageHandlers>[1]
    );
    return {
      manager,
      post,
      lifetime,
      send: (message: RequestMessage) => handlers.get(message.command)!(message)
    };
  }
  const graphPreferences: GraphPreferences = {
    branchDisplay: "focus",
    focusBranch: "topic",
    focusPaused: true,
    focusDimming: "strong",
    showRemoteBranches: false
  };
  let extension = activate();
  try {
    await extension.send({ command: "saveRepoState", repo, state: { hiddenRemotes: ["origin"] } });
    await extension.send({ command: "saveRepoState", repo, state: { graphPreferences } });
    await extension.send({
      command: "saveRepoState",
      repo,
      state: { columnWidths: [80, 90, 100, 110] }
    });
    extension.lifetime.dispose();
    extension = activate();
    await extension.send({ command: "selectRepo", repo });
    expect(extension.post).toHaveBeenCalledWith({
      command: "repoState",
      repo,
      state: {
        columnWidths: [80, 90, 100, 110],
        hiddenRemotes: ["origin"],
        graphPreferences
      }
    });
    expect(globalState.update).not.toHaveBeenCalled();
    // Reconciliation and later width updates retain the other persisted fields.
    extension.manager.updateHiddenRemotes(repo, []);
    await extension.send({
      command: "saveRepoState",
      repo,
      state: { columnWidths: [70, 80, 90, 100] }
    });
    expect(extension.manager.getRepos()[repo]).toEqual({
      columnWidths: [70, 80, 90, 100],
      hiddenRemotes: [],
      graphPreferences
    });
  } finally {
    extension.lifetime.dispose();
  }
});
