// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { BulkSyncPlan, RepositoryQueryData, SyncPlan, WorkspaceEntry } from "@/backend/types";
import type { LocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import { WorkspacePane } from "@/webview/components/history/WorkspacePane";
import { Dialog } from "@/webview/components/ui/Dialog";
import { closeDialog } from "@/webview/lib/actions";
import { setWorkspaceFilter, setWorkspaceOrder, workspaceFilter } from "@/webview/lib/navigation";
import { acceptRemoteActionResult } from "@/webview/lib/remote-actions";
import { handleRepositoryQuery, repositoryRevision } from "@/webview/lib/repository-actions";
import { dialog, selectedRepo } from "@/webview/lib/stores";
import { workspaceJobs } from "@/webview/lib/workspace-actions";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

setupWebviewTest();

/** The English templates these tests read; every other string stays its key name. */
const ENGLISH: Partial<Record<keyof LocalizedStrings, string>> = {
  workspaceNeedAttention: "{0} need attention",
  workspaceNeedsAttentionOne: "1 needs attention",
  workspaceUnpushed: "{0} unpushed",
  workspaceBehind: "{0} behind",
  workspaceConflicted: "{0} conflicted",
  workspaceWithChanges: "{0} with changes",
  conflictedFiles: "{0} conflicted files",
  operationInProgress: "{0} in progress",
  mergeOperation: "Merge",
  stashCount: "{0} stashes",
  otherBranchesAhead: "{0} other branches ahead",
  fetchedAgo: "fetched {0}",
  fastForwardBehind: "{0} → {1}, {2} new commits",
  bulkPushStep: "{0} → {1}, {2} commits",
  bulkSkipBranch: "Skip {0}: {1}",
  bulkSkipRepository: "Skip: {0}",
  bulkSkipUncommitted: "uncommitted changes",
  bulkSkipDiverged: "diverged",
  bulkSkipNoUpstream: "no upstream",
  bulkSkipUpToDate: "up to date",
  bulkSkipNothingToPush: "nothing to push",
  bulkSkipUninitialized: "not initialized",
  bulkSkipNoRemote: "no remote",
  fastForwardRun: "Fast-forward {0} Branches",
  bulkRunPush: "Push {0} Branches",
  bulkRunFetch: "Fetch {0} Repositories",
  bulkSummary: "{0} completed · {1} skipped · {2} failed"
};
const keyNames = window.l10n;
const english = new Proxy(keyNames, {
  get: (target, key) =>
    (ENGLISH as Record<string | symbol, string | undefined>)[key] ?? Reflect.get(target, key)
});

let container: HTMLDivElement;
beforeEach(() => {
  Object.defineProperty(window, "l10n", { value: english, configurable: true });
  selectedRepo.value = "/ws/app";
  dialog.value = null;
  workspaceJobs.value = [];
  setWorkspaceFilter(null);
  setWorkspaceOrder("name");
  vscodeApi.postMessage.mockClear();
  vscodeApi.setState.mockClear();
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  closeDialog();
  Object.defineProperty(window, "l10n", { value: keyNames, configurable: true });
});

const DAY = 24 * 60 * 60;
const now = () => Math.floor(Date.now() / 1000);

function repo(path: string, patch: Partial<WorkspaceEntry> = {}): WorkspaceEntry {
  return {
    path,
    parent: null,
    submodulePath: null,
    recorded: null,
    committed: null,
    head: "a".repeat(40),
    branch: "main",
    dirty: 0,
    ahead: 0,
    behind: 0,
    initialized: true,
    error: null,
    operation: null,
    conflicts: 0,
    stashes: 0,
    detached: false,
    upstream: "origin/main",
    aheadBranches: 0,
    remotes: 1,
    fetched: now() - 60,
    ...patch
  };
}

/**
 * A workspace with a repository in each state: `/ws/app` is clean and holds `/ws/app/lib`,
 * which is behind; the others sit at the top level.
 */
const workspace = [
  repo("/ws/app"),
  repo("/ws/app/lib", { parent: "/ws/app", behind: 2 }),
  repo("/ws/docs", { dirty: 3 }),
  repo("/ws/merge", { operation: "merge", conflicts: 2, dirty: 2 }),
  repo("/ws/publish", { ahead: 1, stashes: 2 }),
  repo("/ws/spike", { upstream: null, fetched: now() - 3 * DAY }),
  repo("/ws/tools", { aheadBranches: 2 })
];

const requests = () => vscodeApi.postMessage.mock.calls.map(([request]) => request);
function respond(data: RepositoryQueryData, request = requests().at(-1)) {
  act(() =>
    handleRepositoryQuery({ repo: request.repo, requestId: request.requestId, data, status: null })
  );
}
/** The pane's last read of the whole workspace, or with `refresh`, of the selected repository. */
const workspaceRead = (refresh?: "selected") =>
  requests()
    .filter((request) => request.command === "repositoryQuery")
    .findLast((request) => request.query.kind === "workspace" && request.query.refresh === refresh);
/** Show the pane, and answer both its reads with `entries`. */
function show(entries = workspace) {
  act(() => render(h("div", {}, h(WorkspacePane, {}), h(Dialog, {})), container));
  respond({ kind: "workspace", entries }, workspaceRead("selected"));
  respond({ kind: "workspace", entries }, workspaceRead());
}
const chips = () =>
  [...container.querySelectorAll<HTMLButtonElement>("[data-total]")].map((chip) => [
    chip.textContent,
    chip.getAttribute("aria-pressed")
  ]);
const chip = (total: string) =>
  container.querySelector<HTMLButtonElement>(`[data-total=${total}]`)!;
const rows = () =>
  [...container.querySelectorAll<HTMLButtonElement>("aside button[title]")].map((row) => row.title);
const rowOf = (path: string) =>
  container.querySelector(`aside button[title="${path}"]`)!.closest<HTMLElement>("[style]")!;
/** Let the page finish what answers set off, such as reading plans four at a time. */
async function settle() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)));
}
function click(label: string) {
  const button = [...container.querySelectorAll("button")].find(
    (item) => item.textContent === label
  );
  expect(button, label).toBeDefined();
  act(() => button!.click());
}

