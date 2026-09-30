// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "@/webview/App";
import {
  emptyFilter,
  historyFilter,
  refsVisible,
  searchVisible,
  workspaceVisible
} from "@/webview/lib/navigation";
import * as stores from "@/webview/lib/stores";

import { setupWebviewTest } from "@tests/webview/test-utils";

let host: HTMLDivElement;

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  stores.selectedRepo.value = "/home/me/project";
  stores.branchList.value = ["main"];
  stores.selectedBranch.value = "*";
  stores.commitList.value = undefined;
  refsVisible.value = true;
  workspaceVisible.value = false;
  searchVisible.value = false;
  historyFilter.value = emptyFilter();
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  host = document.createElement("div");
  document.body.append(host);
  act(() => render(h(App, { repos: [{ name: "project", path: "/home/me/project" }] }), host));
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  vi.unstubAllGlobals();
});

function root() {
  return host.querySelector<HTMLElement>("[data-branchwise]")!;
}

/** The row that holds the sidebar, if open, and the graph column. */
function contentRow() {
  const row = [...root().children].find((child) => child.querySelector("main") !== null);
  expect(row).toBeDefined();
  return row!;
}

const tags = (element: Element) => [...element.children].map((child) => child.tagName);

describe("the page", () => {
  it("puts the header first, then the content row with the Branches pane beside the graph", () => {
    expect(host.children).toHaveLength(1);
    expect(root().getAttribute("data-branchwise")).toBe("true");
    expect(root().firstElementChild?.tagName).toBe("HEADER");
    expect(root().querySelector("form[role=search]")).toBeNull();
    expect(root().querySelectorAll("header, main, nav, aside")).toHaveLength(3);

    const row = contentRow();
    expect([...root().children].indexOf(row)).toBe(1);
    const [sidebar, graph] = [...row.children];
    expect(row.children).toHaveLength(2);
    expect(sidebar!.querySelector(":scope > nav")?.getAttribute("aria-label")).toBe("branchesPane");
    expect(sidebar!.querySelector("aside")).toBeNull();
    expect(graph!.querySelector("main")).not.toBeNull();
    // The shade along the top edge follows the row; the effects, menu and dialog render nothing.
    expect(row.nextElementSibling?.getAttribute("aria-hidden")).toBe("true");
    expect(row.nextElementSibling?.nextElementSibling).toBeNull();
  });

  it("shows the search row when asked, and while a filter is active", () => {
    expect(root().querySelector("form[role=search]")).toBeNull();
    act(() => {
      searchVisible.value = true;
    });
    expect(tags(root()).slice(0, 2)).toEqual(["HEADER", "FORM"]);
    act(() => {
      searchVisible.value = false;
      historyFilter.value = { ...emptyFilter(), text: "x" };
    });
    expect(root().querySelector("form[role=search]")).not.toBeNull();
  });

  it("opens the sidebar for either pane, Branches above Workspace", () => {
    act(() => {
      refsVisible.value = false;
    });
    expect(contentRow().children).toHaveLength(1);
    expect(contentRow().firstElementChild?.querySelector("main")).not.toBeNull();

    act(() => {
      workspaceVisible.value = true;
    });
    const [sidebar] = [...contentRow().children];
    expect(contentRow().children).toHaveLength(2);
    expect(tags(sidebar!)).toEqual(["ASIDE"]);
    expect(sidebar!.firstElementChild?.getAttribute("aria-label")).toBe("workspaceOverview");

    act(() => {
      refsVisible.value = true;
    });
    expect(tags(contentRow().firstElementChild!)).toEqual(["NAV", "ASIDE"]);
  });
});
