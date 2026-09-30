// @vitest-environment jsdom
import { h, render } from "preact";
import { expect, it } from "vitest";

import { ScrollShadow } from "@/webview/components/ui/ScrollShadow";

it("is one empty, hidden element that the stylesheet animates", () => {
  const host = document.createElement("div");
  render(h(ScrollShadow, null), host);

  expect(host.childElementCount).toBe(1);
  const shade = host.firstElementChild!;
  expect(shade.tagName).toBe("DIV");
  expect(shade.getAttribute("aria-hidden")).toBe("true");
  expect(shade.hasAttribute("role")).toBe(false);
  expect(shade.childNodes).toHaveLength(0);
  expect(shade.textContent).toBe("");
  // The rule and the token these name are checked in the compiled stylesheet's test.
  expect(shade.classList.contains("animate-scroll-shadow")).toBe(true);
  expect(shade.classList.contains("shadow-scroll")).toBe(true);

  render(null, host);
});
