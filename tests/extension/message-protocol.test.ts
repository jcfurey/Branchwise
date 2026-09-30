import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import { extConfig } from "@/extension/config";
import { createMessageProtocol } from "@/extension/legacy";
import { DiffDocProvider } from "@/old-extension/diffDocProvider";

type Listener<T> = (event: T) => void;

const fake = vi.hoisted(() => ({
  gitPath: undefined as unknown,
  /** Every `dispose` the code under test makes on the fakes, in order. */
  disposed: [] as string[],
  registrations: [] as { scheme: string; provider: unknown }[],
  /** Handlers the fake message handler registration returned, newest last. */
  handlers: [] as { onPanelShown: () => void; dispose: () => void }[],
  registerHandlers: vi.fn(),
  gitClientFactory: vi.fn()
}));

const tracked = (name: string) => ({ dispose: () => fake.disposed.push(name) });

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: (section: string) => ({
      get: (key: string, fallback?: unknown) =>
        section === "git" && key === "path" ? fake.gitPath : fallback
    }),
    registerTextDocumentContentProvider: (scheme: string, provider: unknown) => {
      fake.registrations.push({ scheme, provider });
      return tracked("registration");
    },
    onDidCloseTextDocument: () => tracked("closed-document listener")
  },
  EventEmitter: class {
    event = () => tracked("change listener");
    dispose() {
      fake.disposed.push("change emitter");
    }
  }
}));

vi.mock("@/old-extension/messageHandler", () => ({
  registerMessageHandlers: fake.registerHandlers.mockImplementation(() => {
    const handlers = {
      onPanelShown: vi.fn(),
      dispose: vi.fn(() => fake.disposed.push("handlers"))
    };
    fake.handlers.push(handlers);
    return handlers;
  })
}));

vi.mock("@/backend/gitClient", () => ({
  gitClientFactory: fake.gitClientFactory.mockImplementation(() => ({
    getInstance: () => ({ show: async () => "content" })
  }))
}));

let storage: string;

beforeEach(() => {
  storage = mkdtempSync(join(tmpdir(), "branchwise protocol "));
  fake.gitPath = undefined;
  fake.disposed.length = 0;
  fake.registrations.length = 0;
  fake.handlers.length = 0;
  fake.registerHandlers.mockClear();
  fake.gitClientFactory.mockClear();
});

afterEach(() => rmSync(storage, { recursive: true, force: true }));

function memento(values: Record<string, unknown> = {}) {
  return {
    get: (key: string, fallback?: unknown) => (key in values ? values[key] : fallback),
    update: vi.fn(async () => {})
  };
}

function extensionContext(savedRepos: Record<string, unknown> = {}) {
  return {
    subscriptions: [] as { dispose(): void }[],
    globalStoragePath: storage,
    globalState: memento(),
    workspaceState: memento({ repoStates: savedRepos })
  };
}

function start(savedRepos?: Record<string, unknown>) {
  const ctx = extensionContext(savedRepos);
  const protocol = createMessageProtocol(ctx as unknown as import("vscode").ExtensionContext);
  return { ctx, protocol };
}

/** A panel whose visibility a test flips, with a page that records what it is sent. */
function panelShowing(visible: boolean) {
  let viewStateListener: Listener<unknown> | undefined;
  const panel = {
    visible,
    webview: {
      onDidReceiveMessage: vi.fn(() => tracked("page listener")),
      postMessage: vi.fn(async (_message: unknown) => true)
    },
    onDidChangeViewState: vi.fn((listener: Listener<unknown>) => {
      viewStateListener = listener;
      return tracked("view-state listener");
    })
  };
  return {
    panel: panel as unknown as import("vscode").WebviewPanel,
    page: panel.webview,
    /** VS Code reports a view-state change; `nowVisible` is the panel's visibility afterwards. */
    viewStateChanges(nowVisible: boolean) {
      panel.visible = nowVisible;
      viewStateListener?.({ webviewPanel: panel });
    }
  };
}

function documentUri(repo: string, id: string) {
  return {
    path: "/f.txt",
    query: `commit=${"ab".repeat(20)}&repo=${encodeURIComponent(repo)}`,
    toString: () => `branchwise:${id}`
  } as unknown as import("vscode").Uri;
}

