// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { AbsorbPlan, RepositoryQueryData } from "@/backend/types";
import { openAbsorb } from "@/webview/components/repository/Absorb";
import { Dialog } from "@/webview/components/ui/Dialog";
import { handleActionResult } from "@/webview/lib/handler/action-result";
import { handleRepositoryQuery } from "@/webview/lib/repository-actions";
import { dialog, selectedRepo } from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const REPO = "/work/absorb";
const id = (digit: string) => digit.repeat(40);
const PLAN: AbsorbPlan = {
  branch: "main",
  head: id("c"),
  staged: "digest",
  targets: [
    {
      hash: id("a"),
      subject: "First change",
      hunks: [{ path: "src/a.ts", oldStart: 2, oldLines: 1, newStart: 2, newLines: 1 }]
    },
    {
      hash: id("b"),
      subject: "Second change",
      hunks: [
        { path: "src/a.ts", oldStart: 10, oldLines: 2, newStart: 10, newLines: 3 },
        { path: "src/b.ts", oldStart: 4, oldLines: 2, newStart: 3, newLines: 0 }
      ]
    }
  ],
  left: [
    {
      path: "src/a.ts",
      hunk: { path: "src/a.ts", oldStart: 1, oldLines: 1, newStart: 1, newLines: 1 },
      reason: "outside"
    },
    { path: "new.txt", hunk: null, reason: "added" }
  ],
  base: id("9"),
  clean: true
};

let container: HTMLDivElement;

function lastPosted() {
  return vscodeApi.postMessage.mock.lastCall![0];
}
function respond(data: RepositoryQueryData) {
  const request = lastPosted();
  act(() =>
    handleRepositoryQuery({ repo: request.repo, requestId: request.requestId, data, status: null })
  );
}
function open(plan: AbsorbPlan) {
  openAbsorb();
  expect(lastPosted()).toMatchObject({
    command: "repositoryQuery",
    repo: REPO,
    query: { kind: "absorbPlan" }
  });
  respond({ kind: "absorbPlan", plan });
  act(() => render(h(Dialog, {}), container));
}
function button(label: string) {
  return [...container.querySelectorAll("button")].find((item) => item.textContent === label);
}
const items = (selector: string) =>
  [...container.querySelectorAll(`${selector} li`)].map((item) => item.textContent);

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  vscodeApi.postMessage.mockClear();
  selectedRepo.value = REPO;
  dialog.value = null;
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

describe("the Absorb Staged Changes preview", () => {
  it("shows which hunks go into which commit and which stay staged, and why", () => {
    open(PLAN);
    expect(dialog.value).toMatchObject({ kind: "content", message: "absorbStaged", wide: true });
    // Oldest target first, each named by its short ID and subject.
    expect(
      [...container.querySelectorAll("[data-absorb-target] h3")].map((head) => head.textContent)
    ).toEqual([`${id("a").slice(0, 8)} First change`, `${id("b").slice(0, 8)} Second change`]);
    expect(items(`[data-absorb-target="${id("a")}"]`)).toEqual(["src/a.ts:2 +1 −1"]);
    // A hunk that only removes lines is placed by where they were.
    expect(items(`[data-absorb-target="${id("b")}"]`)).toEqual([
      "src/a.ts:10–12 +3 −2",
      "src/b.ts:4–5 −2"
    ]);
    expect(items("[data-absorb-left]")).toEqual([
      "src/a.ts:1 +1 −1 · absorbOutside",
      "new.txt · absorbAdded"
    ]);
    expect(container.textContent).toContain("explainCreateAndSquash");
    expect(container.querySelector("[role=status]")).toBeNull();
  });

  it("creates the fixup commits with the plan it showed", () => {
    open(PLAN);
    act(() => button("createFixupCommits")!.click());
    const action = lastPosted();
    expect(action).toMatchObject({
      command: "repositoryAction",
      repo: REPO,
      action: { kind: "absorb", plan: PLAN }
    });
    act(() => handleActionResult({ ...action, status: null }));
    expect(dialog.value).toBeNull();
    expect(
      vscodeApi.postMessage.mock.calls.some(([message]) => message.query?.kind === "rebasePlan")
    ).toBe(false);
  });

  it("opens the rebase editor with autosquash from the oldest target's parent once they exist", () => {
    open(PLAN);
    act(() => button("createAndSquash")!.click());
    const action = lastPosted();
    expect(action).toMatchObject({ action: { kind: "absorb", plan: PLAN } });
    act(() => handleActionResult({ ...action, status: null }));
    expect(lastPosted()).toMatchObject({
      command: "repositoryQuery",
      repo: REPO,
      query: { kind: "rebasePlan", base: id("9"), autosquash: true }
    });
    respond({
      kind: "rebasePlan",
      plan: {
        base: id("9"),
        head: id("f"),
        branch: "main",
        entries: [
          { hash: id("a"), action: "pick", message: "First change" },
          { hash: id("e"), action: "fixup", message: "fixup! First change" }
        ]
      }
    });
    expect(dialog.value).toMatchObject({ kind: "content", message: "rebasePlanTitle" });
  });

  it("opens no rebase editor when creating the fixup commits failed", () => {
    open(PLAN);
    act(() => button("createAndSquash")!.click());
    const action = lastPosted();
    act(() => handleActionResult({ ...action, status: "The staged changes changed." }));
    expect(dialog.value).toMatchObject({ kind: "error" });
    expect(
      vscodeApi.postMessage.mock.calls.some(([message]) => message.query?.kind === "rebasePlan")
    ).toBe(false);
  });

  it("only creates the fixups when the rebase could not start or reach the target", () => {
    open({ ...PLAN, clean: false });
    expect(button("createAndSquash")!.disabled).toBe(true);
    expect(button("createFixupCommits")!.disabled).toBe(false);
    expect(container.textContent).toContain("absorbNeedsClean");
    act(() => render(null, container));
    open({ ...PLAN, base: null });
    expect(button("createAndSquash")!.disabled).toBe(true);
    expect(container.textContent).toContain("absorbRootTarget");
  });

  it("says so and offers nothing when no hunk can be absorbed", () => {
    open({ ...PLAN, targets: [], base: null, clean: false });
    expect(container.querySelector("[role=status]")!.textContent).toBe("absorbNothing");
    expect(items("[data-absorb-left]")).toHaveLength(2);
    expect(button("createFixupCommits")).toBeUndefined();
    expect(button("createAndSquash")).toBeUndefined();
  });
});
