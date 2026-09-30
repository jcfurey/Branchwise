// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { NavigationEffects } from "@/webview/components/history/NavigationEffects";
import { DROPDOWN_PAGE, Dropdown, fitPanel } from "@/webview/components/ui/Dropdown";
import { focusSearch } from "@/webview/lib/focus";

import { setupWebviewTest } from "@tests/webview/test-utils";

vi.mock("@/webview/lib/focus", () => ({ focusSearch: vi.fn() }));

beforeAll(() => {
  setupWebviewTest();
  Element.prototype.scrollIntoView = () => {};
});
afterEach(() => vi.restoreAllMocks());

const box = (left: number, top: number, width: number, height: number) => ({
  left,
  top,
  right: left + width,
  bottom: top + height
});

describe("fitPanel", () => {
  it("keeps a panel wider than its trigger inside a narrow window", () => {
    // At 400 px, the Branch dropdown's panel reached 157 px past the left edge.
    const fit = fitPanel(box(60, 40, 100, 24), 300, 200, { width: 400, height: 800 });
    expect(60 + fit.left).toBe(8);
    expect(60 + fit.left + 300).toBeLessThanOrEqual(392);
    expect(fit.up).toBe(false);
  });

  it("stays right-aligned with its trigger where it fits", () => {
    const wide = fitPanel(box(250, 40, 100, 24), 300, 200, { width: 1200, height: 800 });
    expect(wide.left).toBe(-200);
    // A wide window keeps the usual limit, so a long name cannot widen the panel past its place.
    expect(wide.maxWidth).toBe(384);
    // A trigger at the right edge still leaves the margin.
    const fit = fitPanel(box(290, 40, 106, 24), 300, 200, { width: 400, height: 800 });
    expect(290 + fit.left + 300).toBe(392);
  });

  it("narrows a panel wider than the window", () => {
    const fit = fitPanel(box(10, 40, 100, 24), 380, 200, { width: 300, height: 800 });
    expect(fit.maxWidth).toBe(284);
    expect(10 + fit.left).toBe(8);
  });

  it("opens upwards when there is more room above the trigger", () => {
    expect(fitPanel(box(10, 680, 100, 24), 200, 288, { width: 800, height: 800 })).toMatchObject({
      up: true,
      maxHeight: 288
    });
    expect(fitPanel(box(10, 40, 100, 24), 200, 288, { width: 800, height: 800 })).toMatchObject({
      up: false,
      maxHeight: 288
    });
    // In a short window the panel scrolls within the larger side.
    expect(fitPanel(box(10, 120, 100, 24), 200, 288, { width: 800, height: 300 })).toMatchObject({
      up: false,
      maxHeight: 144
    });
  });
});

it("places the open panel inside the window and again after a resize", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const options = ["main", "a-very-long-branch-name-that-is-wider-than-the-trigger"].map(
    (name) => ({ label: name, value: name })
  );
  act(() =>
    render(h(Dropdown, { label: "Branch", options, value: "main", onChange: () => {} }), container)
  );
  const trigger = container.querySelector<HTMLButtonElement>("button[aria-haspopup]")!;
  let width = 400;
  let triggerLeft = 60;
  vi.spyOn(document.documentElement, "clientWidth", "get").mockImplementation(() => width);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const rect = this === trigger ? box(triggerLeft, 40, 100, 24) : box(0, 0, 300, 120);
    return { ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top } as DOMRect;
  });

  act(() => trigger.click());
  const panel = container.querySelector<HTMLElement>('[role="combobox"]')!.parentElement!;
  expect(panel.style.left).toBe("-52px");
  expect(panel.style.right).toBe("auto");
  expect(panel.style.maxWidth).toBe("384px");

  // A wider window moves the trigger right, where the panel lines up with it again.
  width = 1200;
  triggerLeft = 250;
  act(() => {
    window.dispatchEvent(new Event("resize"));
  });
  expect(panel.style.left).toBe("-200px");
  expect(panel.style.maxWidth).toBe("384px");
  act(() => render(null, container));
  container.remove();
});

it("places the panel again when the keyboard moves to another page", () => {
  const container = document.createElement("div");
  document.body.append(container);
  const options = Array.from({ length: 250 }, (_, index) => ({
    label: `branch-${index}`,
    value: `branch-${index}`
  }));
  act(() =>
    render(
      h(Dropdown, { label: "Branch", options, value: "branch-0", onChange: () => {} }),
      container
    )
  );
  const trigger = container.querySelector<HTMLButtonElement>("button[aria-haspopup]")!;
  let panelWidth = 200;
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1200);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    const rect = this === trigger ? box(600, 40, 100, 24) : box(0, 0, panelWidth, 120);
    return { ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top } as DOMRect;
  });

  act(() => trigger.click());
  const combobox = container.querySelector<HTMLElement>('[role="combobox"]')!;
  const panel = combobox.parentElement!;
  expect(panel.style.left).toBe("-100px");

  // The last page's names are longer, so its panel is wider and moves left to stay aligned.
  panelWidth = 380;
  act(() => {
    combobox.dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
  });
  expect(panel.style.left).toBe("-280px");
  act(() => render(null, container));
  container.remove();
});

