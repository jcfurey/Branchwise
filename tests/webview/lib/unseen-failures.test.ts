// @vitest-environment jsdom

import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

let remote: typeof import("@/webview/lib/remote-actions");
let result: typeof import("@/webview/lib/handler/action-result");
let actions: typeof import("@/webview/lib/actions");
let stores: typeof import("@/webview/lib/stores");
let activity: typeof import("@/webview/lib/activity");
let view: typeof import("@/webview/components/history/ActivityView");
let Dialog: typeof import("@/webview/components/ui/Dialog").Dialog;
let container: HTMLDivElement;

beforeAll(async () => {
  setupWebviewTest();
  remote = await import("@/webview/lib/remote-actions");
  result = await import("@/webview/lib/handler/action-result");
  actions = await import("@/webview/lib/actions");
  stores = await import("@/webview/lib/stores");
  activity = await import("@/webview/lib/activity");
  view = await import("@/webview/components/history/ActivityView");
  Dialog = (await import("@/webview/components/ui/Dialog")).Dialog;
});

beforeEach(() => {
  vscodeApi.postMessage.mockClear();
  activity.activity.value = [];
  stores.dialog.value = null;
  stores.selectedRepo.value = "/repo";
  container = document.createElement("div");
  document.body.append(container);
  act(() => render(h("div", null, h(view.ActivityIndicator, null), h(Dialog, null)), container));
});
afterEach(() => {
  act(() => {
    stores.dialog.value = null;
    render(null, container);
  });
  container.remove();
});

function fetch(requestId: string) {
  act(() =>
    remote.sendRemoteAction(
      { command: "fetchRemote", remote: "origin", prune: false, requestId },
      "/repo",
      "Running"
    )
  );
}

function fail(requestId: string) {
  act(() =>
    result.handleActionResult({
      command: "fetchRemote",
      requestId,
      repo: "/repo",
      status: "timeout"
    })
  );
}

const cue = () => container.querySelector("[data-unseen-failures]");

describe("failures no dialog showed", () => {
  it("stay visible after the running dialog was hidden", () => {
    fetch("hidden");
    act(() => actions.closeDialog());
    fail("hidden");
    expect(stores.dialog.value).toBeNull();
    expect(cue()?.textContent).toBe("unseenFailures");
    act(() => (cue() as HTMLButtonElement).click());
    expect(stores.dialog.value).toMatchObject({ kind: "content", message: "operationActivity" });
    expect(cue()).toBeNull();
  });

  it("stay visible after switching repositories", () => {
    fetch("switched");
    act(() => {
      stores.selectedRepo.value = "/other";
    });
    fail("switched");
    expect(stores.dialog.value).toBeNull();
    expect(cue()).not.toBeNull();
  });

  it("do not replace a newer dialog", () => {
    fetch("replaced");
    act(() => actions.openErrorDialog("newer"));
    const newer = stores.dialog.value;
    fail("replaced");
    expect(stores.dialog.value).toBe(newer);
    expect(cue()).not.toBeNull();
  });

  it("are not reported twice when the dialog showed them", () => {
    fetch("shown");
    fail("shown");
    expect(stores.dialog.value).toMatchObject({ kind: "error", reason: "timeout" });
    expect(cue()).toBeNull();
  });
});

it("keeps a dialog open when the second click of the opening double-click hits the backdrop", () => {
  act(() => actions.openErrorDialog("opened by a double-click"));
  const backdrop = container.querySelector(".fixed.inset-0") as HTMLElement;
  act(() => {
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 2 }));
  });
  expect(stores.dialog.value).not.toBeNull();
  act(() => {
    backdrop.dispatchEvent(new MouseEvent("click", { bubbles: true, detail: 1 }));
  });
  expect(stores.dialog.value).toBeNull();
});
