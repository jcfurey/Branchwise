// @vitest-environment jsdom

import { Fragment, h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContextMenu } from "@/webview/components/ui/ContextMenu";
import { Dialog } from "@/webview/components/ui/Dialog";
import { closeContextMenu, openContentDialog, openContextMenu } from "@/webview/lib/actions";
import { contextMenu, dialog } from "@/webview/lib/stores";
import type { ContextMenuEntry, ContextMenuState } from "@/webview/types";

import { setupWebviewTest } from "@tests/webview/test-utils";

setupWebviewTest();

let container: HTMLDivElement;
let outside: HTMLButtonElement;
/** Titles of the items chosen, with whether the menu was already closed when each ran. */
let chosen: Array<{ title: string; closed: boolean }>;

beforeEach(() => {
  chosen = [];
  container = document.createElement("div");
  outside = document.createElement("button");
  document.body.append(container, outside);
  act(() => render(h(Fragment, null, h(ContextMenu, null), h(Dialog, null)), container));
});

afterEach(async () => {
  act(() => {
    dialog.value = null;
    closeContextMenu();
  });
  // Let the focus return run, so no test inherits a control to return to.
  await Promise.resolve();
  act(() => render(null, container));
  container.remove();
  outside.remove();
  vi.restoreAllMocks();
});

/** Entries from titles, with "—" for a separator. Choosing an item records it in `chosen`. */
function entries(...titles: Array<string>): Array<ContextMenuEntry> {
  return titles.map((title) =>
    title === "—"
      ? null
      : { title, onClick: () => chosen.push({ title, closed: contextMenu.value === null }) }
  );
}

function open(list: Array<ContextMenuEntry>, state: Partial<ContextMenuState> = {}) {
  const shown: ContextMenuState = { x: 0, y: 0, source: "test", entries: list, ...state };
  act(() => {
    contextMenu.value = shown;
  });
  return shown;
}

const menu = () => container.querySelector<HTMLElement>('[role="menu"]');
const items = () => [...menu()!.querySelectorAll<HTMLElement>('[role="menuitem"]')];
const item = (title: string) => items().find((element) => element.textContent === title)!;
/** The menu's rows as titles, with "—" for a separator. */
const rows = () =>
  [...menu()!.children].map((row) =>
    row.getAttribute("role") === "separator" ? "—" : row.textContent
  );

/** Text of the highlighted item, `null` when nothing is highlighted. */
function highlighted() {
  const id = menu()!.getAttribute("aria-activedescendant");
  return id === null ? null : (document.getElementById(id)?.textContent ?? `missing ${id}`);
}

function press(key: string, init: KeyboardEventInit = {}, target: Element = menu()!) {
  const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

function dispatch(target: EventTarget, event: Event) {
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}

const pointer = (type: string, target: EventTarget, bubbles = true) =>
  dispatch(target, new PointerEvent(type, { bubbles, cancelable: true }));

function rect(left: number, top: number, width: number, height: number) {
  return {
    x: left,
    y: top,
    left,
    top,
    right: left + width,
    bottom: top + height,
    width,
    height,
    toJSON: () => ({})
  } as DOMRect;
}

/** Give the menu a size and the window another, as jsdom lays nothing out. */
function measure(width: number, height: number, windowWidth = 1024, windowHeight = 768) {
  vi.spyOn(window, "innerWidth", "get").mockReturnValue(windowWidth);
  vi.spyOn(window, "innerHeight", "get").mockReturnValue(windowHeight);
  const original = Element.prototype.getBoundingClientRect;
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    return this.getAttribute("role") === "menu" ? rect(0, 0, width, height) : original.call(this);
  });
}

const placed = () => [parseFloat(menu()!.style.left), parseFloat(menu()!.style.top)];

/** A button that opens a menu of `titles` through the actions, as the webview's controls do. */
function opener(type: "click" | "contextmenu", source: string, ...titles: Array<string>) {
  const button = document.createElement("button");
  button.addEventListener(type, (event) => openContextMenu(event, source, entries(...titles)));
  document.body.append(button);
  return button;
}

const scroll = () => new Event("scroll");

/** Whether listener options ask for the capture phase. */
const usesCapture = (options?: boolean | EventListenerOptions) =>
  typeof options === "boolean" ? options : options?.capture === true;

const mouse = (type: string, x: number, y: number) =>
  new MouseEvent(type, { bubbles: true, cancelable: true, detail: 1, clientX: x, clientY: y });

