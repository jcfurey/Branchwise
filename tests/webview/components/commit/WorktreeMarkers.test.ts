// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  GitCommitNode,
  GitRef,
  RepositoryQueryData,
  RepositoryState,
  WorktreeChange,
  WorktreeDetails
} from "@/backend/types";
import { CommitRow } from "@/webview/components/commit/CommitRow";
import { refMenu } from "@/webview/lib/menus";
import {
  handleRepositoryQuery,
  requestRepositoryState,
  resetRepositoryState
} from "@/webview/lib/repository-actions";
import { contextMenu, selectedRepo } from "@/webview/lib/stores";
import { worktreeName } from "@/webview/lib/worktrees";
import type { ContextMenuEntry } from "@/webview/types";

import {
  attachHost,
  reconfigure,
  speak
} from "@tests/webview/components/commit/commit-view-fixtures";
import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const LINUX = "Mozilla/5.0 (X11; Linux x86_64) Code/1.140.0";
const MAIN = "/work/app";
const TIP = "a1b2c3d4";
const OLD = "0f0e0d0c";

const worktree = (more: Partial<WorktreeDetails> & { path: string }): WorktreeDetails => ({
  head: TIP,
  branch: "",
  bare: false,
  locked: false,
  prunable: false,
  ...more
});

/** The main worktree on `main`, a linked one on `feature`, and one on a detached HEAD. */
const WORKTREES = [
  worktree({ path: MAIN, branch: "main", head: OLD }),
  worktree({ path: "/work/feature-x", branch: "feature" }),
  worktree({ path: "/work/app/wt/probe", head: OLD })
];

const state = (worktrees: Array<WorktreeDetails> = WORKTREES): RepositoryState => ({
  remotes: [],
  pushDefault: null,
  branches: [],
  remoteBranches: [],
  tags: [],
  worktrees,
  head: "main",
  operation: null,
  conflicts: [],
  staged: 0
});

type Posted = { command: string; repo?: string; requestId?: string; [field: string]: unknown };
const outbox = (): Array<Posted> => vscodeApi.postMessage.mock.calls.map(([sent]) => sent);
const newest = () => outbox().at(-1)!;
const reads = (kind: string) =>
  outbox().filter(
    (sent) =>
      sent.command === "repositoryQuery" && (sent["query"] as { kind: string }).kind === kind
  );

function reply(request: Posted, data: RepositoryQueryData) {
  act(() =>
    handleRepositoryQuery({
      repo: request.repo!,
      requestId: request.requestId!,
      data,
      status: null
    })
  );
}

/** Load `loaded` as the repository state, then answer the check of the other worktrees. */
function load(loaded: RepositoryState, changes?: Array<WorktreeChange>) {
  requestRepositoryState();
  reply(newest(), { kind: "state", state: loaded });
  const check = reads("worktreeChanges").at(-1);
  if (changes !== undefined && check !== undefined) {
    reply(check, { kind: "worktreeChanges", worktrees: changes });
  }
}

const commit = (hash: string, refs: Array<GitRef>): GitCommitNode => ({
  hash,
  parentHashes: [],
  author: "Tester",
  email: "t@example.test",
  date: 0,
  message: `subject of ${hash}`,
  refs
});

let body: HTMLTableSectionElement;

function draw(row: GitCommitNode) {
  act(() =>
    render(
      h(CommitRow, {
        commit: row,
        isHead: false,
        headBranch: "main",
        messages: new Map(),
        colour: undefined,
        expanded: false,
        onSelect: undefined
      }),
      body
    )
  );
}

const marks = () => [...body.querySelectorAll<HTMLElement>("[data-worktree]")];
const titles = (entries: Array<ContextMenuEntry> | undefined) =>
  (entries ?? []).map((entry) => entry?.title ?? null);

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  speak({
    worktreeLabel: "worktree: {0}",
    worktreeTitle: "Worktree: {0}",
    worktreeDirty: "Has uncommitted changes",
    detachedHead: "Detached HEAD",
    lockedWorktree: "Locked",
    prunableWorktree: "Missing worktree"
  });
  // The page names the reveal entry after the window's platform; Linux unless a test says so.
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue(LINUX);
  selectedRepo.value = MAIN;
  resetRepositoryState();
  contextMenu.value = null;
  vscodeApi.postMessage.mockClear();
  body = document.createElement("tbody");
  attachHost().append(body);
});
afterEach(() => {
  act(() => render(null, body));
  resetRepositoryState();
  vi.restoreAllMocks();
});

describe("worktreeName", () => {
  it.each([
    ["/work/feature-x", "/work/app", "../feature-x"],
    ["/work/app/wt/probe", "/work/app", "wt/probe"],
    ["/elsewhere/feature", "/work/app", "/elsewhere/feature"],
    ["/work/app", "/work/app", "/work/app"],
    ["/feature", "/app", "/feature"],
    ["c:/src/feature", "c:/src/app", "../feature"]
  ])("names %s beside the main worktree %s as %s", (folder, main, name) => {
    expect(worktreeName(folder, main)).toBe(name);
  });
});

describe("checking other worktrees", () => {
  it("asks once the state names a worktree other than the one shown", () => {
    load(state());
    expect(reads("worktreeChanges")).toHaveLength(1);
    expect(reads("worktreeChanges")[0]).toMatchObject({ repo: MAIN });
  });

  it("does not ask when the shown worktree is the only one, or the setting is off", () => {
    load(state([WORKTREES[0]!]));
    const restore = reconfigure({ showWorktrees: false });
    try {
      load(state());
    } finally {
      restore();
    }
    expect(reads("worktreeChanges")).toHaveLength(0);
  });
});

