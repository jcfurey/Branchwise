// @vitest-environment jsdom
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { repositoryRevision } from "@/webview/lib/repository-actions";
import * as stores from "@/webview/lib/stores";

import { setupWebviewTest } from "@tests/webview/test-utils";

import {
  chain,
  click,
  hideGraphView,
  lastQuery,
  relationOf,
  reply,
  resetGraphView,
  sentQueries,
  showGraphView,
  view,
  withEnglish
} from "./graph-view-harness";

beforeAll(() => setupWebviewTest());
beforeEach(resetGraphView);
afterEach(hideGraphView);

/** Focus a branch in the whole graph, whose rows are already loaded. */
function focusOn(branch: string, hashes = ["tip", "base"]) {
  stores.branchDisplay.value = "focus";
  stores.selectedBranch.value = branch;
  stores.commitList.value = chain(...hashes);
  stores.commitHead.value = hashes[0]!;
}

function banner() {
  return view().querySelector<HTMLElement>("main > [role=status]");
}

/** The banner's two texts: what is focused, and how it is shown. */
function bannerTexts() {
  const spans = banner()?.querySelectorAll(":scope > span") ?? [];
  return [...spans].map((span) => span.textContent);
}

const bump = () =>
  act(() => {
    repositoryRevision.value++;
  });

describe("the focus banner", () => {
  it("follows the branch-focus query through loading, answers, reloads, failures and pauses", () => {
    focusOn("main");
    showGraphView();
    expect(lastQuery("branchFocus").query).toEqual({
      kind: "branchFocus",
      branch: "main",
      hashes: ["tip", "base"]
    });
    expect(bannerTexts()).toEqual(["branchFocus", "loadingBranchFocus"]);
    expect(banner()!.querySelector("span")!.title).toBe("main");
    expect(relationOf("tip")).toBe("normal");

    const focus = { kind: "branchFocus" as const, tip: "tip", direct: ["tip"], merged: ["base"] };
    reply(lastQuery("branchFocus"), { data: focus });
    expect(bannerTexts()).toEqual(["branchFocus", "focusDirectHint"]);
    expect(relationOf("tip")).toBe("direct");
    expect(relationOf("base")).toBe("merged");

    // The colours wait for the reloaded answer rather than showing the old one.
    bump();
    expect(bannerTexts()[1]).toBe("loadingBranchFocus");
    expect(relationOf("tip")).toBe("normal");

    reply(lastQuery("branchFocus"), { error: "cannot resolve main" });
    expect(bannerTexts()[1]).toBe("branchFocusUnavailable");
    expect(relationOf("tip")).toBe("normal");

    act(() => {
      stores.branchDisplay.value = "ancestors";
    });
    bump();
    reply(lastQuery("branchFocus"), { data: focus });
    expect(bannerTexts()[1]).toBe("focusAncestorsHint");
    // All ancestors keep their full colour, merged ones included.
    expect(relationOf("base")).toBe("direct");

    click("pauseBranchFocus");
    expect(stores.focusPaused.value).toBe(true);
    expect(bannerTexts()).toEqual(["branchFocusPaused", "focusPausedHint"]);
    expect(relationOf("tip")).toBe("normal");
    click("resumeBranchFocus");
    expect(stores.focusPaused.value).toBe(false);
    expect(relationOf("tip")).toBe("direct");
  });

  it("leaves the focus badges' attributes to the badges", () => {
    focusOn("main");
    showGraphView();
    expect(banner()!.querySelector("[data-focus-branch], [data-focus-paused]")).toBeNull();
    expect(banner()!.hasAttribute("data-focus-branch")).toBe(false);
  });

  it("changes the dimming and clears the focus", () => {
    focusOn("remotes/origin/topic");
    showGraphView();
    click("pauseBranchFocus");
    const select = banner()!.querySelector("select")!;
    expect(select.getAttribute("aria-label")).toBe("focusDimming");
    expect(select.closest("label")?.textContent).toContain("focusDimming");
    expect([...select.options].map((option) => [option.value, option.text])).toEqual([
      ["subtle", "focusDimmingSubtle"],
      ["strong", "focusDimmingStrong"]
    ]);

    act(() => {
      select.value = "strong";
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    expect(stores.focusDimming.value).toBe("strong");
    expect(select.value).toBe("strong");

    click("clearBranchFocus");
    expect(stores.selectedBranch.value).toBe("*");
    expect(stores.focusPaused.value).toBe(false);
    expect(banner()).toBeNull();
  });

  it("asks for no focus data without rows", () => {
    stores.branchDisplay.value = "focus";
    stores.selectedBranch.value = "main";
    stores.commitList.value = [];
    stores.commitHead.value = "tip";
    showGraphView();
    expect(sentQueries("branchFocus")).toHaveLength(0);
    expect(bannerTexts()).toEqual(["branchFocus", "focusDirectHint"]);
  });

  it("includes the uncommitted row in the hashes it asks about", () => {
    stores.branchDisplay.value = "focus";
    stores.selectedBranch.value = "main";
    stores.commitList.value = [{ ...chain("work")[0]!, hash: "*" }, ...chain("tip")];
    stores.commitHead.value = "tip";
    showGraphView();
    expect(lastQuery("branchFocus").query.hashes).toEqual(["*", "tip"]);
  });
});

describe("branch names in the banner", () => {
  it.each([
    ["remotes/origin/main", "Focus: origin/main"],
    ["remotes/origin/x$&y", "Focus: origin/x$&y"],
    ["a$$b", "Focus: a$$b"],
    ["pre$`post$'", "Focus: pre$`post$'"]
  ])("shows %s literally, without the remotes prefix", (branch, text) => {
    withEnglish({ branchFocus: "Focus: {0}", branchFocusPaused: "Focus paused: {0}" });
    focusOn(branch);
    showGraphView();
    const name = banner()!.querySelector("span")!;
    expect(name.textContent).toBe(text);
    expect(name.title).toBe(branch);
    click("pauseBranchFocus");
    expect(name.textContent).toBe(text.replace("Focus:", "Focus paused:"));
  });
});
