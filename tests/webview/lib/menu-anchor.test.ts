// @vitest-environment jsdom

import { beforeAll, beforeEach, expect, it, vi } from "vitest";

import { setupWebviewTest } from "@tests/webview/test-utils";

let actions: typeof import("@/webview/lib/actions");
let stores: typeof import("@/webview/lib/stores");
let button: HTMLButtonElement;

beforeAll(async () => {
  setupWebviewTest();
  actions = await import("@/webview/lib/actions");
  stores = await import("@/webview/lib/stores");
});

beforeEach(() => {
  stores.contextMenu.value = null;
  button = document.createElement("button");
  document.body.append(button);
  vi.spyOn(button, "getBoundingClientRect").mockReturnValue({
    left: 120,
    right: 150,
    top: 40,
    bottom: 64,
    width: 30,
    height: 24
  } as DOMRect);
  button.addEventListener("click", (event) => actions.openContextMenu(event, "tools", []));
  button.addEventListener("contextmenu", (event) => actions.openContextMenu(event, "tools", []));
});

const position = () => {
  const menu = stores.contextMenu.value;
  return menu && { x: menu.x, y: menu.y };
};

it("opens a keyboard-activated menu below its button", () => {
  // Enter and Space click a button with no pointer, so the click reports a count of zero.
  button.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 0 }));
  expect(position()).toEqual({ x: 120, y: 64 });
});

it("opens a menu from the context-menu key below its element", () => {
  button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 0, clientY: 0 }));
  expect(position()).toEqual({ x: 120, y: 64 });
});

it("keeps opening pointer menus at the pointer", () => {
  button.dispatchEvent(
    new MouseEvent("click", { bubbles: true, detail: 1, clientX: 130, clientY: 50 })
  );
  expect(position()).toEqual({ x: 130, y: 50 });
  button.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: 5, clientY: 7 }));
  expect(position()).toEqual({ x: 5, y: 7 });
});
