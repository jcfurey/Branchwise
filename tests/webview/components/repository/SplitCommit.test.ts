// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitCommitNode, RepositoryQueryData, SplitHunk, SplitPlan } from "@/backend/types";
import { CommitDetails } from "@/webview/components/commit/CommitDetails";
import {
  filesPerPart,
  openSplitCommit,
  splitProblem,
  splitSummary
} from "@/webview/components/repository/SplitCommit";
import { Dialog } from "@/webview/components/ui/Dialog";
import { commitMenu } from "@/webview/lib/menus";
import { handleRepositoryQuery } from "@/webview/lib/repository-actions";
import { commitHead, commitList, dialog, headBranch, selectedRepo } from "@/webview/lib/stores";
import type { ContextMenuEntry } from "@/webview/types";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const REPO = "/work/split";
const id = (digit: string) => digit.repeat(40);
function node(hash: string, parentHashes: string[]): GitCommitNode {
  return { hash, parentHashes, author: "T", email: "t@t", date: 0, message: hash[0]!, refs: [] };
}
// HEAD `m` merged `s`; first parents: m → b → a.
const M = id("m"),
  B = id("b"),
  S = id("s"),
  A = id("a");
const ROWS = [node(M, [B, S]), node(B, [A]), node(S, [A]), node(A, [])];
const hunk = (start: number, lines: string[], hidden = 0): SplitHunk => ({
  oldStart: start,
  oldLines: 1,
  newStart: start,
  newLines: 1,
  lines,
  hidden
});
const PLAN: SplitPlan = {
  branch: "main",
  head: M,
  target: B,
  message: "Original subject\n\nBody",
  later: 1,
  pushed: false,
  files: [
    { path: "README.md", from: "README.md", status: "M", hunks: null },
    {
      path: "src/app.ts",
      from: "src/app.ts",
      status: "M",
      hunks: [hunk(3, ["-old", "+new"]), hunk(20, ["+added"], 7), hunk(40, ["-gone"])]
    },
    { path: "src/new.ts", from: "src/old.ts", status: "R", hunks: null },
    { path: "obsolete", from: "obsolete", status: "D", hunks: null }
  ]
};
/** English templates for the strings this dialog fills in; every other string is its key. */
const ENGLISH: Record<string, string> = {
  splitPart: "Part {0}",
  splitPartMessage: "Message of Part {0}",
  removeSplitPart: "Remove Part {0}",
  splitFilePart: "Part for {0}",
  splitHunkPart: "Part for {0} at {1}",
  splitHunks: "{0} hunks: choose a part for each",
  splitMoreLines: "{0} more lines",
  splitPreview: "{0} commits: {1}",
  splitPartFiles: "Part {0} ({1} files)",
  splitPartOneFile: "Part {0} (1 file)",
  splitPartsJoin: "{0}, {1}",
  splitEmptyPart: "Choose at least one file or hunk for Part {0}.",
  splitNoMessage: "Enter a message for Part {0}."
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
function labelled<T extends Element>(label: string) {
  return container.querySelector<T & Element>(`[aria-label="${label}"]`)!;
}
function choose(label: string, part: number) {
  const select = labelled<HTMLSelectElement>(label);
  act(() => {
    select.value = String(part - 1);
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
function type(part: number, value: string) {
  const area = labelled<HTMLTextAreaElement>(`Message of Part ${part}`);
  act(() => {
    area.value = value;
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const preview = () => container.querySelector("[data-split-preview]")!.textContent;
const problem = () => container.querySelector("[data-split-problem]")?.textContent ?? null;
const submit = () => button("splitCommit")!;
function open() {
  openSplitCommit(B);
  expect(lastPosted()).toMatchObject({
    command: "repositoryQuery",
    repo: REPO,
    query: { kind: "splitPlan", target: B }
  });
  respond({ kind: "splitPlan", plan: PLAN });
  act(() => render(h(Dialog, {}), container));
}

beforeAll(() => {
  setupWebviewTest();
  const keys = window.l10n;
  Object.defineProperty(window, "l10n", {
    value: new Proxy(keys, {
      get: (target, key) => ENGLISH[key as string] ?? Reflect.get(target, key)
    }),
    configurable: true
  });
});

beforeEach(() => {
  vscodeApi.postMessage.mockClear();
  selectedRepo.value = REPO;
  headBranch.value = "main";
  commitHead.value = M;
  commitList.value = ROWS;
  dialog.value = null;
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
  vi.restoreAllMocks();
});

describe("where Split Commit is offered", () => {
  it("is in the menu of the branch's own commits, but not of merges", () => {
    expect(titles(commitMenu(ROWS[1]!, new Map()))).toContain("splitCommit…");
    expect(titles(commitMenu(ROWS[3]!, new Map()))).toContain("splitCommit…");
    // HEAD is a merge: Edit Message is offered, Split Commit is not.
    expect(titles(commitMenu(ROWS[0]!, new Map()))).toContain("editMessage…");
    expect(titles(commitMenu(ROWS[0]!, new Map()))).not.toContain("splitCommit…");
    expect(titles(commitMenu(ROWS[2]!, new Map()))).not.toContain("splitCommit…");
  });

  it("is a button in the details of the branch's own commits that are not merges", () => {
    vi.spyOn(window, "scrollBy").mockImplementation(() => {});
    const details = (hash: string, parents: string[]) =>
      h(
        "table",
        null,
        h(
          "tbody",
          null,
          h(CommitDetails, {
            details: {
              hash,
              parents,
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
    act(() => render(details(S, [A]), container));
    expect(button("splitCommit…")).toBeUndefined();
    act(() => render(details(M, [B, S]), container));
    expect(button("editMessage…")).toBeDefined();
    expect(button("splitCommit…")).toBeUndefined();
    act(() => render(details(B, [A]), container));
    act(() => button("splitCommit…")!.click());
    expect(lastPosted()).toMatchObject({ query: { kind: "splitPlan", target: B } });
  });
});

describe("the rules the dialog checks", () => {
  it("counts a file in every part that has one of its hunks", () => {
    expect(filesPerPart([0, [0, 1, 0], 1, 2], 4)).toEqual([2, 2, 1, 0]);
  });

  it("asks for a change in every part, then a message for every part", () => {
    expect(splitProblem(["a", "b"], [0, 0])).toBe("Choose at least one file or hunk for Part 2.");
    expect(splitProblem(["a", ""], [0, [0, 1]])).toBe("Enter a message for Part 2.");
    expect(splitProblem(["a", "b"], [0, [0, 1]])).toBeNull();
  });

  it("summarizes the commits it will make", () => {
    expect(splitSummary([4, 2, 1])).toBe(
      "3 commits: Part 1 (4 files), Part 2 (2 files), Part 3 (1 file)"
    );
  });
});

describe("the Split Commit dialog", () => {
  it("lists the files and hunks, and starts with everything in Part 1", () => {
    open();
    expect(
      [...container.querySelectorAll("[data-split-file]")].map((item) =>
        item.getAttribute("data-split-file")
      )
    ).toEqual(["README.md", "src/app.ts", "src/new.ts", "obsolete"]);
    expect(container.textContent).toContain("src/old.ts → src/new.ts");
    expect(container.textContent).toContain("3 hunks: choose a part for each");
    expect(container.textContent).toContain("7 more lines");
    expect(container.textContent).toContain("rewritesOneLater");
    expect(labelled<HTMLTextAreaElement>("Message of Part 1").value).toBe(PLAN.message);
    expect(labelled<HTMLTextAreaElement>("Message of Part 2").value).toBe("");
    expect(preview()).toBe("2 commits: Part 1 (4 files), Part 2 (0 files)");
    expect(problem()).toBe("Choose at least one file or hunk for Part 2.");
    expect(submit().disabled).toBe(true);
    // Two parts are the fewest a split makes.
    expect(button("Remove Part 2")).toBeUndefined();
  });

  it("sends the parts once each has a change and a message", () => {
    open();
    choose("Part for obsolete", 2);
    expect(preview()).toBe("2 commits: Part 1 (3 files), Part 2 (1 file)");
    expect(problem()).toBe("Enter a message for Part 2.");
    expect(submit().disabled).toBe(true);
    type(2, "Remove the obsolete file");
    expect(problem()).toBeNull();
    expect(submit().disabled).toBe(false);

    act(() => button("addSplitPart")!.click());
    expect(preview()).toBe("3 commits: Part 1 (3 files), Part 2 (1 file), Part 3 (0 files)");
    expect(problem()).toBe("Choose at least one file or hunk for Part 3.");
    choose("Part for src/app.ts at @@ -20,1 +20,1 @@", 3);
    expect(labelled<HTMLSelectElement>("Part for src/app.ts").value).toBe("");
    expect(labelled<HTMLSelectElement>("Part for src/app.ts").selectedOptions[0]!.text).toBe(
      "splitByHunk"
    );
    expect(preview()).toBe("3 commits: Part 1 (3 files), Part 2 (1 file), Part 3 (1 file)");
    type(3, "Add the new lines");
    choose("Part for src/old.ts → src/new.ts", 3);
    expect(preview()).toBe("3 commits: Part 1 (2 files), Part 2 (1 file), Part 3 (2 files)");
    act(() => submit().click());
    expect(lastPosted()).toMatchObject({
      command: "repositoryAction",
      repo: REPO,
      action: {
        kind: "splitCommit",
        plan: PLAN,
        messages: [PLAN.message, "Remove the obsolete file", "Add the new lines"],
        assignment: [0, [0, 2, 0], 2, 1]
      }
    });
  });

  it("puts a whole file back in one part, and moves a removed part's changes to the one before", () => {
    open();
    act(() => button("addSplitPart")!.click());
    choose("Part for src/app.ts at @@ -40,1 +40,1 @@", 2);
    choose("Part for src/app.ts", 3);
    expect(labelled<HTMLSelectElement>("Part for src/app.ts").value).toBe("2");
    choose("Part for obsolete", 2);
    choose("Part for README.md", 3);
    type(2, "two");
    type(3, "three");
    act(() => button("Remove Part 2")!.click());
    expect(labelled<HTMLTextAreaElement>("Message of Part 2").value).toBe("three");
    expect(container.querySelector('[aria-label="Message of Part 3"]')).toBeNull();
    expect(preview()).toBe("2 commits: Part 1 (2 files), Part 2 (2 files)");
    act(() => submit().click());
    expect(lastPosted()).toMatchObject({
      action: { kind: "splitCommit", messages: [PLAN.message, "three"], assignment: [1, 1, 0, 0] }
    });
  });
});
