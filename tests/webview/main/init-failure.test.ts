// @vitest-environment jsdom
import { afterAll, beforeAll, expect, it, vi } from "vitest";

import { app, fakeExtension, posted, prepareShell } from "./page-harness";

beforeAll(async () => {
  prepareShell();
  fakeExtension((method) =>
    method === "webview.initialize" ? { error: "boom $& {0} end $$ $' $`" } : undefined
  );
  await import("@/webview/main");
});

afterAll(() => vi.unstubAllGlobals());

it("replaces the spinner with the failure, quoting the message as it is", async () => {
  await vi.waitFor(() => expect(app().querySelector("[role=alert]")).not.toBeNull());
  expect(app().children).toHaveLength(1);
  const alert = app().firstElementChild!;
  expect(alert.getAttribute("role")).toBe("alert");
  expect(alert.textContent).toBe("Unable to open the graph: boom $& {0} end $$ $' $`");
  // Laid out like the other full-page messages: padded, in the foreground colour.
  expect(alert.className).toMatch(/\bpx-\d/);
  expect(alert.className).toMatch(/\btext-fg\b/);
});

it("never reports ready and asks for nothing more", async () => {
  await new Promise((resolve) => setTimeout(resolve, 30));
  expect(posted()).toEqual(["rpc:webview.initialize"]);
});
