// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { HistoryEntry, RebaseEntry } from "@/backend/types";

import { setupWebviewTest } from "@tests/webview/test-utils";

let RebaseEditor: typeof import("@/webview/components/repository/RebaseEditor").RebaseEditor;
let BatchEditor: typeof import("@/webview/components/history/HistoryTools").BatchEditor;
let container: HTMLDivElement;

beforeAll(async () => {
  setupWebviewTest();
  const keys = window.l10n;
  Object.defineProperty(window, "l10n", {
    value: new Proxy(keys, {
      get: (target, key) =>
        key === "movedEntry" ? "Moved {0} to position {1} of {2}." : Reflect.get(target, key)
    }),
    configurable: true
  });
  ({ RebaseEditor } = await import("@/webview/components/repository/RebaseEditor"));
  ({ BatchEditor } = await import("@/webview/components/history/HistoryTools"));
});
beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
});
afterEach(() => {
  act(() => render(null, container));
  container.remove();
});

const hashes = ["a", "b", "c", "d"].map((digit) => digit.repeat(40));
const button = (direction: "moveEarlier" | "moveLater", hash: string) =>
  container.querySelector<HTMLButtonElement>(
    `button[aria-label="${direction} ${hash.slice(0, 8)}"]`
  )!;
const status = () => container.querySelector('[role="status"]')?.textContent;
const press = (element: HTMLButtonElement) =>
  act(() => {
    element.focus();
    element.click();
  });
const order = () =>
  [...container.querySelectorAll<HTMLElement>("[data-entry]")].map((row) => row.dataset["entry"]);

describe.each([
  [
    "interactive rebase",
    () =>
      h(RebaseEditor, {
        repo: "/repo",
        plan: {
          base: "0".repeat(40),
          head: hashes[3]!,
          branch: "main",
          entries: hashes.map((hash): RebaseEntry => ({
            hash,
            message: `commit ${hash[0]}`,
            action: "pick"
          }))
        }
      })
  ],
  [
    "batch cherry-pick",
    () =>
      h(BatchEditor, {
        repo: "/repo",
        operation: "cherry-pick",
        plan: {
          head: "0".repeat(40),
          branch: "main",
          entries: hashes.map((hash): HistoryEntry => ({
            hash,
            parentHashes: [],
            author: "T",
            email: "t@t",
            date: 1,
            message: `commit ${hash[0]}`,
            refs: []
          }))
        }
      })
  ]
])("the %s editor", (_name, editor) => {
  it("keeps focus on the moved commit and announces its new position", () => {
    act(() => render(editor(), container));
    const [a, b, c, d] = hashes as [string, string, string, string];

    // Moving a row later re-inserts the other row; moving it earlier re-inserts the row itself.
    press(button("moveLater", a));
    expect(order()).toEqual([b, a, c, d]);
    expect(document.activeElement).toBe(button("moveLater", a));
    expect(status()).toBe("Moved aaaaaaaa to position 2 of 4.");

    press(button("moveEarlier", c));
    expect(order()).toEqual([b, c, a, d]);
    expect(document.activeElement).toBe(button("moveEarlier", c));
    expect(status()).toBe("Moved cccccccc to position 2 of 4.");

    // At the first place Move Earlier is disabled, so focus stays on the row's other button.
    press(button("moveEarlier", c));
    expect(order()).toEqual([c, b, a, d]);
    expect(button("moveEarlier", c).disabled).toBe(true);
    expect(document.activeElement).toBe(button("moveLater", c));
    expect(status()).toBe("Moved cccccccc to position 1 of 4.");
  });

  it("names each move button with its commit", () => {
    act(() => render(editor(), container));
    const labels = [...container.querySelectorAll("button[data-move]")].map((element) =>
      element.getAttribute("aria-label")
    );
    expect(labels).toHaveLength(8);
    expect(new Set(labels).size).toBe(8);
  });
});
