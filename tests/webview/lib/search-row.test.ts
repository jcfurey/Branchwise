// @vitest-environment jsdom

import { beforeAll, expect, it } from "vitest";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

let navigation: typeof import("@/webview/lib/navigation");
let focus: typeof import("@/webview/lib/focus");

beforeAll(async () => {
  setupWebviewTest();
  navigation = await import("@/webview/lib/navigation");
  focus = await import("@/webview/lib/focus");
});

it("keeps the search row closed until asked, and remembers the choice", () => {
  expect(navigation.searchVisible.value).toBe(false);
  navigation.toggleSearch();
  expect(navigation.searchVisible.value).toBe(true);
  expect(vscodeApi.setState).toHaveBeenLastCalledWith(
    expect.objectContaining({ navigation: expect.objectContaining({ search: true }) })
  );
  navigation.toggleSearch();
  expect(navigation.searchVisible.value).toBe(false);
});

it("opens the search row and focuses its field", async () => {
  const input = document.createElement("input");
  input.setAttribute("data-history-search", "");
  document.body.append(input);
  focus.focusSearch();
  expect(navigation.searchVisible.value).toBe(true);
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(document.activeElement).toBe(input);
  input.remove();
  navigation.toggleSearch();
});

it("opens a pane on request without closing the other", () => {
  navigation.workspaceVisible.value = false;
  navigation.refsVisible.value = false;
  navigation.showPane("workspace");
  expect(navigation.workspaceVisible.value).toBe(true);
  expect(navigation.refsVisible.value).toBe(false);
  navigation.showPane("refs");
  expect(navigation.refsVisible.value).toBe(true);
  expect(navigation.workspaceVisible.value).toBe(true);
});
