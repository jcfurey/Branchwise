// @vitest-environment jsdom
import { h, render } from "preact";
import { expect, it } from "vitest";

import { LoadingPage } from "@/webview/pages/LoadingPage";

it("fills the window with the loading heading before any strings have arrived", () => {
  expect("l10n" in window).toBe(false);
  document.documentElement.dataset["loading"] = "Starting up";
  const host = document.createElement("div");
  render(h(LoadingPage, null), host);

  expect(host.childElementCount).toBe(1);
  const main = host.firstElementChild!;
  expect(main.tagName).toBe("MAIN");
  const statuses = main.querySelectorAll('[role="status"]');
  expect(statuses).toHaveLength(1);
  expect(statuses[0]!.querySelector("h1")?.textContent).toBe("Starting up");

  render(null, host);
  delete document.documentElement.dataset["loading"];
});
