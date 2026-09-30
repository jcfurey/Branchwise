// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, expect, it, vi } from "vitest";

import { App } from "@/webview/App";
import { refsVisible } from "@/webview/lib/navigation";
import * as stores from "@/webview/lib/stores";

import { setupWebviewTest } from "@tests/webview/test-utils";

vi.mock("@/webview/layout/GraphView", () => ({
  GraphView: () => {
    throw new Error("graph exploded");
  }
}));

let host: HTMLDivElement | undefined;

beforeAll(() => setupWebviewTest());

afterEach(() => {
  act(() => render(null, host!));
  host?.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("replaces only the graph column when the graph cannot render", () => {
  // The boundary reports what it caught.
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    }
  );
  stores.selectedRepo.value = "/srv/app";
  refsVisible.value = true;
  host = document.createElement("div");
  document.body.append(host);
  act(() => render(h(App, { repos: [{ name: "app", path: "/srv/app" }] }), host!));

  expect(host.querySelector("header")).not.toBeNull();
  expect(host.querySelector("nav")).not.toBeNull();
  const alert = host.querySelector("[role=alert]")!;
  expect(alert.textContent).toContain("viewFailed");
  expect(alert.querySelector("button")?.textContent).toBe("retryView");
  // The column around the message stays in the content row, beside the sidebar.
  expect(alert.parentElement?.previousElementSibling?.querySelector("nav")).not.toBeNull();
});
