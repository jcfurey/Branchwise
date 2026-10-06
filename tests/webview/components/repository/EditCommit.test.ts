// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type {
  AmendPlan,
  EditPlan,
  GitCommitNode,
  RepositoryQueryData,
  RepositoryState
} from "@/backend/types";
import { CommitDetails } from "@/webview/components/commit/CommitDetails";
import {
  onCheckedOutLine,
  openAddStaged,
  openEditMessage
} from "@/webview/components/repository/EditCommit";
import { Dialog } from "@/webview/components/ui/Dialog";
import { commitMenu } from "@/webview/lib/menus";
import { handleRepositoryQuery, repositoryState } from "@/webview/lib/repository-actions";
import { commitHead, commitList, dialog, headBranch, selectedRepo } from "@/webview/lib/stores";
import type { ContextMenuEntry } from "@/webview/types";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const REPO = "/work/edit";
const id = (digit: string) => digit.repeat(40);
function node(hash: string, parentHashes: string[]): GitCommitNode {
  return { hash, parentHashes, author: "T", email: "t@t", date: 0, message: hash[0]!, refs: [] };
}
// HEAD `m` merged `s`; `x` is on another branch. First parents: m → b → a.
const M = id("m"),
  B = id("b"),
  S = id("s"),
  A = id("a"),
  X = id("x");
const ROWS = [node(M, [B, S]), node(X, [A]), node(B, [A]), node(S, [A]), node(A, [])];
const STATE: RepositoryState = {
  remotes: [],
  pushDefault: null,
  branches: [],
  remoteBranches: [],
  tags: [],
  worktrees: [],
  head: "main",
  operation: null,
  conflicts: [],
  staged: 0
};
const PLAN: EditPlan = {
  branch: "main",
  head: M,
  target: B,
  message: "Old subject\n\nOld body",
  later: 1,
  pushed: false
};
const AMEND: AmendPlan = {
  ...PLAN,
  later: 2,
  pushed: true,
  staged: { head: M, target: B, tree: id("t"), files: ["src/a.ts", "README.md"] }
};

let container: HTMLDivElement;

