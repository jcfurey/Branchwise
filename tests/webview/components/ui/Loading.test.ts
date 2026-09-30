// @vitest-environment jsdom
import { h, render } from "preact";
import { afterEach, expect, it } from "vitest";

import { Loading } from "@/webview/components/ui/Loading";

afterEach(() => {
  delete document.documentElement.dataset["loading"];
});

it("shows the loading text that the page shell carries, before window.l10n exists", () => {
  document.documentElement.dataset["loading"] = "正在加载…";
  const container = document.createElement("div");
  render(h(Loading, { variant: "page" }), container);
  expect(container.querySelector("h1")?.textContent).toBe("正在加载…");
  render(h(Loading, { variant: "inline" }), container);
  expect(container.querySelector('[role="status"]')?.textContent).toBe("正在加载…");
  render(null, container);
});
