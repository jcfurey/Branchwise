// @vitest-environment jsdom
import { beforeAll, beforeEach, expect, it } from "vitest";

import { openRunningDialog } from "@/webview/lib/actions";
import { handleViewDiff } from "@/webview/lib/handler/view-diff";
import { contextMenu, dialog } from "@/webview/lib/stores";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  dialog.value = null;
  contextMenu.value = null;
});

it("leaves an opened diff alone", () => {
  openRunningDialog("opening");
  const shown = dialog.value;
  vscodeApi.postMessage.mockClear();

  handleViewDiff({ command: "viewDiff", success: true });

  expect(dialog.value).toBe(shown);
  expect(vscodeApi.postMessage).not.toHaveBeenCalled();
});

it("reports a diff that did not open, closing the menu", () => {
  contextMenu.value = { x: 0, y: 0, entries: [], source: "file:a" };

  handleViewDiff({ command: "viewDiff", success: false });

  expect(contextMenu.value).toBeNull();
  expect(dialog.value).toMatchObject({ kind: "error", message: "unableToViewDiff", reason: null });
});
