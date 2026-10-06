// @vitest-environment jsdom
import { Fragment, h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import type { GitCommitNode, GitRef } from "@/backend/types";
import { NavigationEffects } from "@/webview/components/history/NavigationEffects";
import { ContextMenu } from "@/webview/components/ui/ContextMenu";
import { ShortcutSheet } from "@/webview/components/ui/ShortcutSheet";
import { commitMenu, refMenu } from "@/webview/lib/menus";
import {
  ariaKeys,
  keyLabel,
  keyMatches,
  menuHint,
  SHORTCUT_GROUPS,
  shortcut,
  shortcutFor,
  SHORTCUTS
} from "@/webview/lib/shortcuts";
import { contextMenu, dialog, selectedRepo } from "@/webview/lib/stores";
import type { ContextMenuEntry } from "@/webview/types";

import { reconfigure } from "@tests/webview/components/commit/commit-view-fixtures";
import { setupWebviewTest } from "@tests/webview/test-utils";

const H = "d".repeat(40);
const COMMIT: GitCommitNode = {
  hash: H,
  parentHashes: ["e".repeat(40)],
  author: "Robin Doe",
  email: "robin@example.net",
  date: 0,
  message: "Tidy the parser",
  refs: []
};
const FEATURE: GitRef = { type: "head", name: "feature", hash: H };

let host: HTMLDivElement;

function keydown(key: string, init: KeyboardEventInit = {}) {
  return new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
}

/** Dispatch `event` on `target` and return what `shortcutFor` made of it there. */
function lookUp(target: Element, event: KeyboardEvent, scope: "row" | "page" = "row") {
  let found: ReturnType<typeof shortcutFor> = null;
  const listen = (seen: Event) => {
    found = shortcutFor(seen as KeyboardEvent, scope);
  };
  target.addEventListener("keydown", listen);
  target.dispatchEvent(event);
  target.removeEventListener("keydown", listen);
  return found as ReturnType<typeof shortcutFor>;
}

beforeAll(() => setupWebviewTest());

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  dialog.value = null;
  contextMenu.value = null;
  selectedRepo.value = "/work/sheet";
});

afterEach(() => {
  act(() => render(null, host));
  host.remove();
  dialog.value = null;
  contextMenu.value = null;
  vi.restoreAllMocks();
});

describe("the table", () => {
  it("gives every key to one shortcut only", () => {
    const combos = SHORTCUTS.flatMap((entry) => entry.keys.map((combo) => JSON.stringify(combo)));
    expect(new Set(combos).size).toBe(combos.length);
    expect(new Set(SHORTCUTS.map((entry) => entry.id)).size).toBe(SHORTCUTS.length);
  });

  it("puts every shortcut in a group the sheet shows", () => {
    for (const entry of SHORTCUTS) {
      expect(SHORTCUT_GROUPS).toContain(entry.group);
    }
  });

  it("names the single keys of the row, without modifiers but Shift", () => {
    const row = SHORTCUTS.filter((entry) => "scope" in entry && entry.scope === "row");
    expect(row.map((entry) => keyLabel(entry.keys[0]!))).toEqual([
      "C",
      "B",
      "T",
      "P",
      "V",
      "R",
      "I",
      "M",
      "X",
      "E",
      "Y",
      "Shift+Y",
      "O",
      "D"
    ]);
    for (const entry of row) {
      for (const combo of entry.keys) {
        expect(combo).not.toHaveProperty("mod");
        expect(combo).not.toHaveProperty("alt");
      }
    }
  });

  it("lists the keys that work without it", () => {
    const listed = (id: Parameters<typeof shortcut>[0]) => shortcut(id).keys.map(keyLabel);
    expect(listed("move")).toEqual(["↑", "↓"]);
    expect(listed("firstLast")).toEqual(["Home", "End"]);
    expect(listed("select")).toEqual(["Space"]);
    expect(listed("details")).toEqual(["Enter"]);
    expect(listed("close")).toEqual(["Escape"]);
    expect(listed("menu")).toEqual(["Shift+F10", "Menu"]);
    expect(listed("search")).toEqual(["Ctrl+F", "/"]);
    expect(listed("goTo")).toEqual(["Ctrl+Alt+G"]);
    expect(listed("shortcutSheet")).toEqual(["?"]);
  });

  it("draws keys the macOS way on a Mac", () => {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (Macintosh)");
    expect(shortcut("search").keys.map(keyLabel)).toEqual(["⌘F", "/"]);
    expect(keyLabel(shortcut("goTo").keys[0]!)).toBe("⌥⌘G");
    expect(keyLabel(shortcut("copyFullId").keys[0]!)).toBe("⇧Y");
    expect(ariaKeys(shortcut("search"))).toBe("Meta+F /");
  });

  it("names keys for assistive technology", () => {
    expect(ariaKeys(shortcut("checkout"))).toBe("C");
    expect(ariaKeys(shortcut("copyFullId"))).toBe("Shift+Y");
    expect(ariaKeys(shortcut("search"))).toBe("Control+F /");
    expect(ariaKeys(shortcut("menu"))).toBe("Shift+F10 ContextMenu");
    expect(ariaKeys(shortcut("select"))).toBe("Space");
  });
});

