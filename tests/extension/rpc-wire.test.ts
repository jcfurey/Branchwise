import { beforeEach, expect, test, vi } from "vitest";

import { createRpcServer } from "@/extension/rpc/rpc-server";

import { themeGraphColours } from "./manifest";

const host = vi.hoisted(() => ({
  executeCommand: vi.fn(),
  writeText: vi.fn()
}));

vi.mock("vscode", () => ({
  commands: { executeCommand: host.executeCommand },
  env: { language: "en", clipboard: { writeText: host.writeText } },
  l10n: { t: (key: string) => key },
  workspace: {
    workspaceFolders: undefined,
    getConfiguration: () => ({
      get: (_key: string, fallback?: unknown) => fallback,
      inspect: () => undefined
    })
  }
}));

let deliver: (message: unknown) => Promise<void>;
const responses: unknown[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  responses.length = 0;
  host.executeCommand.mockResolvedValue(undefined);
  host.writeText.mockResolvedValue(undefined);
  createRpcServer().attach({
    onDidReceiveMessage(listener: (message: unknown) => Promise<void>) {
      deliver = listener;
      return { dispose() {} };
    },
    async postMessage(message: unknown) {
      responses.push(message);
      return true;
    }
  } as unknown as import("vscode").Webview);
});

/** Send one request from the page and return the one response it gets. */
async function ask(method: string, params: unknown = null) {
  await deliver({ kind: "rpc.request", id: "7", method, params });
  expect(responses).toHaveLength(1);
  return responses[0];
}

const success = (result: unknown) => ({ kind: "rpc.response", id: "7", success: true, result });
const failure = (error: string) => ({ kind: "rpc.response", id: "7", success: false, error });

test("copies text the page sends", async () => {
  expect(await ask("clipboard.copy", "abc")).toEqual(success(true));
  expect(host.writeText).toHaveBeenCalledExactlyOnceWith("abc");
});

test("refuses to copy something that is not text", async () => {
  expect(await ask("clipboard.copy", 5)).toEqual(failure("Invalid copyToClipboard parameters"));
  expect(host.writeText).not.toHaveBeenCalled();
});

test("starts VS Code's repository initialization, whatever params come along", async () => {
  expect(await ask("git.init", { x: 1 })).toEqual(success(true));
  expect(host.executeCommand).toHaveBeenCalledExactlyOnceWith("git.init");
});

test("reports why repository initialization could not start", async () => {
  host.executeCommand.mockRejectedValueOnce(new Error("command 'git.init' not found"));
  expect(await ask("git.init")).toEqual(failure("command 'git.init' not found"));
});

test("lists no repositories without workspace folders", async () => {
  expect(await ask("repo.scan")).toEqual(success({ repos: [] }));
});

test.each([
  ["settings.open", ["workbench.action.openSettings", "branchwise"]],
  ["docs.open", ["branchwise.openDocumentation"]],
  ["walkthrough.open", ["branchwise.openWalkthrough"]],
  ["git.clone", ["git.clone"]],
  ["folder.open", ["vscode.openFolder"]]
])("opens what %s asks for", async (method, command) => {
  expect(await ask(method)).toEqual(success(true));
  expect(host.executeCommand).toHaveBeenCalledExactlyOnceWith(...command);
});

test("hands the page its strings and settings", async () => {
  const response = (await ask("webview.initialize")) as {
    success: boolean;
    result: { l10n: Record<string, string>; config: unknown };
  };
  expect(response.success).toBe(true);
  expect(response.result.l10n["repo"]).toBe("Repository");
  expect(Object.keys(response.result.l10n).length).toBeGreaterThan(100);
  expect(response.result.config).toEqual({
    autoCenterCommitDetailsView: true,
    commitDetailsPosition: "inline",
    conflictForecast: "localAndRemote",
    dateFormat: "Date & Time",
    dragAndDrop: true,
    graphColours: themeGraphColours,
    graphStyle: "rounded",
    initialLoadCommits: 300,
    issueLinks: [],
    loadMoreCommits: 100,
    locale: "en",
    showCurrentBranchByDefault: false,
    singleKeyShortcuts: true
  });
});