describe("creating the protocol", () => {
  test("registers one provider for branchwise documents and keeps its registration", () => {
    const { ctx } = start();
    expect(fake.registrations).toHaveLength(1);
    expect(fake.registrations[0]!.scheme).toBe("branchwise");
    expect(fake.registrations[0]!.provider).toBeInstanceOf(DiffDocProvider);
    expect(ctx.subscriptions).toHaveLength(1);
    expect(fake.gitClientFactory).not.toHaveBeenCalled();
    expect(fake.registerHandlers).not.toHaveBeenCalled();
  });

  // Decision legacy Q1: deactivation disposes the provider as well as its registration.
  test("disposes the provider itself along with its registration at deactivation", () => {
    const { ctx } = start();
    expect(fake.disposed).toEqual([]);
    for (const subscription of ctx.subscriptions) {
      subscription.dispose();
    }
    expect(fake.disposed.toSorted()).toEqual(
      ["change emitter", "closed-document listener", "registration"].toSorted()
    );
  });

  test("serves saved repositories through a Git client for the current Git path", async () => {
    start({ "/repo/a": { columnWidths: null } });
    const provider = fake.registrations[0]!.provider as DiffDocProvider;

    expect(await provider.provideTextDocumentContent(documentUri("/repo/a", "1"))).toBe("content");
    expect(fake.gitClientFactory).toHaveBeenCalledExactlyOnceWith("/repo/a", extConfig.gitPath());

    // Unsaved and not opened this session: no Git at all.
    expect(await provider.provideTextDocumentContent(documentUri("/repo/b", "2"))).toBe("");
    expect(fake.gitClientFactory).toHaveBeenCalledOnce();

    fake.gitPath = "/opt/other/git";
    await provider.provideTextDocumentContent(documentUri("/repo/a", "3"));
    expect(fake.gitClientFactory).toHaveBeenLastCalledWith("/repo/a", "/opt/other/git");
  });
});

describe("attaching a panel", () => {
  test("registers the message handlers with the shared repository state", () => {
    const { protocol } = start();
    protocol.attach(panelShowing(true).panel);
    protocol.attach(panelShowing(true).panel);
    expect(fake.registerHandlers).toHaveBeenCalledTimes(2);
    const [[bridge, deps], [, otherDeps]] = fake.registerHandlers.mock.calls as [
      [unknown, { config: unknown; repoManager: unknown }],
      [unknown, { config: unknown; repoManager: unknown }]
    ];
    expect(bridge).toEqual(
      expect.objectContaining({
        post: expect.any(Function),
        onMessage: expect.any(Function),
        dispose: expect.any(Function)
      })
    );
    expect(deps.config).toBe(extConfig);
    expect(otherDeps.repoManager).toBe(deps.repoManager);
  });

  test("listens to the page before the handlers register, and posts nothing yet", () => {
    const { protocol } = start();
    const { panel, page } = panelShowing(true);
    protocol.attach(panel);
    expect(page.onDidReceiveMessage).toHaveBeenCalledOnce();
    expect(page.onDidReceiveMessage.mock.invocationCallOrder[0]).toBeLessThan(
      fake.registerHandlers.mock.invocationCallOrder[0]!
    );
    expect(panel.onDidChangeViewState).toHaveBeenCalledOnce();
    expect(page.postMessage).not.toHaveBeenCalled();
  });

  test("refreshes the page only when a hidden panel becomes visible", () => {
    const { protocol } = start();
    const view = panelShowing(true);
    protocol.attach(view.panel);
    const handlers = fake.handlers[0]!;

    for (const visible of [true, false, false]) {
      view.viewStateChanges(visible);
    }
    expect(view.page.postMessage).not.toHaveBeenCalled();
    expect(handlers.onPanelShown).not.toHaveBeenCalled();

    view.viewStateChanges(true);
    expect(view.page.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "refresh" });
    expect(handlers.onPanelShown).toHaveBeenCalledOnce();
    expect(vi.mocked(handlers.onPanelShown).mock.invocationCallOrder[0]).toBeLessThan(
      view.page.postMessage.mock.invocationCallOrder[0]!
    );

    view.viewStateChanges(true);
    expect(view.page.postMessage).toHaveBeenCalledOnce();
  });

  test("refreshes a panel attached while hidden when it first shows", () => {
    const { protocol } = start();
    const view = panelShowing(false);
    protocol.attach(view.panel);
    view.viewStateChanges(true);
    expect(view.page.postMessage).toHaveBeenCalledExactlyOnceWith({ command: "refresh" });
    expect(fake.handlers[0]!.onPanelShown).toHaveBeenCalledOnce();
  });

  test("survives a refresh the page can no longer receive", async () => {
    const { protocol } = start();
    const view = panelShowing(false);
    view.page.postMessage.mockRejectedValueOnce(new Error("Webview is disposed"));
    protocol.attach(view.panel);
    view.viewStateChanges(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(view.page.postMessage).toHaveBeenCalledOnce();
  });

  test("lets go of the handlers, the page and the view state once, however often disposed", () => {
    const { protocol } = start();
    const view = panelShowing(true);
    const attachment = protocol.attach(view.panel);
    attachment.dispose();
    attachment.dispose();
    expect(fake.disposed.toSorted()).toEqual(
      ["handlers", "page listener", "view-state listener"].toSorted()
    );
  });
});