describe("rendering", () => {
  it("renders nothing while no menu is open", () => {
    expect(container.children).toHaveLength(0);
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });

  it("draws items and separators in order, each item showing its title", () => {
    open(entries("A", "—", "B", "C"));
    expect(rows()).toEqual(["A", "—", "B", "C"]);
    expect(menu()!.querySelectorAll('[role="menuitem"]')).toHaveLength(3);
    expect(menu()!.querySelectorAll('[role="separator"]')).toHaveLength(1);
  });

  it("drops separators at the ends and draws a run of them as one", () => {
    open(entries("—", "A", "—", "—", "B", "—"));
    expect(rows()).toEqual(["A", "—", "B"]);
    open(entries("—", "—", "A", "—", "—", "—"));
    expect(rows()).toEqual(["A"]);
  });

  it("shows titles as plain text, spaces included", () => {
    const title = "  Spaced <b>html</b> ✓ ";
    open(entries("<b>x</b>", title));
    expect(items().map((element) => element.textContent)).toEqual(["<b>x</b>", title]);
    expect(menu()!.querySelector("b")).toBeNull();
  });

  it("keeps items with the same title apart", () => {
    const first = vi.fn();
    const second = vi.fn();
    open([
      { title: "Same", onClick: first },
      { title: "Same", onClick: second }
    ]);
    expect(items()).toHaveLength(2);
    press("ArrowDown");
    press("ArrowDown");
    press("Enter");
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledOnce();
  });

  it("gives every item an id unique across menus and exposes roles only", () => {
    open(entries("A", "—", "B"));
    const firstIds = items().map((element) => element.id);
    for (const id of firstIds) {
      expect(document.getElementById(id)?.textContent).toMatch(/^[AB]$/);
    }
    open(entries("A", "B"), { source: "other" });
    const secondIds = items().map((element) => element.id);
    expect(new Set([...firstIds, ...secondIds]).size).toBe(4);
    expect(secondIds.every((id) => id !== "" && document.getElementById(id) !== null)).toBe(true);
    expect(items().every((element) => !element.hasAttribute("tabindex"))).toBe(true);

    open(entries("A", "—", "B"), { source: "third" });
    const separator = menu()!.querySelector('[role="separator"]')!;
    expect(separator.id).toBe("");
    expect(separator.hasAttribute("aria-orientation")).toBe(false);
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
  });

  it("draws an entry that is on or off as a checkbox item, ticked while on", () => {
    const [plain, on, off] = entries("Plain", "On", "Off") as Array<NonNullable<ContextMenuEntry>>;
    open([plain!, { ...on!, checked: true }, { ...off!, checked: false }]);

    const shown = [...menu()!.children];
    expect(
      shown.map((row) => [row.getAttribute("role"), row.getAttribute("aria-checked")])
    ).toEqual([
      ["menuitem", null],
      ["menuitemcheckbox", "true"],
      ["menuitemcheckbox", "false"]
    ]);
    // The tick is drawn from an attribute, so each item's text and name stay its title.
    expect(rows()).toEqual(["Plain", "On", "Off"]);
    expect(
      shown.map((row) => row.querySelector("[data-check]")?.getAttribute("data-check"))
    ).toEqual([undefined, "✓", ""]);

    // The keyboard moves over checkbox items and chooses them like any other.
    press("End");
    expect(highlighted()).toBe("Off");
    press("Enter");
    expect(chosen).toEqual([{ title: "Off", closed: true }]);
  });

  it("shows an empty frame for a menu without items", () => {
    open([]);
    expect(menu()).not.toBeNull();
    expect(menu()!.children).toHaveLength(0);
    open(entries("—", "—"));
    expect(menu()!.children).toHaveLength(0);
  });
});