describe("matching a key", () => {
  const y = shortcut("copyShortId").keys[0]!;
  const shiftY = shortcut("copyFullId").keys[0]!;
  const sheet = shortcut("shortcutSheet").keys[0]!;

  it("tells a letter from its shifted form by Shift alone", () => {
    expect(keyMatches(y, keydown("y"))).toBe(true);
    expect(keyMatches(y, keydown("Y"))).toBe(true);
    expect(keyMatches(y, keydown("Y", { shiftKey: true }))).toBe(false);
    expect(keyMatches(shiftY, keydown("Y", { shiftKey: true }))).toBe(true);
    expect(keyMatches(shiftY, keydown("y"))).toBe(false);
  });

  it("takes a symbol with or without Shift, as keyboard layouts differ", () => {
    expect(keyMatches(sheet, keydown("?", { shiftKey: true }))).toBe(true);
    expect(keyMatches(sheet, keydown("?"))).toBe(true);
    expect(keyMatches(sheet, keydown("/", { shiftKey: true }))).toBe(false);
  });

  it("leaves keys with Ctrl, Cmd or Alt to VS Code", () => {
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }]) {
      expect(keyMatches(y, keydown("y", init))).toBe(false);
    }
    const find = shortcut("search").keys[0]!;
    expect(keyMatches(find, keydown("f", { ctrlKey: true }))).toBe(true);
    expect(keyMatches(find, keydown("f", { metaKey: true }))).toBe(true);
    expect(keyMatches(find, keydown("f"))).toBe(false);
  });
});

