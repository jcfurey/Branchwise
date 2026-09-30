import { beforeEach, describe, expect, test, vi } from "vitest";

import { createViewCommand } from "@/extension/view-command";

type PageListener = (message: unknown) => void;

const world = vi.hoisted(() => {
  const log: string[] = [];
  return {
    /** Wiring and disposal, in the order they happened. */
    log,
    /** What reached the page: notifications and posted messages, in order. */
    sent: [] as unknown[][],
    editorColumn: 2 as number | undefined,
    iconTheme: "colour",
    createPanel: vi.fn(),
    workTreeRoot: vi.fn(),
    addSessionRepo: vi.fn(),
    notify: vi.fn(),
    createHtml: vi.fn(),
    createMessageProtocol: vi.fn(),
    createRpcServer: vi.fn(),
    service(name: string) {
      log.push(`attach ${name}`);
      return { dispose: () => log.push(`dispose ${name}`) };
    }
  };
});

vi.mock("vscode", () => ({
  window: {
    get activeTextEditor() {
      return world.editorColumn === undefined ? undefined : { viewColumn: world.editorColumn };
    },
    createWebviewPanel: world.createPanel
  },
  ViewColumn: { One: 1 },
  Uri: { joinPath: (base: string, ...segments: string[]) => [base, ...segments].join("/") }
}));
vi.mock("@/extension/config", () => ({
  extConfig: { gitPath: () => "/usr/bin/git", tabIconColourTheme: () => world.iconTheme }
}));
vi.mock("@/backend/utils/git", () => ({ workTreeRoot: world.workTreeRoot }));
vi.mock("@/extension/workspace-scan", () => ({ addSessionRepo: world.addSessionRepo }));
vi.mock("@/extension/html", () => ({ createWebviewHtml: world.createHtml }));
vi.mock("@/extension/legacy", () => ({ createMessageProtocol: world.createMessageProtocol }));
vi.mock("@/extension/rpc/rpc-server", () => ({ createRpcServer: world.createRpcServer }));
vi.mock("@/extension/rpc/rpc-notify", () => ({
  initRpcNotify: () => world.service("notifications"),
  rpcNotify: { notify: world.notify }
}));
vi.mock("@/extension/watchers/config.watcher", () => ({
  initConfigWatcher: () => world.service("config watcher")
}));
vi.mock("@/extension/watchers/git.watcher", () => ({
  watchGitDir: () => world.service(".git watcher")
}));
vi.mock("@/extension/watchers/git-repo.watcher", () => ({
  watchGitRepo: () => world.service("repo watcher")
}));

/** A webview panel whose page can report ready and which the user can close. */
function fakePanel() {
  const listeners = new Set<PageListener>();
  let closed: (() => void) | undefined;
  let html = "";
  const panel = {
    iconPath: undefined as unknown,
    reveal: vi.fn((column?: number) => world.log.push(`reveal ${column}`)),
    onDidDispose: vi.fn((handler: () => void) => {
      closed = handler;
      return { dispose() {} };
    }),
    webview: {
      get html() {
        return html;
      },
      set html(value: string) {
        world.log.push("html");
        html = value;
      },
      onDidReceiveMessage: vi.fn((listener: PageListener) => {
        world.log.push("page listener");
        listeners.add(listener);
        return {
          dispose() {
            world.log.push("dispose page listener");
            listeners.delete(listener);
          }
        };
      }),
      postMessage: vi.fn(async (message: unknown) => {
        world.sent.push(["post", message]);
        return true;
      })
    }
  };
  return {
    panel,
    pageReady: () => [...listeners].forEach((listener) => listener({ command: "viewReady" })),
    close: () => closed?.()
  };
}

let panels: ReturnType<typeof fakePanel>[];
const newest = () => panels.at(-1)!;

