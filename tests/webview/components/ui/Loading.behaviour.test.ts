// @vitest-environment jsdom
import { h, render } from "preact";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { GraphSkeleton, Loading } from "@/webview/components/ui/Loading";

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
  it("is an inline status with its text in a span", () => {
    const status = show();
    expect(status.getAttribute("role")).toBe("status");
    expect(status.querySelector("span")?.textContent).toBe("Fetching…");
    expect(status.textContent).toBe("Fetching…");
    expect(host.querySelector("h1")).toBeNull();
  });

  it("leaves polite announcing to the status role", () => {
    // The explicit aria-live was redundant with role="status" and has been dropped.
    expect(show().hasAttribute("aria-live")).toBe(false);
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
    const status = show();
    expect(status.getAttribute("role")).toBe("status");
    expect(status.textContent).toBe("");
  });

  it("keeps its drawing silent and out of the tab order", () => {
    const status = show();
    const glyphs = [...status.querySelectorAll("svg")];
    expect(glyphs.length).toBeGreaterThan(0);
    for (const glyph of glyphs) {
      expect(glyph.getAttribute("aria-hidden")).toBe("true");
      expect(glyph.getAttribute("focusable")).toBe("false");
    }
    expect(status.textContent).toBe("Fetching…");
  });

  it("reads the shell's text again whenever it is drawn", () => {
    html.dataset["loading"] = "One moment";
    expect(show().textContent).toBe("One moment");
    html.dataset["loading"] = "Almost there";
    expect(show().textContent).toBe("Almost there");
  });
});

describe("GraphSkeleton", () => {
  function skeleton() {
    render(h(GraphSkeleton, null), host);
    return host.firstElementChild as HTMLElement;
  }

  it("is a busy status that says only the loading text", () => {
    const status = skeleton();
    expect(status.getAttribute("role")).toBe("status");
    expect(status.getAttribute("aria-busy")).toBe("true");
    expect(status.textContent).toBe("Fetching…");
    const text = status.querySelector("span")!;
    expect(text.textContent).toBe("Fetching…");
    expect(text.classList.contains("sr-only")).toBe(true);
  });

  it("draws eight to twelve placeholder rows on the table's grid, hidden from screen readers", () => {
    const placeholders = skeleton().querySelector('[aria-hidden="true"]')!;
    const rows = [...placeholders.children] as Array<HTMLElement>;
    expect(rows.length).toBeGreaterThanOrEqual(8);
    expect(rows.length).toBeLessThanOrEqual(12);
    for (const row of rows) {
      expect(row.classList.contains("h-6")).toBe(true);
      expect(row.textContent).toBe("");
      expect(row.querySelectorAll(".skeleton-shimmer").length).toBeGreaterThanOrEqual(4);
    }
    // Dots in more than one lane and descriptions of different lengths, as in a history.
    const lanes = new Set(
      rows.map((row) => (row.querySelector(".rounded-full") as HTMLElement).style.marginLeft)
    );
    expect(lanes.size).toBeGreaterThan(1);
    const widths = new Set(
      rows.map((row) => (row.querySelector(".flex-1 > span") as HTMLElement).style.width)
    );
    expect(widths.size).toBe(rows.length);
  });
});
