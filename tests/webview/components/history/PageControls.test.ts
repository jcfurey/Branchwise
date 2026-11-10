// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { PageControls } from "@/webview/components/history/QueryControls";

import { setupWebviewTest } from "@tests/webview/test-utils";

setupWebviewTest();

let container: HTMLDivElement;
const change = vi.fn();
beforeEach(() => {
  change.mockClear();
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

function show(offset: number, count: number, more: boolean) {
  act(() => render(h(PageControls, { offset, count, more, change }), container));
}
const buttons = () => [...container.querySelectorAll("button")].map((button) => button.textContent);

it("shows nothing for an empty list, which says so itself", () => {
  show(0, 0, false);
  expect(container.innerHTML).toBe("");
});

it("counts the rows of a single page without offering another", () => {
  show(0, 37, false);
  expect(container.textContent).toBe("1–37");
  expect(buttons()).toStrictEqual([]);
});

it("offers the next page while there is one, and the way back from a later page", () => {
  show(0, 100, true);
  expect(container.textContent).toContain("1–100");
  expect(buttons()).toStrictEqual(["previousPage", "nextPage"]);
  act(() => container.querySelectorAll("button")[1]!.click());
  expect(change).toHaveBeenLastCalledWith(100);

  show(100, 20, false);
  expect(container.textContent).toContain("101–120");
  act(() => container.querySelectorAll("button")[0]!.click());
  expect(change).toHaveBeenLastCalledWith(0);
});

it("keeps the way back from a page past the end", () => {
  show(100, 0, false);
  expect(buttons()).toStrictEqual(["previousPage", "nextPage"]);
});