function titles(entries: Array<ContextMenuEntry>) {
  return entries.flatMap((entry) => (entry === null ? [] : [entry.title]));
}
function lastPosted() {
  return vscodeApi.postMessage.mock.lastCall![0];
}
function respond(data: RepositoryQueryData) {
  const request = lastPosted();
  act(() =>
    handleRepositoryQuery({ repo: request.repo, requestId: request.requestId, data, status: null })
  );
}
function button(label: string) {
  return [...container.querySelectorAll("button")].find((item) => item.textContent === label);
}
function type(value: string) {
  const area = container.querySelector("textarea")!;
  act(() => {
    area.value = value;
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  vscodeApi.postMessage.mockClear();
  selectedRepo.value = REPO;
  headBranch.value = "main";
  commitHead.value = M;
  commitList.value = ROWS;
  repositoryState.value = STATE;
  dialog.value = null;
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.restoreAllMocks();
});

describe("which commits can be edited in place", () => {
  it("follows HEAD's first parents through the loaded rows", () => {
    expect([M, B, A].map(onCheckedOutLine)).toEqual([true, true, true]);
    expect([S, X, id("z")].map(onCheckedOutLine)).toEqual([false, false, false]);
  });

  it("offers nothing on a detached HEAD or before rows arrive", () => {
    headBranch.value = null;
    expect(onCheckedOutLine(M)).toBe(false);
    headBranch.value = "main";
    commitList.value = undefined;
    expect(onCheckedOutLine(M)).toBe(false);
  });

  it("puts Edit Message in the menu of the branch's own commits only", () => {
    expect(titles(commitMenu(ROWS[2]!, new Map()))).toContain("editMessage…");
    expect(titles(commitMenu(ROWS[3]!, new Map()))).not.toContain("editMessage…");
    expect(titles(commitMenu(ROWS[1]!, new Map()))).not.toContain("editMessage…");
  });

  it("offers to add staged changes only while something is staged", () => {
    expect(titles(commitMenu(ROWS[2]!, new Map()))).not.toContain("addStagedToCommit…");
    repositoryState.value = { ...STATE, staged: 2 };
    const entries = titles(commitMenu(ROWS[2]!, new Map()));
    expect(
      entries.slice(entries.indexOf("editMessage…"), entries.indexOf("editMessage…") + 3)
    ).toEqual(["editMessage…", "addStagedToCommit…", "interactiveRebase…"]);
    expect(titles(commitMenu(ROWS[3]!, new Map()))).not.toContain("addStagedToCommit…");
    repositoryState.value = null;
    expect(titles(commitMenu(ROWS[2]!, new Map()))).not.toContain("addStagedToCommit…");
  });
});

describe("the Edit Message dialog", () => {
  it("prefills the message and sends the edit with the plan it was opened with", () => {
    openEditMessage(B);
    expect(lastPosted()).toMatchObject({
      command: "repositoryQuery",
      repo: REPO,
      query: { kind: "editPlan", target: B }
    });
    respond({ kind: "editPlan", plan: PLAN });
    act(() => render(h(Dialog, {}), container));
    expect(container.querySelector("textarea")!.value).toBe(PLAN.message);
    expect(container.textContent).toContain("rewritesOneLater");
    expect(container.querySelector("[role=alert]")).toBeNull();
    // Nothing to save until the message changes, and an empty one is never sent.
    expect(button("saveMessage")!.disabled).toBe(true);
    type("  \n");
    expect(button("saveMessage")!.disabled).toBe(true);
    type("New subject");
    act(() => button("saveMessage")!.click());
    expect(lastPosted()).toMatchObject({
      command: "repositoryAction",
      repo: REPO,
      action: { kind: "reword", plan: PLAN, message: "New subject" }
    });
  });

  it("warns that a pushed commit needs a force push", () => {
    openEditMessage(B);
    respond({ kind: "editPlan", plan: { ...PLAN, pushed: true, later: 3 } });
    act(() => render(h(Dialog, {}), container));
    expect(container.querySelector("[role=alert]")!.textContent).toBe("alreadyPushed");
    expect(container.textContent).toContain("rewritesLater");
  });

  it("opens from the details panel of the branch's own commits", () => {
    vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const details = (hash: string) =>
      h(
        "table",
        null,
        h(
          "tbody",
          null,
          h(CommitDetails, {
            details: {
              hash,
              parents: [],
              author: "T",
              email: "",
              date: 0,
              committer: "T",
              body: "b",
              fileChanges: []
            }
          })
        )
      );
    act(() => render(details(S), container));
    expect(button("editMessage…")).toBeUndefined();
    act(() => render(details(B), container));
    act(() => button("editMessage…")!.click());
    expect(lastPosted()).toMatchObject({ query: { kind: "editPlan", target: B } });
  });
});

describe("the Add Staged Changes dialog", () => {
  it("lists the target, the staged files and the rewritten commits before it sends", () => {
    openAddStaged(B);
    expect(lastPosted()).toMatchObject({ query: { kind: "amendPlan", target: B } });
    respond({ kind: "amendPlan", plan: AMEND });
    act(() => render(h(Dialog, {}), container));
    const text = container.textContent!;
    expect(text).toContain("addStagedConfirm");
    expect([...container.querySelectorAll("li")].map((item) => item.textContent)).toEqual([
      "src/a.ts",
      "README.md"
    ]);
    expect(text).toContain("rewritesLater");
    expect(text).toContain("explainAddStaged");
    expect(container.querySelector("[role=alert]")!.textContent).toBe("alreadyPushed");
    act(() => button("addStagedSubmit")!.click());
    expect(lastPosted()).toMatchObject({
      command: "repositoryAction",
      action: { kind: "amendCommit", plan: AMEND }
    });
  });

  it("leaves out the rebase and its explanation when the target is HEAD", () => {
    openAddStaged(M);
    respond({ kind: "amendPlan", plan: { ...AMEND, target: M, later: 0, pushed: false } });
    act(() => render(h(Dialog, {}), container));
    expect(container.textContent).not.toContain("explainAddStaged");
    expect(container.textContent).not.toContain("rewritesLater");
  });
});
