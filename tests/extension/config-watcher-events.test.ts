import { beforeEach, describe, expect, it, vi } from "vitest";

import { initConfigWatcher } from "@/extension/watchers/config.watcher";

type ChangeEvent = { affectsConfiguration(section: string): boolean };

const env = vi.hoisted(() => ({
  calls: [] as unknown[][],
  onChange: undefined as ((event: ChangeEvent) => void) | undefined,
  subscription: { dispose: () => {} },
  configs: 0
}));
vi.mock("vscode", () => ({
  workspace: {
    onDidChangeConfiguration: (listener: (event: ChangeEvent) => void) => {
      env.onChange = listener;
      return env.subscription;
    }
  }
}));
vi.mock("@/extension/handlers/initialize", () => ({
  webviewConfig: () => ({ snapshot: ++env.configs })
}));
vi.mock("@/extension/rpc/rpc-notify", () => ({
  rpcNotify: { notify: (...args: unknown[]) => void env.calls.push(["notify", ...args]) }
}));
vi.mock("@/extension/util/logger", () => ({
  logger: { info: (...args: unknown[]) => void env.calls.push(["info", ...args]) }
}));

/** Report a change to the given setting keys, matched the way VS Code matches sections. */
function changeSettings(...keys: string[]) {
  env.onChange!({
    affectsConfiguration: (section) =>
      keys.some((key) => key === section || key.startsWith(`${section}.`))
  });
}

const notifications = () =>
  env.calls.filter(([kind]) => kind === "notify").map(([, ...rest]) => rest);

beforeEach(() => {
  env.calls = [];
  env.configs = 0;
});

describe("initConfigWatcher", () => {
  it("returns VS Code's own subscription", () => {
    expect(initConfigWatcher()).toBe(env.subscription);
  });

  it("rescans before it sends the new settings when the search depth changes", () => {
    initConfigWatcher();
    changeSettings("branchwise.maxDepthOfRepoSearch");
    expect(env.calls).toEqual([
      ["info", "Configuration changed"],
      ["notify", "repo.rescan", null],
      ["notify", "config.changed", { snapshot: 1 }]
    ]);
  });

  it("logs only for a change that needs a rescan", () => {
    initConfigWatcher();
    changeSettings("git.path");
    expect(env.calls).toEqual([
      ["info", "Configuration changed"],
      ["notify", "repo.rescan", null]
    ]);
    env.calls = [];
    changeSettings("branchwise.graphStyle");
    expect(env.calls.filter(([kind]) => kind === "info")).toEqual([]);
  });

  it("sends settings read at the time of each change", () => {
    initConfigWatcher();
    changeSettings("branchwise.dateFormat");
    changeSettings("branchwise.graphStyle");
    expect(notifications()).toEqual([
      ["config.changed", { snapshot: 1 }],
      ["config.changed", { snapshot: 2 }]
    ]);
  });

  it("sends the settings once when the whole section changes", () => {
    initConfigWatcher();
    changeSettings("branchwise");
    expect(notifications()).toEqual([["config.changed", { snapshot: 1 }]]);
  });

  it("handles a Git path and a display setting changed together", () => {
    initConfigWatcher();
    changeSettings("git.path", "branchwise.dateFormat");
    expect(notifications()).toEqual([
      ["repo.rescan", null],
      ["config.changed", expect.any(Object)]
    ]);
  });

  it("sends the settings even for a setting the webview does not read", () => {
    initConfigWatcher();
    changeSettings("branchwise.tabIconColourTheme");
    expect(notifications()).toEqual([["config.changed", { snapshot: 1 }]]);
  });

  it.each([["git.enabled"], ["neo-git-graph.graphStyle"], ["editor.fontSize"], []])(
    "ignores unrelated changes: %s",
    (...keys: string[]) => {
      initConfigWatcher();
      changeSettings(...keys);
      expect(env.calls).toEqual([]);
    }
  );
});