describe("placement", () => {
  it.each([
    [10, 20, 8, 18],
    [150, 220, 148, 218],
    [0, 0, 0, 0],
    [1, 1, 0, 0],
    [2, 2, 0, 0],
    [3, 3, 1, 1],
    [823, 617, 821, 615],
    [823.5, 617.5, 821.5, 615.5],
    [10.5, 20.25, 8.5, 18.25],
    [824, 618, 626, 470],
    [900, 700, 702, 552],
    [1000, 40, 802, 38],
    [120, 64, 118, 62],
    [-5, -7, 0, 0],
    // An anchor on the last pixel, on the far corner or beyond it keeps the menu inside the window.
    [1023, 767, 824, 618],
    [1024, 768, 824, 618],
    [2000, 900, 824, 618]
  ])("places a 200 × 150 menu anchored at (%s, %s) at (%s, %s)", (x, y, left, top) => {
    measure(200, 150);
    open(entries("A"), { x, y, source: `${x},${y}` });
    expect(placed()).toEqual([left, top]);
    expect(menu()!.style.opacity).toBe("");
  });

  it.each([
    [500, 300],
    [0, 0],
    [1023, 767]
  ])("places a menu larger than the window at its corner from (%s, %s)", (x, y) => {
    measure(1100, 900);
    open(entries("A"), { x, y, source: `${x},${y}` });
    expect(placed()).toEqual([0, 0]);
  });

  it.each([
    [20, 10, 18, 8],
    [48, 18, 46, 16],
    [49, 19, 47, 17],
    [49, 20, 47, 0],
    [50, 19, 0, 17],
    [50, 20, 0, 0],
    [100, 200, 0, 0],
    [340, 390, 42, 12]
  ])("places a 300 × 380 menu in a 350 × 400 window from (%s, %s) at (%s, %s)", (x, y, l, t) => {
    measure(300, 380, 350, 400);
    open(entries("A"), { x, y, source: `${x},${y}` });
    expect(placed()).toEqual([l, t]);
  });

  it("places an unmeasured menu 2 px above and left of its anchor", () => {
    open(entries("A"), { x: 0, y: 0 });
    expect(placed()).toEqual([0, 0]);
    open(entries("A"), { x: 30, y: 40 });
    expect(placed()).toEqual([28, 38]);
  });
});

