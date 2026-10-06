import type { LocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import { contextMenu, dialog } from "@/webview/lib/stores";
import { getWebviewConfig } from "@/webview/lib/webview-config";

/*
 * Every keyboard shortcut of the page, in one table. The commit row and the page run their single
 * keys from it, menus show its keys beside their entries, and the shortcut sheet lists all of it,
 * so none of the three can disagree with the others.
 */

export type ShortcutGroup = "navigation" | "commit" | "search" | "panels";

/** The groups in the order the sheet shows them. */
export const SHORTCUT_GROUPS: ReadonlyArray<ShortcutGroup> = [
  "navigation",
  "commit",
  "search",
  "panels"
];

/**
 * A key as `KeyboardEvent.key` names it. A letter is written in lower case and matched in either
 * case, with Shift alone telling `y` from `Y`, so Caps Lock changes nothing. `mod` is Ctrl, or
 * Cmd on macOS.
 */
export type KeyCombo = Readonly<{ key: string; shift?: boolean; mod?: boolean; alt?: boolean }>;

type Shortcut = Readonly<{
  id: string;
  group: ShortcutGroup;
  /** Each of these does it. */
  keys: ReadonlyArray<KeyCombo>;
  /** What it does, in the sheet's words. */
  label: (l10n: LocalizedStrings) => string;
  /**
   * Where this table runs it: on the focused commit row, or anywhere on the page outside a text
   * field. Both are single keys, which the `singleKeyShortcuts` setting turns off. The rest are
   * handled where they always were, and only listed here.
   */
  scope?: "row" | "page";
}>;

/** A menu title for an entry that asks for more before it acts, as the menus write it. */
const more = (title: string) => title + "…";

/** A single key that acts on the focused commit row. */
function rowKey<const Id extends string>(id: Id, key: KeyCombo, label: Shortcut["label"]) {
  return { id, group: "commit", keys: [key], label, scope: "row" } as const;
}

export const SHORTCUTS = [
  {
    id: "move",
    group: "navigation",
    keys: [{ key: "ArrowUp" }, { key: "ArrowDown" }],
    label: (l10n) => l10n.shortcutMove
  },
  {
    id: "firstLast",
    group: "navigation",
    keys: [{ key: "Home" }, { key: "End" }],
    label: (l10n) => l10n.shortcutFirstLast
  },
  {
    id: "extendSelection",
    group: "navigation",
    keys: [
      { key: "ArrowUp", shift: true },
      { key: "ArrowDown", shift: true }
    ],
    label: (l10n) => l10n.shortcutExtendSelection
  },
  { id: "select", group: "navigation", keys: [{ key: " " }], label: (l10n) => l10n.shortcutSelect },
  {
    id: "goTo",
    group: "navigation",
    // Contributed to VS Code in package.json, so it works wherever the graph has focus.
    keys: [{ key: "g", mod: true, alt: true }],
    label: (l10n) => l10n.goTo
  },

  rowKey("checkout", { key: "c" }, (l10n) => more(l10n.checkout)),
  rowKey("createBranch", { key: "b" }, (l10n) => more(l10n.createBranch)),
  rowKey("addTag", { key: "t" }, (l10n) => more(l10n.addTag)),
  rowKey("cherryPick", { key: "p" }, (l10n) => more(l10n.cherryPick)),
  rowKey("revert", { key: "v" }, (l10n) => more(l10n.revert)),
  rowKey("rebase", { key: "r" }, (l10n) => more(l10n.rebaseOnto)),
  rowKey("interactiveRebase", { key: "i" }, (l10n) => more(l10n.interactiveRebase)),
  rowKey("merge", { key: "m" }, (l10n) => more(l10n.merge)),
  rowKey("reset", { key: "x" }, (l10n) => more(l10n.reset)),
  rowKey("editMessage", { key: "e" }, (l10n) => more(l10n.editMessage)),
  rowKey("copyShortId", { key: "y" }, (l10n) => l10n.copyShortCommitHash),
  rowKey("copyFullId", { key: "y", shift: true }, (l10n) => l10n.copyCommitHash),
  rowKey("openOnHost", { key: "o" }, (l10n) => l10n.shortcutOpenOnHost),
  rowKey("toggleDetails", { key: "d" }, (l10n) => l10n.shortcutDetails),

  {
    id: "search",
    group: "search",
    keys: [{ key: "f", mod: true }, { key: "/" }],
    label: (l10n) => l10n.historySearch
  },

  {
    id: "details",
    group: "panels",
    keys: [{ key: "Enter" }],
    label: (l10n) => l10n.shortcutDetails
  },
  { id: "close", group: "panels", keys: [{ key: "Escape" }], label: (l10n) => l10n.shortcutClose },
  {
    id: "menu",
    group: "panels",
    keys: [{ key: "F10", shift: true }, { key: "ContextMenu" }],
    label: (l10n) => l10n.shortcutMenu
  },
  {
    id: "shortcutSheet",
    group: "panels",
    keys: [{ key: "?" }],
    label: (l10n) => l10n.shortcutSheet,
    scope: "page"
  }
] as const satisfies ReadonlyArray<Shortcut>;

export type ShortcutEntry = (typeof SHORTCUTS)[number];
export type ShortcutId = ShortcutEntry["id"];
/** The single keys of the commit row. */
export type RowShortcutId = Extract<ShortcutEntry, { scope: "row" }>["id"];

export function shortcut(id: ShortcutId): ShortcutEntry {
  return SHORTCUTS.find((entry) => entry.id === id)!;
}

/** Whether the page runs on macOS, where Cmd stands in for Ctrl and keys are drawn as symbols. */
function onMac() {
  return /Mac|iPhone|iPad/.test(navigator.userAgent);
}

const LETTER = /^[a-z]$/;

/**
 * Whether `event` is `combo`. Shift counts for letters and named keys only: a symbol such as `?`
 * needs Shift on one keyboard layout and not on another, so its own name is enough.
 */
export function keyMatches(combo: KeyCombo, event: KeyboardEvent): boolean {
  const letter = LETTER.test(combo.key);
  if ((letter ? event.key.toLowerCase() : event.key) !== combo.key) {
    return false;
  }
  const symbol = !letter && combo.key.length === 1 && combo.key !== " ";
  if (!symbol && event.shiftKey !== (combo.shift ?? false)) {
    return false;
  }
  // Either Ctrl or Cmd counts as `mod`, as it always has for Ctrl/Cmd+F.
  return (
    (event.ctrlKey || event.metaKey) === (combo.mod ?? false) &&
    event.altKey === (combo.alt ?? false)
  );
}

/** Whether the user leaves single keys on. */
export function singleKeysOn(): boolean {
  return getWebviewConfig().singleKeyShortcuts;
}

/**
 * Whether a single key pressed now belongs to text or to another control: inside a field, a
 * dialog or a menu, or while an input method is composing a character.
 */
function typing(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229 || dialog.value || contextMenu.value) {
    return true;
  }
  const target = event.target;
  return (
    target instanceof Element &&
    target.closest(
      'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="menu"]'
    ) !== null
  );
}

