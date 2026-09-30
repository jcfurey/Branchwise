// @vitest-environment jsdom

import { beforeAll, expect, it } from "vitest";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

let hints: typeof import("@/webview/lib/hints");
let stores: typeof import("@/webview/lib/stores");

beforeAll(async () => {
  setupWebviewTest();
  hints = await import("@/webview/lib/hints");
  stores = await import("@/webview/lib/stores");
});

it("shows the commit menu hint until a commit menu opens, then remembers the dismissal", () => {
  expect(hints.commitMenuHintDismissed.value).toBe(false);
  stores.contextMenu.value = { x: 0, y: 0, entries: [], source: "ref:head:main" };
  expect(hints.commitMenuHintDismissed.value).toBe(false);
  stores.contextMenu.value = { x: 0, y: 0, entries: [], source: "commit:abc" };
  expect(hints.commitMenuHintDismissed.value).toBe(true);
  expect(vscodeApi.setState).toHaveBeenCalledWith(
    expect.objectContaining({ hints: { commitMenu: true } })
  );
  stores.contextMenu.value = null;
});
