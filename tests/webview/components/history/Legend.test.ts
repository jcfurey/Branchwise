// @vitest-environment jsdom
import { Fragment, h } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { Dialog } from "@/webview/components/ui/Dialog";
import { computeGraphLayout } from "@/webview/graph/layout";
import { MainHeader } from "@/webview/layout/MainHeader";
import { closeContextMenu } from "@/webview/lib/actions";
import * as stores from "@/webview/lib/stores";

import {
  REPOS,
  headerButton,
  mount,
  resetHeader,
  unmount
} from "@tests/webview/layout/header-harness";
import { setupWebviewTest } from "@tests/webview/test-utils";

beforeAll(() => setupWebviewTest());
beforeEach(resetHeader);
afterEach(unmount);

/** Choose Legend from the Settings & Tools menu, with a dialog to show it in. */
function openLegend() {
  mount(h(Fragment, null, h(MainHeader, { repos: REPOS }), h(Dialog, {})));
  act(() => {
    headerButton("settingsTools").dispatchEvent(
      new MouseEvent("click", { bubbles: true, detail: 1 })
    );
  });
  const entry = stores.contextMenu.value?.entries.find((each) => each?.title === "legend");
  expect(entry).toBeDefined();
  act(() => {
    closeContextMenu();
    entry!.onClick();
  });
  const dialog = document.querySelector<HTMLElement>("[role=dialog]");
  expect(dialog).not.toBeNull();
  return dialog!;
}

const entry = (dialog: HTMLElement, key: string) =>
  dialog.querySelector<HTMLElement>(`[data-legend-entry="${key}"]`);

describe("the legend", () => {
  it("opens from Settings & Tools as a dialog titled Legend", () => {
    const dialog = openLegend();
    expect(stores.dialog.value).toMatchObject({ kind: "content", message: "legend", wide: true });
    expect(dialog.querySelector("[data-legend]")).not.toBeNull();
  });

  it("names every symbol the graph draws, in order", () => {
    const dialog = openLegend();
    const keys = [...dialog.querySelectorAll<HTMLElement>("[data-legend-entry]")].map(
      (item) => item.dataset["legendEntry"]
    );
    // A merge has its own entry only where the graph gives merges a shape of their own.
    expect(keys.filter((key) => key !== "merge")).toEqual([
      "commit",
      "head",
      "uncommitted",
      "unpushed",
      "unpulled",
      "conflict",
      "branch",
      "remote",
      "tag",
      "more",
      "worktree",
      "dimmed",
      "focus",
      "hidden"
    ]);
    const [merge] = computeGraphLayout(
      [
        {
          hash: "m",
          parentHashes: ["a", "b"],
          author: "",
          email: "",
          date: 0,
          message: "",
          refs: []
        }
      ],
      null
    ).vertices;
    const shaped = (merge as { isMerge?: boolean }).isMerge === true;
    expect(keys.includes("merge")).toBe(shaped);
    if (shaped) {
      expect(keys.indexOf("merge")).toBe(keys.indexOf("head") + 1);
      expect(entry(dialog, "merge")!.querySelector('[data-dot="merge"]')).not.toBeNull();
    }
    const words = (key: string) =>
      [...entry(dialog, key)!.querySelectorAll("p")].map((p) => p.textContent);
    expect(words("head")).toEqual(["legendHead", "legendHeadHint"]);
    expect(words("unpushed")).toEqual(["legendUnpushed", "commitUnpushed"]);
  });

  it("draws each symbol with the component the graph uses", () => {
    const dialog = openLegend();
    const sample = (key: string) => entry(dialog, key)!.querySelector("[inert]")!;

    const dot = (key: string) => sample(key).querySelector("svg circle")!;
    expect(dot("commit").hasAttribute("fill")).toBe(true);
    // HEAD and the uncommitted changes are rings, the uncommitted ones grey.
    expect(dot("head").hasAttribute("fill")).toBe(false);
    expect(dot("uncommitted").getAttribute("stroke")).toBe("#808080");
    expect(sample("dimmed").querySelectorAll("circle[data-branch-relation]")).toHaveLength(2);
    expect(
      sample("dimmed").querySelector('circle[data-branch-relation="unrelated"]')
    ).not.toBeNull();

    expect(sample("unpushed").querySelector("[data-push]")?.getAttribute("data-push")).toBe(
      "unpushed"
    );
    expect(sample("unpulled").querySelector("[data-push]")?.getAttribute("data-push")).toBe(
      "unpulled"
    );
    expect(sample("conflict").querySelector("[data-conflicts]")?.textContent).toBe("2");
    expect(sample("branch").querySelector("[data-remote-refs]")).not.toBeNull();
    expect(sample("more").querySelector("[data-more-refs]")?.textContent).toBe("+2");
    expect(sample("worktree").querySelector("[data-worktree-dirty]")).not.toBeNull();
    expect(sample("focus").querySelector("[role=status]")?.textContent).toContain("branchFocus");
    expect(sample("hidden").querySelector("[data-hidden-branches]")).not.toBeNull();
  });

  it("keeps every sample inert, so its menus and buttons cannot be reached", () => {
    const dialog = openLegend();
    // The browser keeps focus, clicks and screen readers out of inert content; the words beside
    // each sample say what it is.
    const items = [...dialog.querySelectorAll("[data-legend-entry]")];
    expect(items.every((item) => item.firstElementChild!.hasAttribute("inert"))).toBe(true);
    expect(items.every((item) => item.lastElementChild!.hasAttribute("inert"))).toBe(false);
  });
});
