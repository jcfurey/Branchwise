// @vitest-environment jsdom

import { h, render } from "preact";
import { beforeAll, expect, it } from "vitest";

import { setupWebviewTest } from "@tests/webview/test-utils";

let BranchFocusBadge: typeof import("@/webview/components/commit/BranchFocusBadge").BranchFocusBadge;
let stores: typeof import("@/webview/lib/stores");

beforeAll(async () => {
  setupWebviewTest();
  Object.defineProperty(window, "l10n", {
    value: new Proxy({}, { get: (_target, key) => (key === "branchFocus" ? "Focus: {0}" : key) }),
    configurable: true
  });
  ({ BranchFocusBadge } = await import("@/webview/components/commit/BranchFocusBadge"));
  stores = await import("@/webview/lib/stores");
});

it.each([
  ["remotes/origin/x$&y", "Focus: origin/x$&y"],
  ["a$$b", "Focus: a$$b"],
  ["q$`r$'s", "Focus: q$`r$'s"]
])("names the focused branch %s as written in its title", (branch, title) => {
  stores.branchDisplay.value = "focus";
  stores.selectedBranch.value = branch;
  const container = document.createElement("div");

  render(h(BranchFocusBadge, { branch }), container);

  expect(container.querySelector("[data-focus-branch]")?.getAttribute("title")).toBe(title);
  render(null, container);
});