/**
 * The trigger (left, top, right, bottom), the panel (width, height) and the window (width,
 * height), then the expected left, maxWidth, maxHeight and up.
 */
type FitRow = [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  boolean
];

describe("fitPanel table", () => {
  const rows: Array<FitRow> = [
    [250, 40, 350, 64, 300, 200, 1200, 800, -200, 384, 288, false],
    [250, 40, 350, 64, 80, 100, 1200, 800, 20, 384, 288, false],
    [60, 40, 160, 64, 300, 200, 400, 800, -52, 384, 288, false],
    [290, 40, 396, 64, 300, 200, 400, 800, -198, 384, 288, false],
    [350, 40, 450, 64, 200, 200, 400, 800, -158, 384, 288, false],
    [10, 40, 110, 64, 380, 200, 300, 800, -2, 284, 288, false],
    [700, 40, 800, 64, 500, 200, 1200, 800, -284, 384, 288, false],
    [0, 0, 10, 10, 100, 100, 10, 30, 8, 0, 8, false],
    [0, 0, 10, 10, 100, 100, 16, 100, 8, 0, 78, false],
    [10, 680, 110, 704, 200, 288, 800, 800, -2, 384, 288, true],
    [10, 40, 110, 64, 200, 288, 800, 800, -2, 384, 288, false],
    [10, 120, 110, 144, 200, 288, 800, 300, -2, 384, 144, false],
    [10, 200, 110, 224, 200, 288, 800, 300, -2, 384, 188, true],
    [10, 500, 110, 524, 200, 150, 800, 800, -2, 384, 264, false],
    [10, 388, 110, 412, 200, 500, 800, 800, -2, 384, 288, false],
    [10, 40, 110, 64, 200, 724, 800, 800, -2, 384, 288, false],
    [10, 900, 110, 924, 200, 100, 800, 800, -2, 384, 288, true],
    [10, -100, 110, -76, 200, 100, 800, 800, -2, 384, 288, false],
    [10, 5, 110, 25, 200, 100, 800, 35, -2, 384, 0, false],
    [10.5, 40.25, 110.75, 64.75, 150.5, 100.75, 500.5, 600.5, -2.5, 384, 288, false],
    [100, 40, 200, 64, 0, 0, 800, 800, 100, 384, 288, false]
  ];

  it.each(rows)(
    "fits a trigger at (%d, %d, %d, %d) and a %d × %d panel in a %d × %d window",
    (left, top, right, bottom, width, height, x, y, offset, maxWidth, maxHeight, up) => {
      const viewport = { width: x, height: y };
      expect(fitPanel({ left, top, right, bottom }, width, height, viewport)).toEqual({
        left: offset,
        maxWidth,
        maxHeight,
        up
      });
    }
  );
});

type Props = Parameters<typeof Dropdown>[0];

const same = (...labels: Array<string>) => labels.map((label) => ({ label, value: label }));
const branches = (count: number) =>
  same(...Array.from({ length: count }, (_, index) => `branch-${index}`));
const HEADER = [
  { label: "Show All", value: "*" },
  { label: "main", value: "main" },
  { label: "origin/x", value: "remotes/origin/x" }
];

const mounted: Array<HTMLElement> = [];
afterEach(() => {
  for (const container of mounted.splice(0)) {
    act(() => render(null, container));
    container.remove();
  }
});

/** The element that the `index`th id in `aria-labelledby` names. */
const labelOf = (element: Element, index = 0) =>
  document.getElementById(element.getAttribute("aria-labelledby")!.split(" ")[index]!);