describe("keyboard", () => {
  it("takes focus on open with nothing highlighted", () => {
    outside.focus();
    open(entries("A", "B"));
    expect(document.activeElement).toBe(menu());
    expect(menu()!.getAttribute("tabindex")).toBe("-1");
    expect(menu()!.hasAttribute("aria-activedescendant")).toBe(false);
  });

  it("moves the highlight with the arrows, Home and End, skipping separators", () => {
    open(entries("A", "—", "B", "C"));
    const element = menu();
    const steps = ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowDown", "End", "Home"];
    const seen = steps.map((key) => {
      expect(press(key).defaultPrevented).toBe(true);
      return highlighted();
    });
    expect(seen).toEqual(["A", "B", "C", "A", "C", "A"]);
    expect(menu()).toBe(element);
    expect(item("A").classList.contains("bg-menu-active")).toBe(true);
    expect(item("A").classList.contains("text-menu-active-fg")).toBe(true);
    for (const other of [item("B"), item("C")]) {
      expect(other.classList.contains("bg-menu-active")).toBe(false);
      expect(other.classList.contains("text-menu-active-fg")).toBe(false);
    }
  });

  it("wraps ArrowUp from the first item to the last", () => {
    open(entries("A", "—", "B", "C"));
    press("ArrowDown");
    press("ArrowUp");
    expect(highlighted()).toBe("C");
    press("ArrowUp");
    expect(highlighted()).toBe("B");
  });

  it.each([
    [["A", "—", "B", "C"], "C"],
    [["A", "B"], "B"],
    [["A", "B", "C", "D", "E"], "E"],
    [["A"], "A"]
  ])("goes from no highlight to the last item on ArrowUp in %j", (titles, last) => {
    open(entries(...titles));
    press("ArrowUp");
    expect(highlighted()).toBe(last);
  });

  it("ignores modifier keys", () => {
    open(entries("A", "B"));
    press("ArrowDown", { shiftKey: true });
    press("ArrowDown", { shiftKey: true });
    expect(highlighted()).toBe("B");
    expect(press("Enter", { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(chosen.map(({ title }) => title)).toEqual(["B"]);
  });

  it("leaves other keys to the browser", () => {
    open(entries("A", "B"));
    press("ArrowDown");
    for (const key of ["ArrowLeft", "ArrowRight", "PageDown", "PageUp", "b", "C", "F10"]) {
      expect(press(key).defaultPrevented).toBe(false);
    }
    expect(press("ContextMenu").defaultPrevented).toBe(false);
    expect(highlighted()).toBe("A");
    expect(menu()).not.toBeNull();
  });

  it.each(["Enter", " "])("chooses the highlighted item with %j after closing", (key) => {
    open(entries("A", "B"));
    press("ArrowDown");
    press("ArrowDown");
    expect(press(key).defaultPrevented).toBe(true);
    expect(chosen).toEqual([{ title: "B", closed: true }]);
    expect(menu()).toBeNull();
    expect(contextMenu.value).toBeNull();
  });

  it("does nothing on Enter with nothing highlighted", () => {
    open(entries("A", "B"));
    expect(press("Enter").defaultPrevented).toBe(false);
    expect(press("Enter", { ctrlKey: true }).defaultPrevented).toBe(false);
    expect(chosen).toEqual([]);
    expect(menu()).not.toBeNull();
  });

  it("swallows Space even with nothing highlighted", () => {
    open(entries("A", "B"));
    expect(press(" ").defaultPrevented).toBe(true);
    expect(chosen).toEqual([]);
    expect(menu()).not.toBeNull();
    expect(highlighted()).toBeNull();
  });

  it.each(["Enter", " "])("ignores a held %j", (key) => {
    open(entries("A"));
    press("ArrowDown");
    expect(press(key, { repeat: true }).defaultPrevented).toBe(true);
    expect(chosen).toEqual([]);
    expect(menu()).not.toBeNull();
    expect(highlighted()).toBe("A");
  });

  it.each([
    ["Escape", {}],
    ["Escape", { repeat: true }],
    ["Tab", {}],
    ["Tab", { shiftKey: true }]
  ])("closes on %s %j", (key, init) => {
    open(entries("A", "B"));
    press("ArrowDown");
    expect(press(key, init).defaultPrevented).toBe(true);
    expect(menu()).toBeNull();
    expect(contextMenu.value).toBeNull();
    expect(chosen).toEqual([]);
  });

  it("handles keys from inside the menu and lets them propagate", () => {
    open(entries("A", "B"));
    const received: Array<[string, boolean]> = [];
    const listener = (event: KeyboardEvent) => received.push([event.key, event.defaultPrevented]);
    window.addEventListener("keydown", listener);
    press("ArrowDown", {}, item("B"));
    expect(highlighted()).toBe("A");
    press("x");
    press("Escape");
    window.removeEventListener("keydown", listener);
    expect(received).toEqual([
      ["ArrowDown", true],
      ["x", false],
      ["Escape", true]
    ]);
  });

  it.each([
    ["Escape", () => press("Escape")],
    ["Tab", () => press("Tab")],
    ["Shift+Tab", () => press("Tab", { shiftKey: true })],
    [
      "choosing an item",
      () => {
        press("ArrowDown");
        press("Enter");
      }
    ]
  ])("returns focus to the control that opened it after %s", async (_name, close) => {
    const button = opener("contextmenu", "button", "A", "B");
    button.focus();
    dispatch(button, mouse("contextmenu", 50, 60));
    expect(placed()).toEqual([48, 58]);
    expect(document.activeElement).toBe(menu());
    close();
    expect(menu()).toBeNull();
    expect(document.activeElement).toBe(document.body);
    await Promise.resolve();
    expect(document.activeElement).toBe(button);
    button.remove();
  });
});

describe("empty menus", () => {
  it.each([[[]], [["—", "—"]]])("keeps the highlight empty in %j", (titles) => {
    const errors = vi.fn();
    window.addEventListener("error", errors);
    open(entries(...titles));
    for (const key of ["ArrowDown", "ArrowUp", "Home", "End", "ArrowDown"]) {
      press(key);
      expect(menu()!.hasAttribute("aria-activedescendant")).toBe(false);
    }
    expect(press("Enter").defaultPrevented).toBe(false);
    press(" ");
    expect(menu()).not.toBeNull();
    press("Escape");
    expect(menu()).toBeNull();
    open(entries(...titles));
    press("Tab");
    expect(menu()).toBeNull();
    window.removeEventListener("error", errors);
    expect(errors).not.toHaveBeenCalled();
  });
});

describe("pointer", () => {
  it("highlights the item the pointer moves over and keeps it when the pointer leaves", () => {
    open(entries("A", "—", "B", "C"));
    pointer("pointermove", item("B"));
    expect(highlighted()).toBe("B");
    expect(item("B").classList.contains("bg-menu-active")).toBe(true);
    pointer("pointerleave", item("B"), false);
    pointer("pointerleave", menu()!, false);
    pointer("pointerout", item("B"));
    dispatch(item("A"), mouse("mouseover", 0, 0));
    dispatch(item("A"), mouse("mousemove", 0, 0));
    expect(highlighted()).toBe("B");
    press("ArrowDown");
    expect(highlighted()).toBe("C");
  });

  it("chooses the clicked item whatever is highlighted", () => {
    open(entries("A", "B"));
    press("ArrowDown");
    act(() => item("B").click());
    expect(chosen).toEqual([{ title: "B", closed: true }]);
    expect(menu()).toBeNull();
  });

  it("stays open for presses, clicks and context menus inside it", () => {
    open(entries("A", "—", "B"));
    act(() => (menu()!.querySelector('[role="separator"]') as HTMLElement).click());
    pointer("pointerdown", menu()!);
    pointer("pointerdown", item("A"));
    const context = dispatch(item("A"), mouse("contextmenu", 5, 5));
    expect(context.defaultPrevented).toBe(true);
    expect(menu()).not.toBeNull();
    expect(chosen).toEqual([]);
  });

  it("scrolls only the menu to show the highlighted item", () => {
    open(entries("A", "B", "C", "D", "E"));
    const view = menu()!;
    const list = items();
    // A view 100 px high at y = 100 shows rows 30 px high below 4 px of padding.
    Object.defineProperty(view, "clientHeight", { configurable: true, value: 100 });
    const original = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (
      this: Element
    ) {
      if (this === view) {
        return rect(0, 100, 200, 100);
      }
      const index = list.indexOf(this as HTMLElement);
      return index < 0 ? original.call(this) : rect(0, 104 + 30 * index - view.scrollTop, 200, 30);
    });

    press("ArrowDown");
    expect(view.scrollTop).toBe(0);
    press("End");
    expect(view.scrollTop).toBe(54);
    press("Home");
    expect(view.scrollTop).toBe(4);
    pointer("pointermove", item("C"));
    expect(view.scrollTop).toBe(4);
    press("ArrowDown");
    expect(highlighted()).toBe("D");
    expect(view.scrollTop).toBe(24);
    expect(document.documentElement.scrollTop).toBe(0);
  });
});

describe("dismissal", () => {
  it.each([true, false])("closes on a press outside without cancelling it (bubbles %s)", (b) => {
    const pressed = vi.fn();
    outside.addEventListener("pointerdown", pressed);
    open(entries("A"));
    const event = pointer("pointerdown", outside, b);
    expect(menu()).toBeNull();
    expect(contextMenu.value).toBeNull();
    expect(pressed).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(false);
  });

  it.each<[string, boolean, () => EventTarget, () => Event]>([
    ["mousedown outside", false, () => outside, () => mouse("mousedown", 1, 1)],
    ["click outside", false, () => outside, () => mouse("click", 1, 1)],
    ["contextmenu outside", true, () => outside, () => mouse("contextmenu", 1, 1)],
    ["wheel outside", false, () => outside, () => new WheelEvent("wheel", { bubbles: true })],
    ["scroll of the document", true, () => document, () => new Event("scroll", { bubbles: true })],
    ["scroll of an element outside", true, () => outside, scroll],
    ["scroll of the window itself", true, () => window, scroll],
    ["scroll of the menu", false, () => menu()!, scroll],
    ["scroll inside the menu", false, () => item("A"), scroll],
    ["resize", true, () => window, () => new Event("resize")],
    ["window blur", true, () => window, () => new FocusEvent("blur")],
    ["visibilitychange", false, () => document, () => new Event("visibilitychange")],
    [
      "Escape elsewhere",
      false,
      () => outside,
      () => new KeyboardEvent("keydown", { key: "Escape", bubbles: true })
    ]
  ])("on %s, closes: %s", (_name, closes, target, event) => {
    const errors = vi.fn();
    window.addEventListener("error", errors);
    open(entries("A"));
    dispatch(target(), event());
    window.removeEventListener("error", errors);
    expect(errors).not.toHaveBeenCalled();
    expect(menu() === null).toBe(closes);
    expect(contextMenu.value === null).toBe(closes);
  });

  it("stays open when focus moves elsewhere", () => {
    open(entries("A"));
    press("ArrowDown");
    dispatch(menu()!, new FocusEvent("focusout", { bubbles: true, relatedTarget: outside }));
    act(() => outside.focus());
    expect(menu()).not.toBeNull();
    expect(highlighted()).toBe("A");
  });

  it("closes when a dialog opens", () => {
    open(entries("A"));
    act(() => openContentDialog("x", "y"));
    expect(menu()).toBeNull();
    expect(container.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("keeps one set of window and document listeners while a menu is shown", () => {
    const listeners: Array<{ on: string; type: string; listener: unknown; capture: boolean }> = [];
    const track = (on: string, target: EventTarget) => {
      const add = target.addEventListener.bind(target);
      const remove = target.removeEventListener.bind(target);
      vi.spyOn(target, "addEventListener").mockImplementation((type, listener, options) => {
        listeners.push({ on, type, listener, capture: usesCapture(options) });
        add(type, listener, options);
      });
      vi.spyOn(target, "removeEventListener").mockImplementation((type, listener, options) => {
        const index = listeners.findIndex(
          (entry) =>
            entry.on === on &&
            entry.type === type &&
            entry.listener === listener &&
            entry.capture === usesCapture(options)
        );
        if (index >= 0) {
          listeners.splice(index, 1);
        }
        remove(type, listener, options);
      });
    };
    track("document", document);
    track("window", window);
    const shown = () =>
      listeners
        .map(({ on, type, capture }) => `${on} ${type}${capture ? " capture" : ""}`)
        .toSorted();
    const set = [
      "document contextmenu capture",
      "document pointerdown capture",
      "window blur",
      "window resize",
      "window scroll capture"
    ];

    open(entries("A"));
    expect(shown()).toEqual(set);
    const first = new Set(listeners.map((entry) => entry.listener));
    open(entries("B"), { source: "other" });
    expect(shown()).toEqual(set);
    expect(listeners.some((entry) => first.has(entry.listener))).toBe(false);
    act(() => closeContextMenu());
    expect(listeners).toEqual([]);

    open(entries("C"));
    expect(shown()).toEqual(set);
    act(() => render(null, container));
    expect(listeners).toEqual([]);
  });

  it("leaves the store alone once unmounted", () => {
    const shown = open(entries("A"));
    act(() => render(null, container));
    expect(() =>
      act(() => {
        window.dispatchEvent(new Event("resize"));
        window.dispatchEvent(new FocusEvent("blur"));
        document.body.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        document.dispatchEvent(new Event("scroll", { bubbles: true }));
      })
    ).not.toThrow();
    expect(contextMenu.value).toBe(shown);
  });
});

describe("opening and replacing", () => {
  it.each(["click", "contextmenu"] as const)("stays open after the %s that opened it", (type) => {
    const button = opener(type, "trigger", "A");
    act(() => {
      button.dispatchEvent(mouse(type, 40, 40));
    });
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(contextMenu.value?.source).toBe("trigger");
    act(() => button.click());
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    button.remove();
  });

  it("reopens at the pointer when its trigger is pressed again", () => {
    const button = opener("click", "trigger", "A");
    dispatch(button, mouse("click", 100, 100));
    expect(placed()).toEqual([98, 98]);
    pointer("pointerdown", button);
    expect(menu()).toBeNull();
    dispatch(button, mouse("click", 105, 101));
    expect(placed()).toEqual([103, 99]);
    button.remove();
  });

  it("replaces the menu when another element opens its own", () => {
    const first = opener("contextmenu", "row:1", "one");
    const second = opener("contextmenu", "row:2", "two");
    dispatch(first, mouse("contextmenu", 10, 10));
    press("ArrowDown");
    dispatch(second, mouse("contextmenu", 20, 20));
    expect(document.querySelectorAll('[role="menu"]')).toHaveLength(1);
    expect(contextMenu.value?.source).toBe("row:2");
    expect(rows()).toEqual(["two"]);
    expect(document.activeElement).toBe(menu());
    expect(highlighted()).toBeNull();
    first.remove();
    second.remove();
  });

  it("starts every new state afresh, even for the same source and anchor", () => {
    open(entries("A", "B", "C"), { source: "same", x: 30, y: 30 });
    press("ArrowDown");
    press("ArrowDown");
    const before = new Set(items().map((element) => element.id));
    act(() => outside.focus());

    open(entries("X", "Y", "Z"), { source: "same", x: 30, y: 30 });
    expect(highlighted()).toBeNull();
    expect(document.activeElement).toBe(menu());
    expect(items().some((element) => before.has(element.id))).toBe(false);
    expect(placed()).toEqual([28, 28]);

    press("End");
    open(entries("A"), { source: "same", x: 30, y: 30 });
    expect(highlighted()).toBeNull();
    expect(press("Enter").defaultPrevented).toBe(false);
    expect(chosen).toEqual([]);

    open(entries("A", "B"), { source: "same", x: 31, y: 30 });
    expect(highlighted()).toBeNull();
  });

  it("changes nothing when the same state is set again", () => {
    const shown = open(entries("A", "B"));
    press("ArrowDown");
    const element = menu();
    act(() => {
      contextMenu.value = shown;
    });
    expect(menu()).toBe(element);
    expect(highlighted()).toBe("A");
  });
});