describe("worktree marks in the graph", () => {
  it("badges the branch label of a worktree, with a dot and a tooltip for changes", () => {
    load(state(), [
      { path: "/work/feature-x", state: "dirty" },
      { path: "/work/app/wt/probe", state: "clean" }
    ]);
    draw(commit(TIP, [{ type: "head", name: "feature", hash: TIP }]));

    const [badge] = marks();
    expect(marks()).toHaveLength(1);
    expect(badge!.closest("[data-ref]")).not.toBeNull();
    expect(badge!.dataset["worktree"]).toBe("/work/feature-x");
    expect(badge!.hasAttribute("data-worktree-dirty")).toBe(true);
    expect(badge!.title.split("\n")).toEqual([
      "Worktree: ../feature-x",
      "feature",
      "Has uncommitted changes"
    ]);
    // The dot is not colour alone: it is named as well.
    expect(badge!.querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
      "Has uncommitted changes"
    );
  });

  it("gives a worktree on a detached HEAD a label of its own", () => {
    load(state(), [{ path: "/work/app/wt/probe", state: "clean" }]);
    draw(commit(OLD, [{ type: "head", name: "main", hash: OLD }]));

    const [label] = marks();
    expect(marks()).toHaveLength(1);
    expect(label!.closest("[data-ref]")).toBeNull();
    expect(label!.textContent).toBe("worktree: wt/probe");
    expect(label!.hasAttribute("data-worktree-dirty")).toBe(false);
    expect(label!.title.split("\n")).toEqual(["Worktree: wt/probe", "Detached HEAD"]);
  });

  it("names a locked worktree and one whose folder is missing", () => {
    load(
      state([
        WORKTREES[0]!,
        worktree({ path: "/work/locked", branch: "kept", locked: true }),
        worktree({ path: "/work/gone", prunable: true })
      ]),
      []
    );
    draw(commit(TIP, [{ type: "head", name: "kept", hash: TIP }]));

    expect(marks().map((mark) => mark.title.split("\n"))).toEqual([
      ["Worktree: ../locked", "kept", "Locked"],
      ["Worktree: ../gone", "Detached HEAD", "Missing worktree"]
    ]);
  });

  it("marks nothing of the worktree shown, and nothing while the setting is off", () => {
    load(state());
    draw(commit(OLD, [{ type: "head", name: "main", hash: OLD }]));
    expect(marks().map((mark) => mark.dataset["worktree"])).toEqual(["/work/app/wt/probe"]);

    const restore = reconfigure({ showWorktrees: false });
    try {
      draw(commit(TIP, [{ type: "head", name: "feature", hash: TIP }]));
      expect(marks()).toEqual([]);
      // The branch label keeps its plain sign of being checked out elsewhere.
      expect(body.querySelector("[data-ref]")!.textContent).toContain("↗");
    } finally {
      restore();
    }
  });
});

describe("worktree actions", () => {
  it("adds opening and revealing the worktree to its branch's menu", () => {
    load(state(), [{ path: "/work/feature-x", state: "clean" }]);
    const entries = refMenu({ type: "head", name: "feature", hash: TIP }, false);
    expect(titles(entries)).toEqual(
      expect.arrayContaining(["openWorktreeWindow", "revealWorktreeOther"])
    );
    expect(titles(refMenu({ type: "head", name: "main", hash: OLD }, true))).not.toContain(
      "openWorktreeWindow"
    );

    vscodeApi.postMessage.mockClear();
    act(() => entries.find((entry) => entry?.title === "revealWorktreeOther")!.onClick());
    expect(newest()).toMatchObject({
      command: "repositoryAction",
      repo: MAIN,
      action: { kind: "revealWorktree", path: "/work/feature-x" }
    });
  });

  it.each([
    ["Windows", "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Code/1.140.0", "revealWorktreeWindows"],
    ["macOS", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Code/1.140.0", "revealWorktreeMac"],
    ["Linux", LINUX, "revealWorktreeOther"]
  ])("names the reveal entry as VS Code does on %s", (_platform, agent, title) => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(agent);
    load(state(), [{ path: "/work/feature-x", state: "clean" }]);
    const entries = refMenu({ type: "head", name: "feature", hash: TIP }, false);
    const at = titles(entries).indexOf("openWorktreeWindow");
    expect(titles(entries).slice(at, at + 2)).toEqual(["openWorktreeWindow", title]);
  });

  it("opens a worktree from its own label's menu", () => {
    load(state(), []);
    draw(commit(OLD, []));
    const [label] = marks();
    act(() => {
      label!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    const entries = contextMenu.value?.entries;
    expect(titles(entries)).toEqual(["openWorktreeWindow", "revealWorktreeOther"]);

    vscodeApi.postMessage.mockClear();
    act(() => entries![0]!.onClick());
    expect(newest()).toMatchObject({
      command: "repositoryAction",
      action: { kind: "openWorktree", path: "/work/app/wt/probe" }
    });
  });

  it("offers neither for a worktree whose folder is missing", () => {
    load(state(), [
      { path: "/work/feature-x", state: "missing" },
      { path: "/work/app/wt/probe", state: "missing" }
    ]);
    expect(titles(refMenu({ type: "head", name: "feature", hash: TIP }, false))).not.toContain(
      "openWorktreeWindow"
    );
    draw(commit(OLD, []));
    act(() => {
      marks()[0]!.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
    });
    // The label has no menu of its own, so the commit's opens, without the worktree's entries.
    expect(contextMenu.value?.source).toBe(`commit:${OLD}`);
    expect(titles(contextMenu.value?.entries)).not.toContain("openWorktreeWindow");
    expect(titles(contextMenu.value?.entries)).not.toContain("revealWorktreeOther");
  });
});