describe("the overview strip", () => {
  it("totals the repositories in each state", () => {
    show();
    expect(chips()).toStrictEqual([
      ["6 need attention", "false"],
      ["3 unpushed", "false"],
      ["1 behind", "false"],
      ["1 conflicted", "false"],
      ["2 with changes", "false"]
    ]);
  });

  it("totals only what the text filter matches, and leaves out totals of none", () => {
    show();
    act(() => {
      const input = container.querySelector<HTMLInputElement>("input[aria-label=overviewFilter]")!;
      input.value = "/ws/app";
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(chips()).toStrictEqual([
      ["1 needs attention", "false"],
      ["1 behind", "false"]
    ]);
  });

  it("says nothing needs attention when every repository is clean", () => {
    show([repo("/ws/app"), repo("/ws/other")]);
    expect(chips()).toStrictEqual([]);
    expect(container.querySelector("[role=group]")!.textContent).toBe("workspaceAllClear");
  });

  it("narrows the tree to a total's repositories, under their parents, and remembers it", () => {
    show();
    act(() => chip("behind").click());
    // The clean parent stays for context; its siblings go.
    expect(rows()).toStrictEqual(["/ws/app", "/ws/app/lib"]);
    expect(chip("behind").getAttribute("aria-pressed")).toBe("true");
    expect(workspaceFilter.value).toBe("behind");
    expect(vscodeApi.setState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        navigation: expect.objectContaining({ workspaceFilter: "behind" })
      })
    );

    act(() => chip("unpushed").click());
    expect(rows()).toStrictEqual(["/ws/publish", "/ws/spike", "/ws/tools"]);
    act(() => chip("unpushed").click());
    expect(workspaceFilter.value).toBeNull();
    expect(rows()).toHaveLength(workspace.length);
  });

  it("keeps a chosen total on screen when it no longer counts anything", () => {
    setWorkspaceFilter("conflicted");
    show([repo("/ws/app")]);
    expect(chips()).toStrictEqual([["0 conflicted", "true"]]);
    expect(rows()).toStrictEqual([]);
  });
});