function mount(props: Partial<Props> = {}) {
  const container = document.createElement("div");
  document.body.append(container);
  mounted.push(container);
  const onChange = vi.fn<(value: string) => void>();
  let current: Props = { label: "Branch", options: [], value: undefined, onChange, ...props };
  const update = (next: Partial<Props> = {}) => {
    current = { ...current, ...next };
    act(() => render(h(Dropdown, current), container));
  };
  update();
  const trigger = container.querySelector<HTMLButtonElement>("button[aria-haspopup]")!;
  const combobox = () => container.querySelector<HTMLInputElement>('[role="combobox"]');
  return {
    container,
    trigger,
    onChange,
    update,
    combobox,
    open: () => act(() => trigger.click()),
    rows: () => [...container.querySelectorAll("li")].map((item) => item.textContent),
    row: (label: string) =>
      [...container.querySelectorAll("li")].find((item) => item.textContent === label)!,
    active: () => container.querySelector<HTMLElement>('li[data-active="true"]')?.textContent,
    status: () => container.querySelector('[role="status"]')?.textContent ?? null,
    expanded: () => trigger.getAttribute("aria-expanded"),
    press: (key: string, init: KeyboardEventInit = {}, target: Element | null = combobox()) => {
      const event = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
      act(() => {
        target!.dispatchEvent(event);
      });
      return event;
    },
    type: (text: string) => {
      const input = combobox()!;
      act(() => {
        input.value = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
    }
  };
}

const pointer = (type: string, target: Element) =>
  act(() => {
    target.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true }));
  });

/** Records which elements `scrollIntoView` moves, and how. */
function watchScrolling() {
  const scrolled: Array<{ text: string | null; options: unknown }> = [];
  vi.spyOn(Element.prototype, "scrollIntoView").mockImplementation(function (
    this: Element,
    options?: boolean | ScrollIntoViewOptions
  ) {
    scrolled.push({ text: this.textContent, options });
  });
  return scrolled;
}

type ListenerCall = [string, unknown, (boolean | AddEventListenerOptions)?];
const capture = (options: ListenerCall[2]) =>
  typeof options === "boolean" ? options : options?.capture === true;

/** The document and window listeners added and not yet removed. */
function watchListeners() {
  type Call = ListenerCall;
  const targets = [
    ["document", document],
    ["window", window]
  ] as const;
  const spies = targets.map(([name, target]) => ({
    name,
    add: vi.spyOn(target, "addEventListener"),
    remove: vi.spyOn(target, "removeEventListener")
  }));
  return () =>
    spies.flatMap(({ name, add, remove }) => {
      const removed = [...(remove.mock.calls as Array<Call>)];
      return (add.mock.calls as Array<Call>)
        .filter(([type, listener, options]) => {
          const match = removed.findIndex(
            (call) =>
              call[0] === type && call[1] === listener && capture(call[2]) === capture(options)
          );
          if (match === -1) {
            return true;
          }
          removed.splice(match, 1);
          return false;
        })
        .map(([type, , options]) => `${name} ${type}${capture(options) ? " capture" : ""}`)
        .toSorted();
    });
}

const style = (panel: HTMLElement) => ({
  left: panel.style.left,
  right: panel.style.right,
  maxWidth: panel.style.maxWidth,
  maxHeight: panel.style.maxHeight,
  top: panel.style.top,
  bottom: panel.style.bottom,
  marginTop: panel.style.marginTop,
  marginBottom: panel.style.marginBottom
});
const BELOW = { top: "", bottom: "", marginTop: "", marginBottom: "" };

/** A 1000 × 800 window with the trigger at (600, 40, 700, 64). Everything else measures `panel`. */
function layout(trigger: HTMLElement) {
  const room = {
    trigger: box(600, 40, 100, 24),
    panel: { width: 200, height: 120 },
    measured: 0
  };
  vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1000);
  vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
  vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(function (this: Element) {
    room.measured += 1;
    const rect = this === trigger ? room.trigger : box(0, 0, room.panel.width, room.panel.height);
    return { ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top } as DOMRect;
  });
  return room;
}

