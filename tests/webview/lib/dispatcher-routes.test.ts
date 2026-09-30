// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { initDispatcher } from "@/webview/lib/dispatcher";

// Every target is a recorder, so each command can be traced to the one function it reaches.
const trace = vi.hoisted(() => {
  const log: Array<{ name: string; args: Array<unknown> }> = [];
  const fns = new Map<string, ReturnType<typeof vi.fn>>();
  const recorder = (name: string) => {
    const fn = vi.fn((...args: Array<unknown>) => {
      log.push({ name, args });
    });
    fns.set(name, fn);
    return fn;
  };
  return { log, fns, recorder };
});

vi.mock("@/webview/lib/actions", () => ({
  receiveRepoState: trace.recorder("receiveRepoState"),
  selectRepo: trace.recorder("selectRepo")
}));
vi.mock("@/webview/components/history/HistoryTools", () => ({
  openFileHistory: trace.recorder("openFileHistory")
}));
vi.mock("@/webview/lib/handler/action-result", () => ({
  handleActionResult: trace.recorder("handleActionResult")
}));
vi.mock("@/webview/lib/handler/commit-details", () => ({
  handleCommitDetails: trace.recorder("handleCommitDetails")
}));
vi.mock("@/webview/lib/handler/graph-query-error", () => ({
  handleGraphQueryError: trace.recorder("handleGraphQueryError")
}));
vi.mock("@/webview/lib/handler/load-branches", () => ({
  handleLoadBranches: trace.recorder("handleLoadBranches")
}));
vi.mock("@/webview/lib/handler/load-commits", () => ({
  handleLoadCommits: trace.recorder("handleLoadCommits")
}));
vi.mock("@/webview/lib/handler/refresh", () => ({
  handleRefresh: trace.recorder("handleRefresh")
}));
vi.mock("@/webview/lib/handler/view-diff", () => ({
  handleViewDiff: trace.recorder("handleViewDiff")
}));
vi.mock("@/webview/lib/remote-actions", () => ({
  handleLoadRemotes: trace.recorder("handleLoadRemotes")
}));
vi.mock("@/webview/lib/repository-actions", () => ({
  handleRepositoryQuery: trace.recorder("handleRepositoryQuery")
}));

const escaped: Array<unknown> = [];
function onError(event: ErrorEvent) {
  escaped.push(event.error);
  event.preventDefault();
}

let warn: ReturnType<typeof vi.spyOn>;

beforeAll(() => {
  initDispatcher();
});

beforeEach(() => {
  trace.log.length = 0;
  escaped.length = 0;
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  window.addEventListener("error", onError);
});

afterEach(() => {
  window.removeEventListener("error", onError);
  vi.restoreAllMocks();
});

function deliver(data: unknown) {
  window.dispatchEvent(new MessageEvent("message", { data }));
}

const ACTIONS = [
  "repositoryAction",
  "addTag",
  "checkoutBranch",
  "checkoutCommit",
  "cherrypickCommit",
  "createBranch",
  "deleteBranch",
  "deleteTag",
  "mergeBranch",
  "mergeCommit",
  "pushTag",
  "pushBranch",
  "pullBranch",
  "fetchRemote",
  "renameBranch",
  "resetToCommit",
  "revertCommit"
];

const SINGLE_ROUTES: Array<[string, string]> = [
  ["repoState", "receiveRepoState"],
  ["graphQueryError", "handleGraphQueryError"],
  ["repositoryQuery", "handleRepositoryQuery"],
  ["loadRemotes", "handleLoadRemotes"],
  ["commitDetails", "handleCommitDetails"],
  ["loadBranches", "handleLoadBranches"],
  ["loadCommits", "handleLoadCommits"],
  ["viewDiff", "handleViewDiff"],
  ...ACTIONS.map((command): [string, string] => [command, "handleActionResult"])
];

describe("routes", () => {
  it.each(SINGLE_ROUTES)("hands %s to %s with the message itself", (command, target) => {
    const message = { command, repo: "/r", path: "p" };
    deliver(message);
    expect(trace.log).toHaveLength(1);
    expect(trace.log[0]!.name).toBe(target);
    expect(trace.log[0]!.args).toHaveLength(1);
    expect(trace.log[0]!.args[0]).toBe(message);
  });

  it("switches repository, then follows the file", () => {
    deliver({ command: "fileHistory", repo: "/r", path: "p" });
    expect(trace.log).toEqual([
      { name: "selectRepo", args: ["/r"] },
      { name: "openFileHistory", args: ["p"] }
    ]);
  });

  it("reloads on refresh, passing nothing on", () => {
    deliver({ command: "refresh", repo: "/r", path: "p" });
    expect(trace.log).toEqual([{ name: "handleRefresh", args: [] }]);
  });

  it("covers all 27 commands", () => {
    expect(SINGLE_ROUTES.length + ["fileHistory", "refresh"].length).toBe(27);
  });

  it("treats a message with both a kind and a command as a command", () => {
    deliver({ kind: "rpc.notify", id: "n", name: "repo.updated", message: {}, command: "refresh" });
    expect(trace.log.map((entry) => entry.name)).toEqual(["handleRefresh"]);
  });
});

describe("what is not routed", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["a string", "refresh"],
    ["a number", 3],
    ["an array", []],
    ["a number as command", { command: 5 }],
    ["an RPC answer", { kind: "rpc.response", id: "x", success: true, result: 1 }]
  ])("passes over %s without a word", (_label, data) => {
    deliver(data);
    expect(trace.log).toEqual([]);
    expect(warn).not.toHaveBeenCalled();
    expect(escaped).toEqual([]);
  });

  it.each(["bogus", "", "toString", "constructor", "hasOwnProperty", "valueOf", "__proto__"])(
    "warns about the unknown command %j and does nothing else",
    (command) => {
      deliver({ command });
      expect(warn).toHaveBeenCalledOnce();
      expect(warn).toHaveBeenCalledWith("no handler for", command);
      expect(trace.log).toEqual([]);
      expect(escaped).toEqual([]);
    }
  );
});

describe("the listener", () => {
  it("lets a handler's exception escape, and routes the next message", () => {
    trace.fns.get("handleViewDiff")!.mockImplementationOnce(() => {
      throw new Error("broken handler");
    });
    deliver({ command: "viewDiff", success: false });
    deliver({ command: "viewDiff", success: false });

    expect(escaped).toEqual([new Error("broken handler")]);
    expect(trace.log.map((entry) => entry.name)).toEqual(["handleViewDiff"]);
  });

  it("is installed once, however often the dispatcher is started", () => {
    initDispatcher();
    initDispatcher();
    deliver({ command: "refresh" });
    expect(trace.log).toHaveLength(1);
  });
});