describe("ordering by what needs attention", () => {
  it("sorts siblings, conflicted first, then behind, unpushed, changed and clean", () => {
    show();
    expect(rows()).toStrictEqual(workspace.map((entry) => entry.path));
    act(() => {
      const select = container.querySelector<HTMLSelectElement>(
        "select[aria-label=workspaceOrder]"
      )!;
      select.value = "attention";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(rows()).toStrictEqual([
      "/ws/merge",
      // A clean parent sorts by its most urgent child, which stays beneath it.
      "/ws/app",
      "/ws/app/lib",
      "/ws/publish",
      "/ws/spike",
      "/ws/tools",
      "/ws/docs"
    ]);
    expect(vscodeApi.setState).toHaveBeenLastCalledWith(
      expect.objectContaining({
        navigation: expect.objectContaining({ workspaceOrder: "attention" })
      })
    );
  });
});

describe("the attention badges", () => {
  it("name an operation in progress, conflicts, stashes, other branches and a stale fetch", () => {
    show([
      ...workspace,
      repo("/ws/detached", { detached: true, branch: "", upstream: null }),
      repo("/ws/local", { upstream: null, remotes: 0 })
    ]);
    const text = (path: string) => rowOf(path).textContent;
    expect(text("/ws/merge")).toContain("Merge in progress");
    expect(text("/ws/merge")).toContain("2 conflicted files");
    expect(text("/ws/publish")).toContain("2 stashes");
    expect(text("/ws/tools")).toContain("2 other branches ahead");
    expect(text("/ws/spike")).toContain("unpublishedBranch");
    expect(text("/ws/spike")).toMatch(/fetched 3 days ago/);
    // A fetch within the day, a repository without remotes and a detached HEAD say nothing more.
    expect(text("/ws/app")).not.toContain("fetched");
    expect(text("/ws/local")).not.toContain("unpublishedBranch");
    expect(text("/ws/detached")).not.toContain("unpublishedBranch");
    expect(text("/ws/detached")).toContain("detachedHead aaaaaaaa");
    // Each badge carries its icon, and the detached HEAD its own.
    expect(rowOf("/ws/merge").querySelectorAll("span svg")).toHaveLength(2);
    expect(rowOf("/ws/detached").querySelector("p svg")).not.toBeNull();
    expect(rowOf("/ws/app").querySelector("p svg")).toBeNull();
  });
});

describe("bulk actions", () => {
  const sync = (branch: string, patch: Partial<SyncPlan>): SyncPlan => ({
    branch,
    remote: "origin",
    remoteBranch: branch,
    local: "b".repeat(40),
    remoteHead: "c".repeat(40),
    incoming: { entries: [], more: false },
    outgoing: { entries: [], more: false },
    ahead: 0,
    behind: 0,
    canFastForward: true,
    ...patch
  });
  const dialogText = () => container.querySelector("[role=dialog]")?.textContent ?? "";
  const planQueries = () =>
    requests().filter(
      (request) => request.command === "repositoryQuery" && request.query.kind === "bulkSyncPlan"
    );
  const actions = () => requests().filter((request) => request.command === "repositoryAction");

  it("pulls the filtered repositories after listing what happens in each", async () => {
    show([
      ...workspace,
      repo("/ws/fresh", { initialized: false, behind: 1 }),
      repo("/ws/offline", { remotes: 0, behind: 1, upstream: null })
    ]);
    act(() => chip("behind").click());
    click("bulkPull");
    // Repositories that cannot be pulled are skipped without asking them.
    expect(planQueries().map((request) => [request.repo, request.query.operation])).toStrictEqual([
      ["/ws/app/lib", "pull"]
    ]);
    const pull: BulkSyncPlan = {
      operation: "pull",
      syncs: [sync("main", { behind: 2 })],
      skipped: []
    };
    respond({ kind: "bulkSyncPlan", plan: pull }, planQueries()[0]);
    await settle();
    // The clean parent shown for context is not part of the set.
    expect(
      [...container.querySelectorAll<HTMLElement>("[role=dialog] li[data-repo]")].map(
        (item) => item.dataset.repo
      )
    ).toStrictEqual(["/ws/app/lib", "/ws/fresh", "/ws/offline"]);
    expect(dialogText()).toContain("main → origin/main, 2 new commits");
    expect(dialogText()).toContain("Skip: not initialized");
    expect(dialogText()).toContain("Skip: no remote");

    click("Fast-forward 1 Branches");
    expect(actions().map((request) => [request.repo, request.action])).toStrictEqual([
      [
        "/ws/app/lib",
        { kind: "sync", operation: "pull", plan: pull.syncs[0], force: false, setUpstream: false }
      ]
    ]);
    act(() => {
      acceptRemoteActionResult({ ...actions()[0], status: null });
    });
    await settle();
    expect(dialogText()).toContain("1 completed · 2 skipped · 0 failed");
  });

  it("lists the skipped branches with their reasons, and reports each repository's outcome", async () => {
    show([
      repo("/ws/app", { dirty: 1, behind: 1 }),
      repo("/ws/fork", { ahead: 1, behind: 1 }),
      repo("/ws/lib", { behind: 1 }),
      repo("/ws/svc", { behind: 3 }),
      repo("/ws/fresh", { initialized: false }),
      repo("/ws/offline", { remotes: 0 })
    ]);
    click("bulkPull");
    const plans: Record<string, BulkSyncPlan> = {
      "/ws/app": {
        operation: "pull",
        syncs: [],
        skipped: [{ branch: "main", reason: "uncommitted" }]
      },
      "/ws/fork": {
        operation: "pull",
        syncs: [],
        skipped: [{ branch: "main", reason: "diverged" }]
      },
      "/ws/lib": { operation: "pull", syncs: [sync("main", { behind: 1 })], skipped: [] },
      "/ws/svc": { operation: "pull", syncs: [sync("dev", { behind: 3 })], skipped: [] }
    };
    for (const request of planQueries()) {
      respond({ kind: "bulkSyncPlan", plan: plans[request.repo]! }, request);
    }
    await settle();
    const listed = () =>
      [...container.querySelectorAll<HTMLElement>("[role=dialog] li[data-repo]")].map((item) => [
        item.dataset.repo,
        [...item.querySelectorAll("ul li")].map((line) => line.textContent)
      ]);
    expect(listed()).toStrictEqual([
      ["/ws/app", ["Skip main: uncommitted changes"]],
      ["/ws/fork", ["Skip main: diverged"]],
      ["/ws/lib", ["main → origin/main, 1 new commits"]],
      ["/ws/svc", ["dev → origin/dev, 3 new commits"]],
      ["/ws/fresh", ["Skip: not initialized"]],
      ["/ws/offline", ["Skip: no remote"]]
    ]);

    click("Fast-forward 2 Branches");
    expect(actions().map((request) => request.repo)).toStrictEqual(["/ws/lib", "/ws/svc"]);
    act(() => {
      acceptRemoteActionResult({ ...actions()[0], status: "Not possible to fast-forward" });
    });
    act(() => {
      acceptRemoteActionResult({ ...actions()[1], status: null });
    });
    await settle();
    expect(dialogText()).toContain("1 completed · 4 skipped · 1 failed");
    expect(dialogText()).toContain("Not possible to fast-forward");
  });

  it("pushes only the branches the plans name, never forced", async () => {
    show();
    act(() => chip("unpushed").click());
    click("bulkPush");
    expect(planQueries().map((request) => request.repo)).toStrictEqual([
      "/ws/publish",
      "/ws/spike",
      "/ws/tools"
    ]);
    const plans: Record<string, BulkSyncPlan> = {
      "/ws/publish": { operation: "push", syncs: [sync("main", { ahead: 1 })], skipped: [] },
      "/ws/spike": {
        operation: "push",
        syncs: [],
        skipped: [{ branch: "main", reason: "noUpstream" }]
      },
      "/ws/tools": {
        operation: "push",
        syncs: [sync("one", { ahead: 1 }), sync("two", { ahead: 4 })],
        skipped: [{ branch: "main", reason: "upToDate" }]
      }
    };
    for (const request of planQueries()) {
      respond({ kind: "bulkSyncPlan", plan: plans[request.repo]! }, request);
    }
    await settle();
    expect(dialogText()).toContain("Skip main: no upstream");
    expect(dialogText()).toContain("two → origin/two, 4 commits");
    expect(dialogText()).toContain("Skip main: nothing to push");
    click("Push 3 Branches");
    expect(
      actions().map((request) => [request.repo, request.action.plan.branch, request.action.force])
    ).toStrictEqual([
      ["/ws/publish", "main", false],
      ["/ws/tools", "one", false]
    ]);
  });

  it("fetches every listed repository that has a remote", () => {
    show([...workspace, repo("/ws/offline", { remotes: 0 })]);
    click("bulkFetch");
    expect(dialogText()).toContain("Skip: no remote");
    click("Fetch 7 Repositories");
    expect(
      actions().map((request) => [request.repo, request.action.kind, request.action.remote])
    ).toStrictEqual([
      ["/ws/app", "fetch", null],
      ["/ws/app/lib", "fetch", null]
    ]);
  });
});

describe("choosing a repository in the pane", () => {
  const choose = (path: string) =>
    act(() => container.querySelector<HTMLButtonElement>(`aside button[title="${path}"]`)!.click());

  it("keeps listing the workspace while the newly selected repository reads it again", () => {
    show();
    choose("/ws/app/lib");
    expect(selectedRepo.value).toBe("/ws/app/lib");
    expect(workspaceRead()).toMatchObject({ repo: "/ws/app/lib" });
    // Every repository's status takes a while to read; the parent must not vanish meanwhile.
    expect(rows()).toStrictEqual(workspace.map((entry) => entry.path));
    expect(container.querySelector("aside [role=status]")).not.toBeNull();

    const entries = [repo("/ws/app"), repo("/ws/app/lib", { parent: "/ws/app" })];
    respond({ kind: "workspace", entries }, workspaceRead("selected"));
    expect(rows()).toStrictEqual(["/ws/app", "/ws/app/lib"]);
    respond({ kind: "workspace", entries }, workspaceRead());
    expect(container.querySelector("aside [role=status]")).toBeNull();
  });

  it("shows the newly selected repository's error rather than the earlier listing", () => {
    show();
    choose("/ws/docs");
    const request = workspaceRead();
    act(() =>
      handleRepositoryQuery({
        repo: request.repo,
        requestId: request.requestId,
        data: null,
        status: "fatal: not a git repository"
      })
    );
    expect(rows()).toStrictEqual([]);
    expect(container.querySelector("aside [role=alert]")!.textContent).toBe(
      "fatal: not a git repository"
    );
  });
});

describe("reading the selected repository on its own", () => {
  const changes = () => chip("changes").textContent;
  const withChanges = (dirty: number) =>
    workspace.map((entry) => (entry.path === "/ws/app" ? { ...entry, dirty } : entry));

  it("shows its status before the whole workspace is read", () => {
    act(() => render(h(WorkspacePane, {}), container));
    expect(
      requests()
        .filter((request) => request.command === "repositoryQuery")
        .map((request) => [request.repo, request.query])
    ).toStrictEqual([
      ["/ws/app", { kind: "workspace" }],
      ["/ws/app", { kind: "workspace", refresh: "selected" }]
    ]);

    respond({ kind: "workspace", entries: [repo("/ws/app")] }, workspaceRead("selected"));
    expect(rows()).toStrictEqual(["/ws/app"]);
    expect(container.querySelector("aside [role=status]")).not.toBeNull();

    const name = container.querySelector<HTMLButtonElement>('aside button[title="/ws/app"]')!;
    name.focus();
    respond({ kind: "workspace", entries: workspace }, workspaceRead());
    expect(rows()).toStrictEqual(workspace.map((entry) => entry.path));
    expect(container.querySelector("aside [role=status]")).toBeNull();
    // The row gained a toggle for the repository inside it; the focused name stays as it was.
    expect(document.activeElement).toBe(name);
    expect(name.title).toBe("/ws/app");
  });

  it("shows whichever listing came last, as both list the whole workspace", () => {
    show();
    expect(changes()).toBe("2 with changes");

    act(() => {
      repositoryRevision.value++;
    });
    respond({ kind: "workspace", entries: withChanges(1) }, workspaceRead("selected"));
    expect(changes()).toBe("3 with changes");
    // The whole listing began before the selected repository was read again, and finishes after.
    respond({ kind: "workspace", entries: withChanges(0) }, workspaceRead());
    expect(changes()).toBe("2 with changes");

    act(() => {
      repositoryRevision.value++;
    });
    respond({ kind: "workspace", entries: withChanges(4) }, workspaceRead("selected"));
    expect(changes()).toBe("3 with changes");
  });
});
