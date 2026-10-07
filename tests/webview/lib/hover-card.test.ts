// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { RepositoryQuery } from "@/backend/types";
import { CommitTable } from "@/webview/components/commit/CommitTable";
import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { HOVER_CARD_DELAY, placeCard, pointerBox } from "@/webview/lib/hover-card";
import { handleRepositoryQuery } from "@/webview/lib/repository-actions";
import {
  contextMenu,
  dialog,
  expandedCommit,
  repoStates,
  selectedRepo
} from "@/webview/lib/stores";

import {
  attachHost,
  entry,
  plainText,
  reconfigure,
  speak,
  stubResizeObserver
} from "@tests/webview/components/commit/commit-view-fixtures";
import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const WINDOW = { width: 1000, height: 700 };
const CARD = { width: 300, height: 200 };

describe("placeCard", () => {
  it("puts the card below the anchor, starting at its left edge", () => {
    const place = placeCard({ left: 100, top: 100, right: 100, bottom: 118 }, CARD, WINDOW);
    expect(place).toEqual({ left: 100, top: 122, above: false, before: false });
  });

  it("goes above the anchor near the bottom of the window", () => {
    const place = placeCard({ left: 100, top: 600, right: 100, bottom: 618 }, CARD, WINDOW);
    expect(place).toMatchObject({ top: 600 - 4 - CARD.height, above: true });
  });

  it("ends at the anchor's right edge near the right of the window", () => {
    const place = placeCard({ left: 900, top: 100, right: 950, bottom: 124 }, CARD, WINDOW);
    expect(place).toMatchObject({ left: 950 - CARD.width, before: true });
  });

  it("flips both ways in the bottom right corner", () => {
    const anchor = pointerBox(990, 690);
    const place = placeCard(anchor, CARD, WINDOW);
    expect(place).toMatchObject({ above: true, before: true });
    expect(place.left + CARD.width).toBeLessThanOrEqual(WINDOW.width - 8);
    expect(place.top + CARD.height).toBeLessThanOrEqual(WINDOW.height - 8);
  });

  it("stays below when there is more room there, moving up just enough to fit", () => {
    const place = placeCard(
      { left: 10, top: 300, right: 10, bottom: 318 },
      { width: 100, height: 500 },
      WINDOW
    );
    expect(place).toMatchObject({ above: false, top: WINDOW.height - 8 - 500 });
  });

  it("keeps a card wider or taller than the window at its top left edges", () => {
    const place = placeCard(pointerBox(500, 300), { width: 2000, height: 900 }, WINDOW);
    expect(place).toMatchObject({ left: 8, top: 8 });
  });
});

type Posted = { command: string; repo: string; requestId: string; query?: RepositoryQuery };
const reads = () =>
  vscodeApi.postMessage.mock.calls
    .map(([sent]) => sent as Posted)
    .filter(
      (message) => message.command === "repositoryQuery" && message.query?.kind === "commitStats"
    );

const FULL = "f".repeat(40);
const COMMITS = [
  entry(UNCOMMITTED_CHANGES),
  entry(FULL, ["b".repeat(40)], {
    message: "Fix the parser",
    author: "Ann Lee",
    email: "ann@example.test",
    date: 1_700_000_000
  }),
  entry("b".repeat(40))
];

let host: HTMLDivElement;
let repo = "";
let count = 0;

const draw = () =>
  act(() => render(h(CommitTable, { commits: COMMITS, head: FULL, headBranch: "main" }), host));
const row = (hash: string) =>
  host.querySelector<HTMLTableRowElement>(`tr[data-commit-hash="${hash}"]`)!;
const message = (hash: string) => row(hash).querySelector<HTMLElement>("[data-commit-message]")!;
const card = () => document.querySelector<HTMLElement>("[data-hover-card]");
const field = (name: string) =>
  plainText(card()?.querySelector(`[data-hover-${name}]`)?.textContent);
const wait = (ms: number) =>
  act(() => {
    vi.advanceTimersByTime(ms);
  });
const mouse = (target: Element, type: string, x = 200, y = 100) =>
  act(() => {
    target.dispatchEvent(new MouseEvent(type, { bubbles: true, clientX: x, clientY: y }));
  });