beforeEach(() => {
  vi.clearAllMocks();
  world.log.length = 0;
  world.sent.length = 0;
  world.editorColumn = 2;
  world.iconTheme = "colour";
  panels = [];
  world.createPanel.mockImplementation(() => {
    panels.push(fakePanel());
    return newest().panel;
  });
  world.workTreeRoot.mockImplementation(async (folder: string) => {
    world.log.push(`lookup ${folder}`);
    return folder;
  });
  world.notify.mockImplementation(async (name: string, message: unknown) => {
    world.sent.push(["notify", name, message]);
  });
  world.createHtml.mockReturnValue("<html>graph</html>");
  world.createMessageProtocol.mockImplementation(() => ({
    attach: () => world.service("protocol")
  }));
  world.createRpcServer.mockImplementation(() => ({ attach: () => world.service("rpc server") }));
});

const ctx = { extensionUri: "EXT" } as unknown as import("vscode").ExtensionContext;
const folderOf = (fsPath: string) =>
  ({ rootUri: { fsPath } }) as unknown as Pick<import("vscode").SourceControl, "rootUri">;
/** Let lookups that already resolved run their continuations. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** The next lookup waits until the test resolves it. */
function slowLookup() {
  const lookup = Promise.withResolvers<string | null>();
  world.workTreeRoot.mockImplementationOnce(() => lookup.promise);
  return lookup;
}

const selected = (name: string, path: string) => ["notify", "repo.select", { name, path }];
const history = (repo: string, path: string) => ["post", { command: "fileHistory", repo, path }];
const pane = (name: string) => ["notify", "view.showPane", { pane: name }];

describe("creating the command", () => {
  test("prepares the shared services without opening a panel or running Git", () => {
    const view = createViewCommand(ctx);
    expect(world.createMessageProtocol).toHaveBeenCalledExactlyOnceWith(ctx);
    expect(world.createRpcServer).toHaveBeenCalledOnce();
    expect(world.createPanel).not.toHaveBeenCalled();
    expect(world.workTreeRoot).not.toHaveBeenCalled();
    expect(view).toHaveLength(2);
    expect(Object.hasOwn(view, "showPane")).toBe(true);
  });
});

describe("the graph panel", () => {
  // Decision view Q2: only the bundled output is a resource root.
  test("opens in the first column without an editor, with the bundled output as its only root", () => {
    world.editorColumn = undefined;
    const view = createViewCommand(ctx);
    view();
    expect(world.createPanel).toHaveBeenCalledOnce();
    const [viewType, title, column, options] = world.createPanel.mock.calls[0]!;
    expect([viewType, title, column]).toEqual(["branchwise", "Branchwise", 1]);
    // Scripts run, and the page survives being hidden.
    expect(Object.keys(options).toSorted()).toEqual([
      "enableScripts",
      "localResourceRoots",
      "retainContextWhenHidden"
    ]);
    expect(options).toMatchObject({ enableScripts: true, retainContextWhenHidden: true });
    expect(options.localResourceRoots).toEqual(["EXT/out"]);
    world.editorColumn = 3;
    view();
    world.editorColumn = undefined;
    view();
    expect(world.createPanel).toHaveBeenCalledOnce();
    expect(newest().panel.reveal.mock.calls).toEqual([[3], [undefined]]);
  });

  test("opens beside the active editor with the coloured tab icon", () => {
    createViewCommand(ctx)();
    expect(world.createPanel.mock.calls[0]?.[2]).toBe(2);
    expect(newest().panel.iconPath).toBe("EXT/resources/webview-icon.svg");
  });

  test("uses the grey icon pair for the grey theme", () => {
    world.iconTheme = "grey";
    createViewCommand(ctx)();
    expect(newest().panel.iconPath).toEqual({
      light: "EXT/resources/webview-icon-light.svg",
      dark: "EXT/resources/webview-icon-dark.svg"
    });
  });

  test("wires every service before the page is loaded", () => {
    createViewCommand(ctx)();
    expect(world.log).toEqual([
      "attach protocol",
      "attach rpc server",
      "attach notifications",
      "attach config watcher",
      "attach .git watcher",
      "attach repo watcher",
      "page listener",
      "html"
    ]);
    expect(world.createHtml).toHaveBeenCalledExactlyOnceWith(ctx, newest().panel.webview);
    expect(newest().panel.webview.html).toBe("<html>graph</html>");
    expect(newest().panel.onDidDispose).toHaveBeenCalledOnce();
  });

  test("releases what the panel used when it closes, and the next call opens a new one", () => {
    const view = createViewCommand(ctx);
    view();
    world.log.length = 0;
    newest().close();
    expect(world.log.toSorted()).toEqual(
      [
        "dispose protocol",
        "dispose rpc server",
        "dispose notifications",
        "dispose config watcher",
        "dispose .git watcher",
        "dispose repo watcher",
        "dispose page listener"
      ].toSorted()
    );
    view();
    expect(world.createPanel).toHaveBeenCalledTimes(2);
    expect(panels[0]!.panel.reveal).not.toHaveBeenCalled();
    expect(world.createMessageProtocol).toHaveBeenCalledOnce();
    expect(world.createRpcServer).toHaveBeenCalledOnce();
  });
});

