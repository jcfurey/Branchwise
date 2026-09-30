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
