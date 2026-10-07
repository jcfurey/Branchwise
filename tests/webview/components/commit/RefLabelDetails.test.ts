// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitRef, RepositoryState } from "@/backend/types";
import { RefLabel } from "@/webview/components/commit/RefLabel";
import { BranchIcon, TagIcon } from "@/webview/components/ui/Icons";
import { refMenu } from "@/webview/lib/menus";
import { repositoryState } from "@/webview/lib/repository-actions";
import {
  branchDisplay,
  contextMenu,
  focusPaused,
  selectedBranch,
  selectedRepo
} from "@/webview/lib/stores";

import { attachHost, speak } from "@tests/webview/components/commit/commit-view-fixtures";
import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

/** Four local branches, two of them checked out in worktrees. */
const STATE: RepositoryState = {
  remotes: [],
  pushDefault: null,
  branches: [
    {
      name: "main",
      hash: "1",
      upstream: "origin/main",
      ahead: 2,
      behind: 0,
      gone: false,
      date: 0,
      merged: false
    },
    {
      name: "feat",
      hash: "2",
      upstream: "origin/feat",
      ahead: 0,
      behind: 0,
      gone: false,
      date: 0,
      merged: false
    },
    {
      name: "gone",
      hash: "3",
      upstream: "origin/gone",
      ahead: 1,
      behind: 3,
      gone: true,
      date: 0,
      merged: false
    },
    {
      name: "wt",
      hash: "4",
      upstream: "",
      ahead: 5,
      behind: 0,
      gone: false,
      date: 0,
      merged: false
    }
  ],
  remoteBranches: [],
  tags: [],
  worktrees: [
    { path: "/repo", head: "1", branch: "main", bare: false, locked: false, prunable: false },
    { path: "/repo-wt", head: "4", branch: "wt", bare: false, locked: false, prunable: false }
  ],
  head: "main",
  operation: null,
  conflicts: [],
  staged: 0
};

const ref = (type: GitRef["type"], name: string): GitRef => ({ hash: "1", name, type });

let host: HTMLDivElement;

function drawLabel(gitRef: GitRef, active = false) {
  act(() => render(h(RefLabel, { gitRef, active }), host));
  return host.firstElementChild as HTMLSpanElement;
}

/** The drawing inside an icon, whatever size or class a caller gives it. */
function glyphOf(icon: typeof TagIcon) {
  const scratch = document.createElement("div");
  render(h(icon, {}), scratch);
  return scratch.querySelector("svg")!.innerHTML;
}

/** What a label says: its tooltip lines and the text of whatever follows the name. */
function describeLabel(label: HTMLSpanElement) {
  const [, , ...after] = [...label.children];
  return { title: label.title.split("\n"), after: after.map((child) => child.textContent) };
}

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  speak();
  repositoryState.value = STATE;
  branchDisplay.value = "filter";
  selectedBranch.value = undefined;
  focusPaused.value = false;
  contextMenu.value = null;
  selectedRepo.value = "/repo";
  vscodeApi.postMessage.mockClear();
  host = attachHost();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  repositoryState.value = null;
  contextMenu.value = null;
});

