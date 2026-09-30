import { beforeEach, expect, it, vi } from "vitest";

import { createViewCommand } from "@/extension/view-command";

const mocks = vi.hoisted(() => ({
  createPanel: vi.fn(),
  notify: vi.fn(),
  disposable: () => ({ dispose: vi.fn() }),
  workTreeRoot: vi.fn(async (directory: string): Promise<string | null> => directory),
  addSessionRepo: vi.fn()
}));

vi.mock("vscode", () => ({
  window: { activeTextEditor: { viewColumn: 2 }, createWebviewPanel: mocks.createPanel },
  ViewColumn: { One: 1 },
  Uri: { joinPath: (...parts: string[]) => parts.join("/") }
}));
vi.mock("@/extension/config", () => ({
  extConfig: { tabIconColourTheme: () => "colour", gitPath: () => "git" }
}));
vi.mock("@/backend/utils/git", () => ({ workTreeRoot: mocks.workTreeRoot }));
vi.mock("@/extension/workspace-scan", () => ({ addSessionRepo: mocks.addSessionRepo }));
vi.mock("@/extension/html", () => ({ createWebviewHtml: () => "<html>graph</html>" }));
vi.mock("@/extension/legacy", () => ({
  createMessageProtocol: () => ({ attach: mocks.disposable })
}));
vi.mock("@/extension/rpc/rpc-server", () => ({
  createRpcServer: () => ({ attach: mocks.disposable })
}));
vi.mock("@/extension/rpc/rpc-notify", () => ({
  initRpcNotify: mocks.disposable,
  rpcNotify: { notify: mocks.notify }
}));
vi.mock("@/extension/watchers/config.watcher", () => ({ initConfigWatcher: mocks.disposable }));
vi.mock("@/extension/watchers/git.watcher", () => ({ watchGitDir: mocks.disposable }));
vi.mock("@/extension/watchers/git-repo.watcher", () => ({ watchGitRepo: mocks.disposable }));

beforeEach(() => {
  vi.clearAllMocks();
});

/** Let pending top-level lookups finish. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function sourceControl(fsPath: string) {
  return { rootUri: { fsPath } } as unknown as import("vscode").SourceControl;
}

it("honors SCM clicks on a new or existing panel, including clicks before initialization", async () => {
  let receive: ((message: unknown) => void) | undefined;
  const panel = {
    webview: {
      html: "",
      onDidReceiveMessage: (handler: (message: unknown) => void) => {
        receive = handler;
        return mocks.disposable();
      }
    },
    reveal: vi.fn(),
    onDidDispose: mocks.disposable
  };
  mocks.createPanel.mockReturnValue(panel);
  const command = createViewCommand({
    extensionUri: "/extension"
  } as unknown as import("vscode").ExtensionContext);
  command(sourceControl("/workspace/first"));
  command(sourceControl("/workspace/second"));
  await settle();
  expect(mocks.notify).not.toHaveBeenCalled();
  receive?.({ command: "viewReady" });
  expect(mocks.notify).toHaveBeenLastCalledWith("repo.select", {
    name: "second",
    path: "/workspace/second"
  });

  command(sourceControl("/workspace/first"));
  await settle();
  expect(mocks.notify).toHaveBeenLastCalledWith("repo.select", {
    name: "first",
    path: "/workspace/first"
  });
  command();
  await settle();
  expect(mocks.notify).toHaveBeenCalledTimes(2);
  expect(mocks.createPanel).toHaveBeenCalledOnce();
  expect(panel.reveal).toHaveBeenCalledTimes(3);
  expect(panel.webview.html).toBe("<html>graph</html>");
});

it("selects the top level of a clicked subfolder, and the latest click wins", async () => {
  let receive: ((message: unknown) => void) | undefined;
  mocks.createPanel.mockReturnValue({
    webview: {
      html: "",
      onDidReceiveMessage: (handler: (message: unknown) => void) => {
        receive = handler;
        return mocks.disposable();
      }
    },
    reveal: vi.fn(),
    onDidDispose: mocks.disposable
  });
  const slow = Promise.withResolvers<string | null>();
  mocks.workTreeRoot
    .mockImplementationOnce(() => slow.promise)
    .mockImplementationOnce(async () => "/real/repo");
  const command = createViewCommand({
    extensionUri: "/extension"
  } as unknown as import("vscode").ExtensionContext);
  command(sourceControl("/workspace/slow"));
  command(sourceControl("/workspace/link/packages"));
  receive?.({ command: "viewReady" });
  await settle();
  slow.resolve("/other");
  await settle();
  expect(mocks.notify.mock.calls).toEqual([["repo.select", { name: "repo", path: "/real/repo" }]]);
  // The superseded click still offers its repository.
  expect(mocks.addSessionRepo.mock.calls).toEqual([["/real/repo"], ["/other"]]);
});