/**
 * The single-key shortcut of `scope` that `event` presses, if the setting allows it and the key
 * is not meant for text or for an open dialog or menu.
 */
export function shortcutFor<const Scope extends "row" | "page">(
  event: KeyboardEvent,
  scope: Scope
): Extract<ShortcutEntry, { scope: Scope }> | null {
  if (!singleKeysOn() || typing(event)) {
    return null;
  }
  const found = SHORTCUTS.find(
    (entry) =>
      "scope" in entry &&
      entry.scope === scope &&
      entry.keys.some((combo: KeyCombo) => keyMatches(combo, event))
  );
  return (found as Extract<ShortcutEntry, { scope: Scope }> | undefined) ?? null;
}

const KEY_NAMES: Record<string, string> = {
  ArrowUp: "↑",
  ArrowDown: "↓",
  " ": "Space",
  ContextMenu: "Menu"
};

/** A key as VS Code draws it: `Ctrl+Shift+Y` elsewhere, `⌥⌘G` on macOS. */
export function keyLabel(combo: KeyCombo): string {
  const name =
    KEY_NAMES[combo.key] ?? (LETTER.test(combo.key) ? combo.key.toUpperCase() : combo.key);
  if (onMac()) {
    return (combo.alt ? "⌥" : "") + (combo.shift ? "⇧" : "") + (combo.mod ? "⌘" : "") + name;
  }
  const parts = [combo.mod && "Ctrl", combo.alt && "Alt", combo.shift && "Shift", name];
  return parts.filter(Boolean).join("+");
}

/** A key as `aria-keyshortcuts` names it, such as `Shift+Y` or `Control+F`. */
function ariaKey(combo: KeyCombo) {
  const name =
    combo.key === " " ? "Space" : LETTER.test(combo.key) ? combo.key.toUpperCase() : combo.key;
  const parts = [
    combo.mod && (onMac() ? "Meta" : "Control"),
    combo.alt && "Alt",
    combo.shift && "Shift",
    name
  ];
  return parts.filter(Boolean).join("+");
}

/** Every key of `entry` for `aria-keyshortcuts`, which takes alternatives separated by spaces. */
export function ariaKeys(entry: ShortcutEntry): string {
  return entry.keys.map(ariaKey).join(" ");
}

/**
 * What a menu entry shows for `id`: its key, and the same for assistive technology. Nothing when
 * single keys are off, as they would not work.
 */
export function menuHint(id: ShortcutId): { label: string; aria: string } | null {
  const entry = shortcut(id);
  if ("scope" in entry && !singleKeysOn()) {
    return null;
  }
  return { label: entry.keys.map(keyLabel).join(" "), aria: ariaKeys(entry) };
}
