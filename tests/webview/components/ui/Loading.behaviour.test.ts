// @vitest-environment jsdom
import { h, render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Loading } from "@/webview/components/ui/Loading";

const html = document.documentElement;
let host: HTMLDivElement;

/** Draw the indicator and return its root, the live region. */
function show(props: Parameters<typeof Loading>[0] = {}) {
  render(h(Loading, props), host);
  expect(host.childElementCount).toBe(1);
  return host.firstElementChild as HTMLElement;
}

beforeEach(() => {
  host = document.createElement("div");
  html.dataset["loading"] = "Fetching…";
});

afterEach(() => {
  render(null, host);
  delete html.dataset["loading"];
});

describe("Loading", () => {
  it("is an inline status with its text in a span unless the page layout is asked for", () => {
    const status = show();
    expect(status.getAttribute("role")).toBe("status");
    expect(status.querySelector("span")?.textContent).toBe("Fetching…");
    expect(status.textContent).toBe("Fetching…");
    expect(host.querySelector("h1")).toBeNull();
  });

  it("leaves polite announcing to the status role", () => {
    // The explicit aria-live was redundant with role="status" and has been dropped.
    expect(show().hasAttribute("aria-live")).toBe(false);
    expect(show({ variant: "page" }).hasAttribute("aria-live")).toBe(false);
  });

  it("adds the caller's classes after its own, with no stray spaces", () => {
    const own = show().getAttribute("class")!;
    expect(own).toBe(own.trim());
    expect(own).not.toContain("  ");

    const sized = show({ class: "h-full" });
    expect(sized.classList.contains("h-full")).toBe(true);
    expect(sized.getAttribute("class")).toBe(`${own} h-full`);
  });

  it("still draws, with no text, when the shell carries none", () => {
    delete html.dataset["loading"];
    for (const variant of ["inline", "page"] as const) {
      const status = show({ variant });
      expect(status.getAttribute("role")).toBe("status");
      expect(status.textContent).toBe("");
    }
  });

  it("keeps its drawing silent and out of the tab order", () => {
    const status = show({ variant: "page" });
    const glyphs = [...status.querySelectorAll("svg")];
    expect(glyphs.length).toBeGreaterThan(0);
    for (const glyph of glyphs) {
      expect(glyph.getAttribute("aria-hidden")).toBe("true");
      expect(glyph.getAttribute("focusable")).toBe("false");
    }

    const heading = status.querySelector("h1")!;
    expect(heading.textContent).toBe("Fetching…");
    const track = heading.nextElementSibling!;
    expect(track.getAttribute("aria-hidden")).toBe("true");
    expect(track.textContent).toBe("");
    expect(status.textContent).toBe("Fetching…");
  });

  it("reads the shell's text again whenever it is drawn", () => {
    html.dataset["loading"] = "One moment";
    expect(show().textContent).toBe("One moment");
    html.dataset["loading"] = "Almost there";
    expect(show().textContent).toBe("Almost there");
  });
});