describe("Source Control and File History clicks", () => {
  test("select the clicked repository when the page is ready, then show the file", async () => {
    const view = createViewCommand(ctx);
    view(folderOf("/w/a"), "x/y.txt");
    await settle();
    expect(world.workTreeRoot).toHaveBeenCalledExactlyOnceWith("/w/a", "/usr/bin/git");
    expect(world.addSessionRepo).toHaveBeenCalledExactlyOnceWith("/w/a");
    expect(world.sent).toEqual([]);
    newest().pageReady();
    expect(world.sent).toEqual([selected("a", "/w/a"), history("/w/a", "x/y.txt")]);
  });

  test("look the top level up before revealing, and select what Git names", async () => {
    const view = createViewCommand(ctx);
    view();
    newest().pageReady();
    world.workTreeRoot.mockResolvedValueOnce("/real/top");
    view(folderOf("/w/top/sub"), "deep/file.txt");
    expect(world.workTreeRoot.mock.invocationCallOrder[0]).toBeLessThan(
      newest().panel.reveal.mock.invocationCallOrder[0]!
    );
    await settle();
    expect(world.addSessionRepo).toHaveBeenCalledExactlyOnceWith("/real/top");
    expect(world.sent).toEqual([
      selected("top", "/real/top"),
      history("/real/top", "deep/file.txt")
    ]);
  });

  test("fall back to the clicked folder outside a work tree", async () => {
    const view = createViewCommand(ctx);
    view();
    newest().pageReady();
    world.workTreeRoot.mockResolvedValueOnce(null);
    view(folderOf("/w/loose"));
    await settle();
    expect(world.addSessionRepo).toHaveBeenCalledExactlyOnceWith("/w/loose");
    expect(world.sent).toEqual([selected("loose", "/w/loose")]);
  });

  test("let the latest click win, dropping an earlier click's file history", async () => {
    const view = createViewCommand(ctx);
    const first = slowLookup();
    view(folderOf("/w/1"), "one.txt");
    view(folderOf("/w/2"));
    newest().pageReady();
    await settle();
    first.resolve("/w/1");
    await settle();
    expect(world.sent).toEqual([selected("2", "/w/2")]);
    expect(world.addSessionRepo.mock.calls).toEqual([["/w/2"], ["/w/1"]]);
  });

  test("do nothing but reveal the graph when no folder comes with them", async () => {
    const view = createViewCommand(ctx);
    view();
    view(folderOf(""));
    view({ rootUri: undefined } as unknown as Pick<import("vscode").SourceControl, "rootUri">);
    view(undefined, "file.txt");
    await settle();
    expect(world.workTreeRoot).not.toHaveBeenCalled();
    expect(newest().panel.reveal).toHaveBeenCalledTimes(3);
  });

  test("only offer a repository whose lookup ends after the panel closed", async () => {
    const view = createViewCommand(ctx);
    const late = slowLookup();
    view(folderOf("/w/e"), "e.txt");
    newest().close();
    late.resolve("/real/e");
    await settle();
    expect(world.addSessionRepo).toHaveBeenCalledExactlyOnceWith("/real/e");
    expect(world.notify).not.toHaveBeenCalled();

    view();
    newest().pageReady();
    expect(world.sent).toEqual([]);
    // The file history of the closed panel does not reappear for the same repository.
    world.workTreeRoot.mockResolvedValueOnce("/real/e");
    view(folderOf("/w/e"));
    await settle();
    expect(world.sent).toEqual([selected("e", "/real/e")]);
  });
});