describe("RefLabel", () => {
  it.each([
    [
      "head",
      "main",
      true,
      ["main", "tooltipCurrentBranch", "origin/main", "worktreeAt"],
      ["↑2 ↓0"]
    ],
    ["head", "main", false, ["main", "origin/main", "worktreeAt"], ["↑2 ↓0", "↗"]],
    ["head", "feat", false, ["feat", "origin/feat"], []],
    ["head", "gone", false, ["gone", "origin/gone", "upstreamGone"], []],
    // Another worktree's branch carries its worktree badge, which is an icon, in place of ↗.
    ["head", "wt", false, ["wt", "worktreeAt"], [""]],
    ["remote", "origin/main", false, ["origin/main"], []],
    ["tag", "main", false, ["main"], []]
  ] as const)("describes %s %s (active: %s)", (type, name, active, title, after) => {
    const label = drawLabel(ref(type, name), active);

    expect(describeLabel(label)).toEqual({ title, after });
    expect(label.classList.contains("border-graph")).toBe(active);
    expect(label.querySelector("span")!.textContent).toBe(name);
    expect(label.querySelector("span")!.classList.contains("font-bold")).toBe(active);
  });

  it("names only the name and the current branch without repository state", () => {
    repositoryState.value = null;

    expect(describeLabel(drawLabel(ref("head", "main"), true))).toEqual({
      title: ["main", "tooltipCurrentBranch"],
      after: []
    });
  });

  it("reads the worktree path literally into the tooltip", () => {
    speak({
      tooltipCurrentBranch: "Current branch",
      worktreeAt: "Checked out at {0}"
    });
    repositoryState.value = {
      ...STATE,
      worktrees: [{ ...STATE.worktrees[1]!, path: "/home/u/wt$&x$'$$", branch: "feat" }]
    };

    expect(drawLabel(ref("head", "feat")).title).toBe(
      "feat\norigin/feat\nChecked out at /home/u/wt$&x$'$$"
    );
  });

  it("draws a tag with the tag glyph and a branch with the branch glyph", () => {
    const tag = glyphOf(TagIcon);
    const branch = glyphOf(BranchIcon);
    expect(tag).not.toBe(branch);

    expect(drawLabel(ref("tag", "v1")).querySelector("svg")!.innerHTML).toBe(tag);
    expect(drawLabel(ref("head", "main")).querySelector("svg")!.innerHTML).toBe(branch);
    expect(drawLabel(ref("remote", "origin/main")).querySelector("svg")!.innerHTML).toBe(branch);
  });

  it("carries the focus badge for the focused branch, after the name", () => {
    branchDisplay.value = "focus";
    selectedBranch.value = "main";
    let label = drawLabel(ref("head", "main"), true);
    const badge = () => label.querySelector<HTMLElement>("[data-focus-branch]");
    expect(badge()?.dataset["focusBranch"]).toBe("main");
    expect(badge()?.dataset["focusPaused"]).toBe("false");
    expect(label.children[2]).toBe(badge());
    expect(label.children[3]!.textContent).toBe("↑2 ↓0");

    act(() => {
      focusPaused.value = true;
    });
    expect(badge()?.dataset["focusPaused"]).toBe("true");

    selectedBranch.value = "remotes/origin/main";
    label = drawLabel(ref("remote", "origin/main"));
    expect(badge()?.dataset["focusBranch"]).toBe("remotes/origin/main");

    selectedBranch.value = "v1";
    label = drawLabel(ref("tag", "v1"));
    expect(badge()).toBeNull();
  });

  it("keeps clicks from the row and checks out on double-click", () => {
    const label = drawLabel(ref("head", "feat"));
    const parent = vi.fn();
    host.addEventListener("click", parent);
    host.addEventListener("dblclick", parent);

    const click = new MouseEvent("click", { bubbles: true, cancelable: true });
    act(() => {
      label.dispatchEvent(click);
    });
    expect(click.defaultPrevented).toBe(false);
    act(() => {
      label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });

    expect(parent).not.toHaveBeenCalled();
    const sent = vscodeApi.postMessage.mock.calls.map(([message]) => message);
    expect(sent).toEqual([
      expect.objectContaining({
        command: "checkoutBranch",
        branchName: "feat",
        remoteBranch: null,
        repo: "/repo",
        requestId: expect.stringMatching(/^action-\d+$/)
      })
    ]);
  });

  it.each([
    ["the checked-out branch", ref("head", "main"), true],
    ["a tag", ref("tag", "v1"), false]
  ])("does nothing on a double-click of %s", (_name, gitRef, active) => {
    const label = drawLabel(gitRef, active);
    const parent = vi.fn();
    host.addEventListener("dblclick", parent);

    act(() => {
      label.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    });

    expect(parent).not.toHaveBeenCalled();
    expect(vscodeApi.postMessage).not.toHaveBeenCalled();
  });

  it("opens the ref's own menu at the pointer instead of the row's", () => {
    const gitRef = ref("head", "feat");
    const label = drawLabel(gitRef);
    const row = vi.fn();
    host.addEventListener("contextmenu", row);
    const menuClick = new MouseEvent("contextmenu", {
      bubbles: true,
      cancelable: true,
      clientX: 5,
      clientY: 6
    });

    act(() => {
      label.dispatchEvent(menuClick);
    });

    expect(menuClick.defaultPrevented).toBe(true);
    expect(row).not.toHaveBeenCalled();
    expect(contextMenu.value).toMatchObject({ source: "ref:head:feat", x: 5, y: 6 });
    expect(contextMenu.value!.entries.map((item) => item?.title ?? null)).toEqual(
      refMenu(gitRef, false).map((item) => item?.title ?? null)
    );
  });

  it("stands out while its menu is open, and only its own", () => {
    const feat = drawLabel(ref("head", "feat"));
    expect(feat.classList.contains("bg-btn-hover")).toBe(false);

    act(() => {
      contextMenu.value = { x: 0, y: 0, entries: [], source: "ref:head:feat" };
    });
    expect(feat.classList.contains("bg-btn-hover")).toBe(true);

    act(() => {
      contextMenu.value = { x: 0, y: 0, entries: [], source: "ref:remote:feat" };
    });
    expect(feat.classList.contains("bg-btn-hover")).toBe(false);
  });
});