const key = (target: Element, name: string) =>
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: name, bubbles: true }));
  });

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  vi.stubEnv("TZ", "UTC");
  vi.useFakeTimers();
  speak({ loadingChanges: "Counting changes…", filesChangedPlural: "{0} files changed" });
  stubResizeObserver();
  vi.spyOn(window, "scrollBy").mockImplementation(() => {});
  count += 1;
  repo = `/cards-${count}`;
  selectedRepo.value = repo;
  repoStates.value = {};
  expandedCommit.value = null;
  contextMenu.value = null;
  dialog.value = null;
  vscodeApi.postMessage.mockClear();
  host = attachHost();
  draw();
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
  contextMenu.value = null;
  dialog.value = null;
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the commit card", () => {
  it("shows after the pointer rests on a message for 600 ms, and not before", () => {
    mouse(message(FULL), "mouseover");
    wait(HOVER_CARD_DELAY - 1);
    expect(card()).toBeNull();
    // Moving over the same message does not start the wait again.
    mouse(message(FULL), "mouseover");
    wait(1);
    expect(card()?.dataset["hoverCard"]).toBe(FULL);
  });

  it("is a picture only: hidden from screen readers, and the row under it takes clicks", () => {
    const before = document.activeElement;
    mouse(message(FULL), "mouseover");
    wait(HOVER_CARD_DELAY);
    expect(card()?.getAttribute("aria-hidden")).toBe("true");
    expect(card()?.className).toContain("pointer-events-none");
    expect(card()?.querySelector("button, a, input, [tabindex]")).toBeNull();
    expect(document.activeElement).toBe(before);
  });

  it("holds the subject, author, date, both IDs, and the counts once read", () => {
    mouse(message(FULL), "mouseover");
    wait(HOVER_CARD_DELAY);
    expect(field("subject")).toBe("Fix the parser");
    expect(field("author")).toBe("Ann Lee <ann@example.test>");
    expect(field("date")).toContain("2023");
    expect(field("id")).toBe(`ffffffff ${FULL}`);
    expect(field("changes")).toBe("Counting changes…");
    expect(card()?.querySelector("[data-hover-body]")).toBeNull();

    const read = reads().at(-1)!;
    expect(read.query).toEqual({ kind: "commitStats", hashes: [FULL] });
    act(() =>
      handleRepositoryQuery({
        repo: read.repo,
        requestId: read.requestId,
        data: {
          kind: "commitStats",
          stats: {
            [FULL]: { files: 4, additions: 12, deletions: 3, body: "Why\n\nHow", bodyCut: true }
          }
        },
        status: null
      })
    );
    expect(field("changes")).toBe("+12 −3 4 files changed");
    expect(card()?.querySelector("[data-hover-body]")?.textContent).toBe("Why\n\nHow…");
    expect(card()?.querySelector("[data-hover-body]")?.className).toContain("line-clamp-6");
  });

  it("goes when the pointer leaves the message, and never comes for the uncommitted changes", () => {
    mouse(message(FULL), "mouseover");
    wait(HOVER_CARD_DELAY);
    expect(card()).not.toBeNull();
    mouse(row(FULL).cells[2]!, "mouseover");
    expect(card()).toBeNull();

    mouse(message(FULL), "mouseover");
    wait(HOVER_CARD_DELAY / 2);
    mouse(host.firstElementChild!, "mouseleave");
    wait(HOVER_CARD_DELAY);
    expect(card()).toBeNull();

    mouse(row(UNCOMMITTED_CHANGES).cells[1]!.querySelector("span.flex-1")!, "mouseover");
    wait(HOVER_CARD_DELAY);
    expect(card()).toBeNull();
  });

  it.each([
    ["a scroll", () => window.dispatchEvent(new Event("scroll"))],
    ["Escape", () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }))],
    ["a press", () => window.dispatchEvent(new MouseEvent("mousedown"))],
    ["a menu opening", () => (contextMenu.value = { x: 0, y: 0, entries: [], source: "x" })],
    [
      "a dialog opening",
      () => (dialog.value = { kind: "error", message: "x", reason: null, token: 1 })
    ]
  ])("goes on %s", (_name, hide) => {
    mouse(message(FULL), "mouseover");
    wait(HOVER_CARD_DELAY);
    expect(card()).not.toBeNull();
    act(() => {
      hide();
    });
    expect(card()).toBeNull();
  });

  it("does not come while a menu is open", () => {
    act(() => {
      contextMenu.value = { x: 0, y: 0, entries: [], source: "x" };
    });
    mouse(message(FULL), "mouseover");
    wait(HOVER_CARD_DELAY);
    expect(card()).toBeNull();
  });

  it("shows after a key moves the focus to a row and nothing else is pressed", () => {
    const top = row(UNCOMMITTED_CHANGES);
    act(() => top.focus());
    key(top, "ArrowDown");
    expect(document.activeElement).toBe(row(FULL));
    wait(HOVER_CARD_DELAY);
    expect(card()?.dataset["hoverCard"]).toBe(FULL);

    // A key that leaves the focus where it is hides the card and brings none.
    key(row(FULL), "Shift");
    wait(HOVER_CARD_DELAY * 2);
    expect(card()).toBeNull();

    // Pressing on before the wait is over starts it again for the next row.
    key(row(FULL), "ArrowDown");
    wait(HOVER_CARD_DELAY - 100);
    key(row("b".repeat(40)), "ArrowUp");
    wait(HOVER_CARD_DELAY - 100);
    expect(card()).toBeNull();
    wait(100);
    expect(card()?.dataset["hoverCard"]).toBe(FULL);

    // Leaving the row takes the card away.
    act(() => row(FULL).blur());
    expect(card()).toBeNull();
  });

  it("follows the setting, and leaves the message its tooltip when off", () => {
    expect(message(FULL).getAttribute("title")).toBe("");
    const restore = reconfigure({ commitHoverCards: false });
    try {
      draw();
      expect(message(FULL).title).toBe("Fix the parser");
      mouse(message(FULL), "mouseover");
      wait(HOVER_CARD_DELAY);
      expect(card()).toBeNull();
    } finally {
      restore();
    }
  });

  it("flips above and to the left of a pointer near the bottom right corner", () => {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement
    ) {
      return (this.hasAttribute("data-hover-card") ? CARD : { width: 0, height: 0 }) as DOMRect;
    });
    const { innerWidth, innerHeight } = window;
    mouse(message(FULL), "mouseover", innerWidth - 20, innerHeight - 20);
    wait(HOVER_CARD_DELAY);
    const shown = card()!;
    expect(shown.style.visibility).toBe("visible");
    expect(shown.dataset["above"]).toBe("true");
    expect(shown.dataset["before"]).toBe("true");
    expect(parseFloat(shown.style.left)).toBe(innerWidth - 20 - CARD.width);
    expect(parseFloat(shown.style.top)).toBe(innerHeight - 20 - 4 - CARD.height);

    mouse(message(FULL), "mouseover", 30, 40);
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    mouse(message(FULL), "mouseover", 30, 40);
    wait(HOVER_CARD_DELAY);
    expect(card()!.dataset["above"]).toBe("false");
    expect(card()!.dataset["before"]).toBe("false");
    expect([card()!.style.left, card()!.style.top]).toEqual(["30px", `${40 + 18 + 4}px`]);
  });
});
