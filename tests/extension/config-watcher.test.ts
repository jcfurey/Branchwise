import { beforeEach, expect, it, vi } from "vitest";

import { initConfigWatcher } from "@/extension/watchers/config.watcher";

const mocks = vi.hoisted(() => ({
  notify: vi.fn(),
  settings: {} as Record<string, unknown>,
  listener: undefined as undefined | ((e: { affectsConfiguration: (s: string) => boolean }) => void)
}));
vi.mock("vscode", () => ({
  env: { language: "de" },
  workspace: {
    getConfiguration: () => ({
      get: (key: string, fallback: unknown) => mocks.settings[key] ?? fallback
    }),
    onDidChangeConfiguration: (listener: typeof mocks.listener) => {
      mocks.listener = listener;
      return { dispose: vi.fn() };
    }
  }
}));
vi.mock("@/extension/rpc/rpc-notify", () => ({ rpcNotify: { notify: mocks.notify } }));
vi.mock("@/extension/util/logger", () => ({ logger: { info: vi.fn() } }));
vi.mock("@/old-extension/l10n/webviewL10n", () => ({ getWebviewLocalizedStrings: () => ({}) }));

beforeEach(() => {
  mocks.notify.mockClear();
  mocks.settings = {};
  initConfigWatcher();
});

function change(...sections: string[]) {
  mocks.listener!({
    affectsConfiguration: (section) =>
      sections.some((changed) => changed === section || changed.startsWith(`${section}.`))
  });
}

it("sends changed display settings to an open graph", () => {
  mocks.settings = { graphStyle: "angular", dateFormat: "Relative", initialLoadCommits: 50.7 };
  change("branchwise.graphStyle");
  expect(mocks.notify).toHaveBeenCalledExactlyOnceWith(
    "config.changed",
    expect.objectContaining({
      graphStyle: "angular",
      dateFormat: "Relative",
      initialLoadCommits: 50,
      locale: "de"
    })
  );
});

it("scans for repositories again only when the search changes", () => {
  change("branchwise.maxDepthOfRepoSearch");
  expect(mocks.notify).toHaveBeenCalledWith("repo.rescan", null);
  expect(mocks.notify).toHaveBeenCalledWith("config.changed", expect.any(Object));
  mocks.notify.mockClear();
  change("git.path");
  expect(mocks.notify).toHaveBeenCalledExactlyOnceWith("repo.rescan", null);
  mocks.notify.mockClear();
  change("editor.fontSize");
  expect(mocks.notify).not.toHaveBeenCalled();
});