// Decision view Q1: a call without a folder never discards a pending file history.
describe("a pending file history", () => {
  test("survives a call without a folder after its lookup finished", async () => {
    const view = createViewCommand(ctx);
    view(folderOf("/w/a"), "f.txt");
    await settle();
    view();
    newest().pageReady();
    expect(world.sent).toEqual([selected("a", "/w/a"), history("/w/a", "f.txt")]);
  });

  test("survives a call without a folder while its lookup runs", async () => {
    const view = createViewCommand(ctx);
    view();
    newest().pageReady();
    const lookup = slowLookup();
    view(folderOf("/w/d"), "d.txt");
    view();
    lookup.resolve("/real/d");
    await settle();
    expect(world.sent).toEqual([selected("d", "/real/d"), history("/real/d", "d.txt")]);
  });

  test("survives a side pane request", async () => {
    const view = createViewCommand(ctx);
    view(folderOf("/w/a"), "f.txt");
    await settle();
    view.showPane("workspace");
    newest().pageReady();
    expect(world.sent).toEqual([
      pane("workspace"),
      selected("a", "/w/a"),
      history("/w/a", "f.txt")
    ]);
  });

  test("is replaced by a newer click without a file", async () => {
    const view = createViewCommand(ctx);
    view(folderOf("/w/a"), "a.txt");
    await settle();
    view(folderOf("/w/b"));
    await settle();
    newest().pageReady();
    view(folderOf("/w/a"));
    await settle();
    expect(world.sent).toEqual([selected("b", "/w/b"), selected("a", "/w/a")]);
  });

  test("is replaced by a newer file history request", async () => {
    const view = createViewCommand(ctx);
    view(folderOf("/w/a"), "old.txt");
    await settle();
    view(folderOf("/w/a"), "new.txt");
    await settle();
    newest().pageReady();
    expect(world.sent).toEqual([selected("a", "/w/a"), history("/w/a", "new.txt")]);
  });

  test("is dropped when the panel closes", async () => {
    const view = createViewCommand(ctx);
    view(folderOf("/w/a"), "a.txt");
    await settle();
    newest().close();
    view();
    newest().pageReady();
    view(folderOf("/w/a"));
    await settle();
    expect(world.sent).toEqual([selected("a", "/w/a")]);
  });
});

describe("side panes", () => {
  test("open only the last pane asked for before the page is ready", () => {
    world.iconTheme = "grey";
    const view = createViewCommand(ctx);
    view.showPane("workspace");
    view.showPane("refs");
    expect(world.createPanel).toHaveBeenCalledOnce();
    expect(newest().panel.reveal.mock.calls).toEqual([[2]]);
    expect(world.sent).toEqual([]);
    newest().pageReady();
    expect(world.sent).toEqual([pane("refs")]);
  });

  test("open at once once the page is ready", () => {
    const view = createViewCommand(ctx);
    view();
    newest().pageReady();
    world.log.length = 0;
    view.showPane("refs");
    expect(world.log).toEqual(["reveal 2"]);
    expect(world.sent).toEqual([pane("refs")]);
  });

  test("are forgotten when the panel closes before its page was ready", () => {
    const view = createViewCommand(ctx);
    view.showPane("refs");
    newest().close();
    view();
    newest().pageReady();
    expect(world.sent).toEqual([]);
  });

  // Decision view Q8: on the first ready, the pane comes before the repository.
  test("come before the repository selection and the file history on the first ready", async () => {
    const view = createViewCommand(ctx);
    const lookup = slowLookup();
    view(folderOf("/w/f"), "f.txt");
    view.showPane("refs");
    lookup.resolve("/real/f");
    await settle();
    newest().pageReady();
    expect(world.sent).toEqual([
      pane("refs"),
      selected("f", "/real/f"),
      history("/real/f", "f.txt")
    ]);
  });

  test("are not sent again when the page reports ready a second time", async () => {
    const view = createViewCommand(ctx);
    view.showPane("refs");
    view(folderOf("/w/a"));
    await settle();
    newest().pageReady();
    newest().pageReady();
    expect(world.sent).toEqual([pane("refs"), selected("a", "/w/a")]);
  });
});