describe("where single keys are ignored", () => {
  it.each([
    ["an input", () => document.createElement("input")],
    ["a text area", () => document.createElement("textarea")],
    ["a select", () => document.createElement("select")],
    [
      "an editable element",
      () => {
        const element = document.createElement("div");
        element.setAttribute("contenteditable", "true");
        return element;
      }
    ],
    [
      "a dialog",
      () => {
        const element = document.createElement("div");
        element.setAttribute("role", "dialog");
        element.append(document.createElement("button"));
        return element;
      }
    ],
    [
      "a menu",
      () => {
        const element = document.createElement("div");
        element.setAttribute("role", "menu");
        return element;
      }
    ]
  ])("in %s", (_name, make) => {
    const element = make();
    host.append(element);
    const target = element.querySelector("button") ?? element;
    expect(lookUp(target, keydown("b"))).toBeNull();
    expect(lookUp(target, keydown("?"), "page")).toBeNull();
    // The same key elsewhere is a shortcut.
    expect(lookUp(host, keydown("b"))?.id).toBe("createBranch");
  });

  it("while composing with an input method", () => {
    expect(lookUp(host, keydown("b", { isComposing: true }))).toBeNull();
    expect(lookUp(host, keydown("Process", { keyCode: 229 }))).toBeNull();
  });

  it("while a dialog or menu is open, wherever focus is", () => {
    dialog.value = { kind: "error", message: "x", reason: null, token: 1 };
    expect(lookUp(host, keydown("b"))).toBeNull();
    dialog.value = null;
    contextMenu.value = { x: 0, y: 0, entries: [], source: "x" };
    expect(lookUp(host, keydown("b"))).toBeNull();
  });

  it("when the setting is off", () => {
    const restore = reconfigure({ singleKeyShortcuts: false });
    try {
      expect(lookUp(host, keydown("b"))).toBeNull();
      expect(lookUp(host, keydown("?"), "page")).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("menu hints", () => {
  function showMenu(entries: Array<ContextMenuEntry>) {
    act(() => render(h(ContextMenu, null), host));
    act(() => {
      contextMenu.value = { x: 0, y: 0, entries, source: "test" };
    });
    return [...host.querySelectorAll<HTMLElement>('[role="menuitem"]')];
  }

  /** Each item's title, with its key and `aria-keyshortcuts` where it has them. */
  function hints(items: Array<HTMLElement>) {
    return items.map((item) => [
      item.textContent,
      item.querySelector("[data-shortcut]")?.getAttribute("data-shortcut") ?? null,
      item.getAttribute("aria-keyshortcuts")
    ]);
  }

  it("show each commit menu entry's key, muted, keeping the item's text its title", () => {
    const items = showMenu(commitMenu(COMMIT, new Map()));
    expect(hints(items)).toEqual([
      ["addTag…", "T", "T"],
      ["createBranch…", "B", "B"],
      ["checkout…", "C", "C"],
      ["cherryPick…", "P", "P"],
      ["revert…", "V", "V"],
      ["merge…", "M", "M"],
      ["reset…", "X", "X"],
      ["interactiveRebase…", "I", "I"],
      ["createFixupMenu…", null, null],
      ["compareWith", null, null],
      ["bisectChooseGood", null, null],
      ["bisectChooseBad", null, null],
      ["copyCommitHash", "Shift+Y", "Shift+Y"],
      ["copyShortCommitHash", "Y", "Y"]
    ]);
    const key = items[0]!.querySelector("[data-shortcut]")!;
    expect(key.getAttribute("aria-hidden")).toBe("true");
    expect(key.className).toContain("opacity-70");
    expect(key.className).toContain("after:content-[attr(data-shortcut)]");
  });

  it("show the keys of a branch's menu that the row runs for its branch", () => {
    const items = showMenu(refMenu(FEATURE, false));
    const keyed = hints(items).filter(([, key]) => key !== null);
    expect(keyed).toEqual([
      ["rebaseOnto…", "R", "R"],
      ["merge…", "M", "M"]
    ]);
  });

  it("are left out when single keys are off", () => {
    const restore = reconfigure({ singleKeyShortcuts: false });
    try {
      expect(menuHint("checkout")).toBeNull();
      const items = showMenu(commitMenu(COMMIT, new Map()));
      expect(items.some((item) => item.hasAttribute("aria-keyshortcuts"))).toBe(false);
      expect(host.querySelector("[data-shortcut]")).toBeNull();
    } finally {
      restore();
    }
  });
});

describe("the shortcut sheet", () => {
  function drawSheet() {
    act(() => render(h(ShortcutSheet, null), host));
    return host.querySelector<HTMLElement>("[data-shortcut-sheet]")!;
  }

  it("lists every entry of the table, in its group, in the table's order", () => {
    const sheet = drawSheet();
    const groups = [...sheet.querySelectorAll<HTMLElement>("[data-shortcut-group]")];
    expect(groups.map((group) => group.dataset["shortcutGroup"])).toEqual([...SHORTCUT_GROUPS]);
    expect(groups.map((group) => group.querySelector("h3")?.textContent)).toEqual([
      "shortcutGroupNavigation",
      "shortcutGroupCommit",
      "searchSubmit",
      "shortcutGroupPanels"
    ]);
    for (const group of groups) {
      const ids = [...group.querySelectorAll<HTMLElement>("[data-shortcut-id]")].map(
        (row) => row.dataset["shortcutId"]
      );
      expect(ids).toEqual(
        SHORTCUTS.filter((entry) => entry.group === group.dataset["shortcutGroup"]).map(
          (entry) => entry.id
        )
      );
    }
    expect(sheet.querySelectorAll("[data-shortcut-id]")).toHaveLength(SHORTCUTS.length);
  });

  it("shows each entry's keys and what it does", () => {
    const sheet = drawSheet();
    for (const entry of SHORTCUTS) {
      const row = sheet.querySelector(`[data-shortcut-id="${entry.id}"]`)!;
      const keys = [...row.querySelectorAll("kbd")].map((key) => key.textContent);
      expect(keys).toEqual(entry.keys.map(keyLabel));
      expect(row.lastElementChild?.textContent).toBe(entry.label(window.l10n));
    }
    expect(sheet.querySelector('[data-shortcut-id="checkout"]')?.textContent).toBe("Ccheckout…");
    // Keys stay apart when read as text.
    expect(sheet.querySelector('[data-shortcut-id="menu"] td')?.textContent).toBe("Shift+F10 Menu");
  });

  it("says when single keys are off, and still lists them", () => {
    expect(drawSheet().querySelector('[role="note"]')).toBeNull();
    const restore = reconfigure({ singleKeyShortcuts: false });
    try {
      const sheet = drawSheet();
      expect(sheet.querySelector('[role="note"]')?.textContent).toBe("shortcutsOff");
      expect(sheet.querySelectorAll("[data-shortcut-id]")).toHaveLength(SHORTCUTS.length);
    } finally {
      restore();
    }
  });
});

describe("? on the page", () => {
  function mountEffects() {
    act(() => render(h(Fragment, null, h(NavigationEffects, null)), host));
  }

  function press(target: Element, key: string, init: KeyboardEventInit = {}) {
    const event = keydown(key, init);
    act(() => {
      target.dispatchEvent(event);
    });
    return event.defaultPrevented;
  }

  it("opens the sheet from anywhere outside a field", () => {
    mountEffects();
    const button = document.createElement("button");
    host.append(button);
    expect(press(button, "?", { shiftKey: true })).toBe(true);
    expect(dialog.value).toMatchObject({ kind: "content", message: "keyboardShortcuts" });
  });

  it("is typed into the search box and dialog fields instead", () => {
    mountEffects();
    const input = document.createElement("input");
    host.append(input);
    expect(press(input, "?")).toBe(false);
    expect(dialog.value).toBeNull();
  });

  it("does nothing while a dialog is open or when single keys are off", () => {
    mountEffects();
    dialog.value = { kind: "error", message: "x", reason: null, token: 1 };
    expect(press(host, "?")).toBe(false);
    expect(dialog.value?.kind).toBe("error");
    dialog.value = null;
    const restore = reconfigure({ singleKeyShortcuts: false });
    try {
      expect(press(host, "?")).toBe(false);
      expect(dialog.value).toBeNull();
    } finally {
      restore();
    }
  });
});
