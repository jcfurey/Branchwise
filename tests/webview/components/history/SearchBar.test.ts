// @vitest-environment jsdom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, expect, it } from "vitest";

import { setupWebviewTest } from "@tests/webview/test-utils";

let SearchBar: typeof import("@/webview/components/history/SearchBar").SearchBar;
let navigation: typeof import("@/webview/lib/navigation");
let container: HTMLDivElement;

beforeAll(async () => {
  setupWebviewTest();
  ({ SearchBar } = await import("@/webview/components/history/SearchBar"));
  navigation = await import("@/webview/lib/navigation");
});

afterEach(() => {
  act(() => render(null, container));
  container.remove();
  navigation.setHistoryFilter(navigation.emptyFilter());
});

it("keeps text typed before the mount effects ran", async () => {
  container = document.createElement("div");
  document.body.append(container);
  // Render outside act, so the effects stay pending as they do in a browser frame.
  render(h(SearchBar, {}), container);
  const input = container.querySelector<HTMLInputElement>("[data-history-search]")!;
  input.value = "needle";
  input.dispatchEvent(new Event("input", { bubbles: true }));
  await act(async () => {});
  act(() => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(navigation.historyFilter.value.text).toBe("needle");
});

it("takes a filter that changes after mount, such as a repository switch", () => {
  container = document.createElement("div");
  document.body.append(container);
  act(() => render(h(SearchBar, {}), container));
  act(() => navigation.setHistoryFilter({ ...navigation.emptyFilter(), text: "from state" }));
  expect(container.querySelector<HTMLInputElement>("[data-history-search]")!.value).toBe(
    "from state"
  );
});

it("moves typed fields into the filter and shows them under Filters", async () => {
  container = document.createElement("div");
  document.body.append(container);
  act(() => render(h(SearchBar, {}), container));
  const input = container.querySelector<HTMLInputElement>("[data-history-search]")!;
  act(() => {
    input.value = 'crash tag:v1 author:"Ann Lee"';
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => {
    container
      .querySelector("form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  expect(navigation.historyFilter.value).toMatchObject({
    text: "crash",
    tag: "v1",
    author: "Ann Lee"
  });
  expect(input.value).toBe("crash");
  const fields = new Map(
    [...container.querySelectorAll("label")].map((label) => [
      label.textContent,
      label.querySelector("input")?.value
    ])
  );
  expect(fields.get("historyTag")).toBe("v1");
  expect(fields.get("historyAuthor")).toBe("Ann Lee");
});

it("fills the new fields of a saved filter that predates them", () => {
  container = document.createElement("div");
  document.body.append(container);
  act(() => render(h(SearchBar, {}), container));
  const old = { ...navigation.emptyFilter(), text: "old" } as Record<string, unknown>;
  for (const key of ["committer", "branch", "tag", "regex"]) {
    delete old[key];
  }
  act(() => navigation.setHistoryFilter(old as never));
  expect(navigation.historyFilter.value).toMatchObject({
    text: "old",
    committer: "",
    branch: "",
    tag: "",
    regex: false
  });
});