describe("Dropdown trigger", () => {
  it("shows the chosen label, with its value as the tooltip", () => {
    const view = mount({ options: HEADER, value: "remotes/origin/x" });
    expect(view.trigger.textContent).toBe("origin/x");
    expect(view.trigger.title).toBe("remotes/origin/x");
    expect(labelOf(view.trigger, 0)?.textContent).toBe("Branch:");
    expect(labelOf(view.trigger, 1)?.textContent).toBe("origin/x");
  });

  it("stays blank for a value no option has", () => {
    const view = mount({ options: HEADER, value: "nope" });
    expect(view.trigger.textContent).toBe("");
    expect(view.trigger.title).toBe("");
    view.update({ value: "*" });
    expect(view.trigger.title).toBe("*");
    view.update({ value: undefined });
    expect(view.trigger.textContent).toBe("");
    expect(view.trigger.title).toBe("");
  });

  it("adds the caller's classes to the trigger", () => {
    const view = mount({ options: HEADER, class: "max-w-56" });
    expect(view.trigger.classList.contains("max-w-56")).toBe(true);
    expect(view.container.querySelector("button")).toBe(view.trigger);
  });

  it("reports the open state and the list it controls", () => {
    const view = mount({ options: same("a", "b", "c") });
    expect(view.expanded()).toBe("false");
    view.open();
    expect(view.expanded()).toBe("true");
    const list = view.container.querySelector('[role="listbox"]')!;
    expect(view.trigger.getAttribute("aria-controls")).toBe(list.id);
    expect(view.combobox()!.getAttribute("aria-controls")).toBe(list.id);
    expect(view.combobox()!.getAttribute("aria-autocomplete")).toBe("list");
    expect(labelOf(list)?.textContent).toBe("Branch:");
    view.press("Escape");
    expect(view.expanded()).toBe("false");
  });

  it("opens from ArrowDown or ArrowUp and ignores other keys", () => {
    const view = mount({ options: same("a1", "a2", "a3", "a4"), value: "a2" });
    expect(view.press("x", {}, view.trigger).defaultPrevented).toBe(false);
    expect(view.combobox()).toBeNull();
    for (const key of ["ArrowDown", "ArrowUp"]) {
      expect(view.press(key, {}, view.trigger).defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(view.combobox());
      expect(view.active()).toBe("a2");
      view.press("Escape");
      expect(view.combobox()).toBeNull();
    }
  });

  it("keeps the panel open when an arrow key reaches the trigger while open", () => {
    const view = mount({ options: same("a1", "a2", "a3", "a4"), value: "a2" });
    view.open();
    view.type("a");
    view.press("ArrowDown");
    for (const key of ["ArrowDown", "ArrowUp"]) {
      act(() => view.trigger.focus());
      expect(view.press(key, {}, view.trigger).defaultPrevented).toBe(true);
      expect(view.combobox()).not.toBeNull();
      expect(view.expanded()).toBe("true");
      expect(document.activeElement).toBe(view.combobox());
      expect(view.combobox()!.value).toBe("a");
      expect(view.active()).toBe("a2");
    }
  });

  it("closes when the trigger is clicked again and leaves focus on it", () => {
    const view = mount({ options: same("a1", "a2"), value: "a1" });
    view.open();
    expect(document.activeElement).toBe(view.combobox());
    view.open();
    expect(view.combobox()).toBeNull();
    expect(view.expanded()).toBe("false");
    expect(document.activeElement).toBe(view.trigger);
    expect(view.onChange).not.toHaveBeenCalled();
  });
});

describe("Dropdown when disabled", () => {
  it("ignores clicks and arrow keys, then and after it is enabled", () => {
    const view = mount({ options: same("d1", "d2", "d3"), value: "d1", disabled: true });
    expect(view.trigger.disabled).toBe(true);
    view.open();
    view.press("ArrowDown", {}, view.trigger);
    view.press("ArrowUp", {}, view.trigger);
    expect(view.combobox()).toBeNull();
    expect(view.expanded()).toBe("false");
    view.update({ disabled: false });
    expect(view.combobox()).toBeNull();
    expect(view.expanded()).toBe("false");
  });

  it("closes an open panel for good and removes its listeners", () => {
    const view = mount({ options: same("d1", "d2", "d3"), value: "d1" });
    const live = watchListeners();
    view.open();
    view.type("d");
    view.press("ArrowDown");
    expect(view.active()).toBe("d2");
    view.update({ disabled: true });
    expect(view.combobox()).toBeNull();
    expect(view.expanded()).toBe("false");
    expect(document.activeElement).toBe(document.body);
    expect(live()).toEqual([]);

    view.update({ disabled: false });
    expect(view.combobox()).toBeNull();
    expect(view.expanded()).toBe("false");
    expect(document.activeElement).toBe(document.body);
    expect(live()).toEqual([]);

    // The next opening starts afresh.
    view.open();
    expect(view.combobox()!.value).toBe("");
    expect(view.rows()).toEqual(["d1", "d2", "d3"]);
    expect(view.active()).toBe("d1");
    expect(view.onChange).not.toHaveBeenCalled();
  });
});

describe("Dropdown panel", () => {
  it("focuses the filter and reveals the chosen option on opening", () => {
    const scrolled = watchScrolling();
    const view = mount({ options: same("a1", "a2", "a3", "a4"), value: "a3" });
    view.open();
    expect(document.activeElement).toBe(view.combobox());
    expect(view.active()).toBe("a3");
    expect(scrolled).toEqual([{ text: "a3", options: { block: "nearest" } }]);
    const current = view.container.querySelector('li[data-active="true"]')!;
    expect(view.combobox()!.getAttribute("aria-activedescendant")).toBe(current.id);
  });

  it("starts on the first option when none is chosen", () => {
    const view = mount({ options: same("a1", "a2", "a3", "a4"), value: "zzz" });
    view.open();
    expect(view.active()).toBe("a1");
  });

  it("names the filter by the label and keeps the placeholder", () => {
    const view = mount({ options: same("a1") });
    view.open();
    expect(labelOf(view.combobox()!)?.textContent).toBe("Branch:");
    expect(view.combobox()!.getAttribute("aria-label")).toBeNull();
    expect(view.combobox()!.placeholder).toBe("filterPlaceholder");
  });

  it("marks the chosen option and gives each option its value as a title", () => {
    const view = mount({
      options: [
        { label: "aa", value: "remotes/aa" },
        { label: "ab", value: "ab" }
      ],
      value: "ab"
    });
    view.open();
    const [first, second] = view.container.querySelectorAll("li");
    expect(first!.title).toBe("remotes/aa");
    expect(first!.getAttribute("aria-selected")).toBe("false");
    expect(second!.hasAttribute("title")).toBe(false);
    expect(second!.getAttribute("aria-selected")).toBe("true");
    expect(first!.getAttribute("role")).toBe("option");
    expect(second!.getAttribute("role")).toBe("option");
    expect(first!.id).not.toBe("");
    expect(first!.id).not.toBe(second!.id);
  });

  it("filters labels by substring, ignoring case", () => {
    const view = mount({ options: same("alpha", "Beta", "gamma", "ALPHABET", "delta") });
    view.open();
    view.type("AL");
    expect(view.rows()).toEqual(["alpha", "ALPHABET"]);
    expect(view.active()).toBe("alpha");
    view.type("et");
    expect(view.rows()).toEqual(["Beta", "ALPHABET"]);
    expect(view.active()).toBe("Beta");
    view.type(" alpha");
    expect(view.rows()).toEqual([]);
    expect(view.combobox()!.nextElementSibling?.textContent).toBe("noResultsFound");
    view.type("");
    expect(view.rows()).toHaveLength(5);
    expect(view.active()).toBe("alpha");
  });

  it("does not search the values", () => {
    const view = mount({
      options: [
        { label: "aa", value: "remotes/aa" },
        { label: "ba", value: "remotes/ba" }
      ]
    });
    view.open();
    view.type("remotes");
    expect(view.rows()).toEqual([]);
  });

  it("holds nothing to choose when nothing matches", () => {
    const view = mount({ options: same("a1", "a2"), value: "a1" });
    view.open();
    view.type("zzz");
    for (const key of ["Enter", "ArrowDown", "ArrowUp", "Home", "End"]) {
      expect(view.press(key).defaultPrevented).toBe(true);
    }
    expect(view.container.querySelector('[role="listbox"]')).toBeNull();
    expect(view.combobox()!.hasAttribute("aria-activedescendant")).toBe(false);
    expect(view.combobox()).not.toBeNull();
    expect(view.onChange).not.toHaveBeenCalled();
    // The matches come back with the first one active.
    view.type("a");
    expect(view.active()).toBe("a1");
  });

  it("empties the filter each time it opens", () => {
    const view = mount({ options: same("x1", "x2", "y1", "y2"), value: "y1" });
    view.open();
    view.type("x");
    view.press("ArrowDown");
    expect(view.rows()).toEqual(["x1", "x2"]);
    expect(view.active()).toBe("x2");
    view.open();
    view.open();
    expect(view.combobox()!.value).toBe("");
    expect(view.rows()).toHaveLength(4);
    expect(view.active()).toBe("y1");
  });

  it("wraps with the arrow keys and jumps with Home and End", () => {
    const view = mount({ options: same("a1", "a2", "a3", "a4"), value: "a2" });
    view.open();
    const keys = ["ArrowDown", "ArrowDown", "ArrowDown", "ArrowUp", "Home", "ArrowUp", "End"];
    const seen = keys.map((key) => {
      expect(view.press(key).defaultPrevented).toBe(true);
      return view.active();
    });
    expect(seen).toEqual(["a3", "a4", "a1", "a4", "a1", "a4", "a4"]);
  });

  it("leaves the page keys and text editing keys alone", () => {
    const view = mount({ options: same("a1", "a2", "a3"), value: "a2" });
    view.open();
    for (const key of ["PageDown", "PageUp", "ArrowLeft", " "]) {
      expect(view.press(key).defaultPrevented).toBe(false);
      expect(view.active()).toBe("a2");
    }
    expect(view.combobox()).not.toBeNull();
  });

  it("chooses the active option with Enter, after focus is back on the trigger", () => {
    const view = mount({ options: same("a1", "a2", "a3", "a4"), value: "a2" });
    let focused: Element | null = null;
    view.onChange.mockImplementation(() => {
      focused = document.activeElement;
    });
    view.open();
    view.press("ArrowDown");
    expect(view.press("Enter").defaultPrevented).toBe(true);
    expect(view.onChange).toHaveBeenCalledOnce();
    expect(view.onChange).toHaveBeenCalledWith("a3");
    expect(focused).toBe(view.trigger);
    expect(view.combobox()).toBeNull();
    expect(document.activeElement).toBe(view.trigger);
    // The parent did not take the choice.
    expect(view.trigger.textContent).toBe("a2");
  });

  it("closes without a call when the chosen option is chosen again", () => {
    const view = mount({ options: same("a1", "a2", "a3", "a4"), value: "a2" });
    view.open();
    view.press("Enter");
    expect(view.combobox()).toBeNull();
    view.open();
    act(() => view.row("a2").click());
    expect(view.combobox()).toBeNull();
    expect(view.onChange).not.toHaveBeenCalled();
  });

  it("closes with Escape and returns focus to the trigger", () => {
    const view = mount({ options: same("a1", "a2"), value: "a1" });
    view.open();
    view.type("a");
    expect(view.press("Escape").defaultPrevented).toBe(true);
    expect(view.combobox()).toBeNull();
    expect(document.activeElement).toBe(view.trigger);
    expect(view.onChange).not.toHaveBeenCalled();
  });

  it("closes with Tab and lets the browser move focus", () => {
    const view = mount({ options: same("a1", "a2"), value: "a1" });
    for (const shiftKey of [false, true]) {
      view.open();
      expect(view.press("Tab", { shiftKey }).defaultPrevented).toBe(false);
      expect(view.combobox()).toBeNull();
      expect(document.activeElement).not.toBe(view.trigger);
    }
    expect(view.onChange).not.toHaveBeenCalled();
  });

  it("highlights the option under the pointer without scrolling to it", () => {
    const scrolled = watchScrolling();
    const view = mount({ options: same("p1", "p2", "p3"), value: "p1" });
    view.open();
    scrolled.length = 0;
    pointer("pointermove", view.row("p3"));
    expect(view.active()).toBe("p3");
    expect(view.combobox()!.getAttribute("aria-activedescendant")).toBe(view.row("p3").id);
    expect(scrolled).toEqual([]);
    act(() => {
      view.row("p2").dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    });
    expect(view.active()).toBe("p3");
    // The keyboard still scrolls.
    view.press("ArrowUp");
    expect(scrolled).toEqual([{ text: "p2", options: { block: "nearest" } }]);
  });

  it("chooses a clicked option", () => {
    const view = mount({ options: same("p1", "p2", "p3"), value: "p1" });
    view.open();
    act(() => view.row("p3").click());
    expect(view.onChange).toHaveBeenCalledWith("p3");
    expect(view.combobox()).toBeNull();
    expect(document.activeElement).toBe(view.trigger);
  });

  it("closes on a press outside, even a stopped one, but not on one inside", () => {
    const view = mount({ options: same("p1", "p2", "p3"), value: "p1" });
    const outside = document.createElement("button");
    document.body.append(outside);
    view.open();
    pointer("pointerdown", labelOf(view.trigger)!);
    pointer("pointerdown", view.row("p2"));
    pointer("pointerdown", view.combobox()!);
    pointer("pointerdown", view.trigger);
    expect(view.combobox()).not.toBeNull();
    pointer("pointerdown", outside);
    expect(view.combobox()).toBeNull();
    expect(document.activeElement).not.toBe(view.trigger);

    view.open();
    outside.addEventListener("pointerdown", (event) => event.stopPropagation());
    pointer("pointerdown", outside);
    expect(view.combobox()).toBeNull();

    // Neither a click without a press nor focus leaving closes it.
    view.open();
    act(() => {
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      outside.click();
      outside.focus();
      window.dispatchEvent(new Event("blur"));
    });
    expect(view.combobox()).not.toBeNull();
    expect(view.onChange).not.toHaveBeenCalled();
    outside.remove();
  });

  it("keeps the active position when the options change while open", () => {
    const view = mount({ options: same("o1", "o2", "o3", "o4"), value: "o4" });
    view.open();
    expect(view.active()).toBe("o4");
    view.update({ options: same("o1", "o2") });
    expect(view.active()).toBe("o2");
    const current = view.container.querySelector('li[data-active="true"]')!;
    expect(view.combobox()!.getAttribute("aria-activedescendant")).toBe(current.id);
    view.update({ options: same("o1", "o2", "o3", "o4") });
    expect(view.active()).toBe("o4");
    view.update({ value: "o1" });
    expect(view.active()).toBe("o4");
    expect(view.row("o1").getAttribute("aria-selected")).toBe("true");
    expect(view.row("o4").getAttribute("aria-selected")).toBe("false");
  });

  it("holds only the listeners it needs while open", () => {
    const live = watchListeners();
    const view = mount({ options: same("a1", "a2") });
    expect(live()).toEqual([]);
    view.open();
    expect(live()).toEqual(["document pointerdown capture", "window resize"]);
    view.press("Escape");
    expect(live()).toEqual([]);
    view.open();
    expect(live()).toEqual(["document pointerdown capture", "window resize"]);
    act(() => render(null, view.container));
    expect(live()).toEqual([]);
  });

  it("gives each instance its own ids and lets one press move to another", () => {
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    const props = { options: same("a1", "a2"), value: "a1", onChange: () => {} };
    act(() =>
      render(
        h(
          "div",
          null,
          h(Dropdown, { ...props, label: "Branch" }),
          h(Dropdown, { ...props, label: "View" })
        ),
        container
      )
    );
    const [first, second] = container.querySelectorAll<HTMLButtonElement>("button[aria-haspopup]");
    const ids = [first!, second!].flatMap((trigger) =>
      ["aria-labelledby", "aria-controls"].flatMap((name) => trigger.getAttribute(name)!.split(" "))
    );
    expect(new Set(ids).size).toBe(6);

    act(() => first!.click());
    pointer("pointerdown", second!);
    act(() => second!.click());
    expect(container.querySelectorAll('[role="combobox"]')).toHaveLength(1);
    expect(second!.getAttribute("aria-expanded")).toBe("true");
    expect(first!.getAttribute("aria-expanded")).toBe("false");
  });

  it("lets / reach the filter instead of opening history search", () => {
    const container = document.createElement("div");
    document.body.append(container);
    mounted.push(container);
    vi.mocked(focusSearch).mockClear();
    const dropdown = h(Dropdown, {
      label: "Branch",
      options: same("a/b"),
      value: undefined,
      onChange: () => {}
    });
    act(() => render(h("div", null, h(NavigationEffects, {}), dropdown), container));
    act(() => container.querySelector("button")!.click());
    const slash = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    act(() => {
      container.querySelector('[role="combobox"]')!.dispatchEvent(slash);
    });
    expect(slash.defaultPrevented).toBe(false);
    expect(focusSearch).not.toHaveBeenCalled();
    expect(container.querySelector('[role="combobox"]')).not.toBeNull();
  });
});

describe("Dropdown placement", () => {
  it("places the panel as the matches change, not as the active option moves", () => {
    const view = mount({ options: branches(20), value: "branch-0" });
    const room = layout(view.trigger);
    view.open();
    const panel = view.combobox()!.parentElement!;
    expect(style(panel)).toEqual({
      left: "-100px",
      right: "auto",
      maxWidth: "384px",
      maxHeight: "288px",
      ...BELOW
    });

    room.panel.width = 360;
    view.press("ArrowDown");
    expect(panel.style.left).toBe("-100px");

    room.panel.width = 300;
    view.type("branch-1");
    expect(panel.style.left).toBe("-200px");
    room.panel.width = 360;
    view.type("branch-2");
    expect(panel.style.left).toBe("-260px");

    const measured = room.measured;
    act(() => {
      window.dispatchEvent(new Event("scroll"));
    });
    expect(room.measured).toBe(measured);
  });

  it("opens above the trigger when there is no room below, and back below later", () => {
    const view = mount({ options: branches(20), value: "branch-0" });
    const room = layout(view.trigger);
    room.trigger = box(600, 700, 100, 24);
    room.panel.height = 288;
    view.open();
    const panel = view.combobox()!.parentElement!;
    expect(style(panel)).toEqual({
      left: "-100px",
      right: "auto",
      maxWidth: "384px",
      maxHeight: "288px",
      top: "auto",
      bottom: "100%",
      marginTop: "0px",
      marginBottom: "4px"
    });

    room.trigger = box(600, 40, 100, 24);
    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(style(panel)).toEqual({
      left: "-100px",
      right: "auto",
      maxWidth: "384px",
      maxHeight: "288px",
      ...BELOW
    });
  });

  it("places the panel again when the filter or the options change at the same count", () => {
    const view = mount({ options: same("aa", "ab", "ba", "bb") });
    const room = layout(view.trigger);
    view.open();
    const panel = view.combobox()!.parentElement!;
    room.panel.width = 100;
    view.type("a");
    expect(view.rows()).toHaveLength(3);
    expect(panel.style.left).toBe("0px");

    room.panel.width = 150;
    view.type("b");
    expect(view.rows()).toHaveLength(3);
    expect(panel.style.left).toBe("-50px");

    room.panel.width = 180;
    view.update({ options: same("ab-long", "ba-long", "bb-long", "cc") });
    expect(view.rows()).toHaveLength(3);
    expect(panel.style.left).toBe("-80px");
  });
});

const useStrings = (l10n: typeof window.l10n) =>
  Object.defineProperty(window, "l10n", { value: l10n, configurable: true });

describe("Dropdown with English strings", () => {
  const HINT = "Type to narrow the list, or use the arrow keys.";
  const ENGLISH: Record<string, string> = {
    filterPlaceholder: "{0}: type to filter…",
    noResultsFound: "Nothing matches this filter.",
    dropdownPage: `{0}–{1} of {2}. ${HINT}`
  };
  let echo: typeof window.l10n;
  beforeEach(() => {
    echo = window.l10n;
    useStrings(
      new Proxy({}, { get: (_target, key) => ENGLISH[String(key)] ?? String(key) }) as typeof echo
    );
  });
  afterEach(() => useStrings(echo));

  it("puts the label in the filter's placeholder", () => {
    const view = mount({ options: same("a1") });
    view.open();
    expect(view.combobox()!.placeholder).toBe("Branch: type to filter…");
    view.type("zzz");
    expect(view.combobox()!.nextElementSibling?.textContent).toBe("Nothing matches this filter.");
  });

  it("renders the block of DROPDOWN_PAGE options that holds the active one", () => {
    const scrolled = watchScrolling();
    const view = mount({ options: branches(450), value: "branch-230" });
    const state = () => {
      const rows = view.rows();
      return { rows: rows.length, first: rows[0], active: view.active(), status: view.status() };
    };
    view.open();
    expect(DROPDOWN_PAGE).toBe(200);
    expect(scrolled).toEqual([{ text: "branch-230", options: { block: "nearest" } }]);
    expect(state()).toEqual({
      rows: 200,
      first: "branch-200",
      active: "branch-230",
      status: `201–400 of 450. ${HINT}`
    });
    expect(view.rows().at(-1)).toBe("branch-399");

    const first = { rows: 200, first: "branch-0", status: `1–200 of 450. ${HINT}` };
    const last = { rows: 50, first: "branch-400", status: `401–450 of 450. ${HINT}` };
    view.press("Home");
    expect(state()).toEqual({ ...first, active: "branch-0" });
    view.press("ArrowUp");
    expect(state()).toEqual({ ...last, active: "branch-449" });
    view.press("ArrowDown");
    expect(state()).toEqual({ ...first, active: "branch-0" });
    view.press("End");
    view.press("ArrowUp");
    expect(state()).toEqual({ ...last, active: "branch-448" });
    view.press("Home");
    for (let step = 0; step < 199; step++) {
      view.press("ArrowDown");
    }
    expect(state()).toEqual({ ...first, active: "branch-199" });
    view.press("ArrowDown");
    expect(state()).toEqual({
      rows: 200,
      first: "branch-200",
      active: "branch-200",
      status: `201–400 of 450. ${HINT}`
    });
    view.press("ArrowUp");
    expect(state()).toEqual({ ...first, active: "branch-199" });

    view.type("branch-1");
    expect(state()).toEqual({ rows: 111, first: "branch-1", active: "branch-1", status: null });
    view.type("branch-44");
    expect(state()).toEqual({ rows: 11, first: "branch-44", active: "branch-44", status: null });
    pointer("pointermove", view.container.querySelectorAll("li")[5]!);
    expect(view.active()).toBe("branch-444");
  });

  it("shows the status line only above DROPDOWN_PAGE matches", () => {
    const exact = mount({ options: branches(200) });
    exact.open();
    expect(exact.rows()).toHaveLength(200);
    expect(exact.status()).toBeNull();
    exact.press("ArrowUp");
    expect(exact.active()).toBe("branch-199");
    expect(exact.rows()[0]).toBe("branch-0");
    exact.press("Escape");

    const over = mount({ options: branches(201) });
    over.open();
    expect(over.rows()).toHaveLength(200);
    expect(over.status()).toBe(`1–200 of 201. ${HINT}`);
    over.press("ArrowUp");
    expect(over.rows()).toEqual(["branch-200"]);
    expect(over.status()).toBe(`201–201 of 201. ${HINT}`);
  });

  it("returns to the first block when the filter changes", () => {
    const view = mount({ options: branches(450) });
    view.open();
    view.press("End");
    view.type("branch-1");
    expect(view.rows()).toHaveLength(111);
    expect(view.active()).toBe("branch-1");
    expect(view.status()).toBeNull();
  });

  it("keeps a filtered list of thousands to one page", () => {
    const view = mount({ options: branches(10_000), value: "branch-0" });
    view.open();
    view.type("branch-1");
    expect(view.rows()).toHaveLength(DROPDOWN_PAGE);
    expect(view.active()).toBe("branch-1");
    expect(view.status()).toBe(`1–200 of 1111. ${HINT}`);
  });
});
