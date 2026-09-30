import { useLayoutEffect, useRef, useState } from "preact/hooks";

import { closeContextMenu } from "@/webview/lib/actions";
import { contextMenu } from "@/webview/lib/stores";
import type { ContextMenuEntry, ContextMenuState } from "@/webview/types";

type Item = NonNullable<ContextMenuEntry>;

/** A row of the menu: an item with its position among the items, or `null` for a separator. */
type Row = { item: Item; index: number } | null;

/** How far inside the menu's corner the anchor lies, so the pointer rests on the menu's frame. */
const ANCHOR_INSET = 2;

const MENU_CLASS = [
  "fixed z-20 w-max max-w-[calc(100vw-1rem)] max-h-[calc(100vh-1rem)] overflow-auto py-1",
  "rounded-md border border-line bg-menu text-menu-fg shadow-md outline-none"
].join(" ");
const ITEM_CLASS = "cursor-pointer px-5 py-1.5 break-words";
const SEPARATOR_CLASS = "mx-2.5 my-1 border-t border-line";

/**
 * Where a menu `size` long starts on one axis of a window `limit` long. It opens after the
 * anchor where it fits, before it otherwise, and then moves just enough to stay inside the window.
 */
function place(anchor: number, size: number, limit: number) {
  const start = anchor + size < limit ? anchor - ANCHOR_INSET : anchor + ANCHOR_INSET - size;
  return Math.max(0, Math.min(start, limit - size));
}

/**
 * The rows to draw. Separators at either end are dropped and a run of them is drawn as one, so a
 * menu built from optional groups never shows a stray line.
 */
function rowsOf(entries: Array<ContextMenuEntry>) {
  const items: Array<Item> = [];
  const rows: Array<Row> = [];
  for (const entry of entries) {
    if (entry === null) {
      if (rows.length > 0 && rows.at(-1) !== null) {
        rows.push(null);
      }
      continue;
    }
    rows.push({ item: entry, index: items.length });
    items.push(entry);
  }
  if (rows.at(-1) === null) {
    rows.pop();
  }
  return { items, rows };
}

/**
 * Scroll the menu by the least amount that shows `item` whole. Only the menu moves: a scroll of
 * anything around it would close it.
 */
function reveal(menu: HTMLElement, item: HTMLElement) {
  const top = menu.getBoundingClientRect().top + menu.clientTop;
  const bottom = top + menu.clientHeight;
  const box = item.getBoundingClientRect();
  if (box.top < top) {
    menu.scrollTop -= top - box.top;
  } else if (box.bottom > bottom) {
    menu.scrollTop += box.bottom - bottom;
  }
}

/**
 * Run an item's action once the menu has closed, so an action that opens a dialog or another menu
 * takes over from this one and keeps the control to return focus to.
 */
function choose(item: Item) {
  closeContextMenu();
  item.onClick();
}

/** A number per menu state shown. It tells one menu from the next and keeps item ids unique. */
const serials = new WeakMap<ContextMenuState, number>();
let lastSerial = 0;

function serialOf(state: ContextMenuState) {
  let serial = serials.get(state);
  if (serial === undefined) {
    serial = ++lastSerial;
    serials.set(state, serial);
  }
  return serial;
}

function Menu({ state, serial }: { state: ContextMenuState; serial: number }) {
  const menuRef = useRef<HTMLDivElement>(null);
  // A menu shows one state for its whole life; a new state mounts a new menu.
  const [{ items, rows }] = useState(() => rowsOf(state.entries));
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const [active, setActive] = useState<number | null>(null);
  // Handlers read the highlight here, as events may follow each other before a render.
  const activeRef = useRef<number | null>(null);

  const itemId = (index: number) => `context-menu-${serial}-${index}`;

  // Measure and place the menu before the browser paints it, then take the keyboard.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) {
      return;
    }
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      left: place(state.x, width, window.innerWidth),
      top: place(state.y, height, window.innerHeight)
    });
    menu.focus({ preventScroll: true });
  }, []);

  // Anything the user does elsewhere dismisses the menu. Scroll events do not bubble, and a press
  // may stop its own propagation, so both are seen on the way down.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null) {
      return;
    }
    const onOutside = (event: Event) => {
      if (!(event.target instanceof Node && menu.contains(event.target))) {
        closeContextMenu();
      }
    };
    const onWindow = () => closeContextMenu();

    document.addEventListener("pointerdown", onOutside, true);
    document.addEventListener("contextmenu", onOutside, true);
    window.addEventListener("scroll", onOutside, true);
    window.addEventListener("resize", onWindow);
    window.addEventListener("blur", onWindow);
    return () => {
      document.removeEventListener("pointerdown", onOutside, true);
      document.removeEventListener("contextmenu", onOutside, true);
      window.removeEventListener("scroll", onOutside, true);
      window.removeEventListener("resize", onWindow);
      window.removeEventListener("blur", onWindow);
    };
  }, []);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (menu === null || active === null) {
      return;
    }
    const item = menu.querySelectorAll<HTMLElement>('[role="menuitem"]')[active];
    if (item !== undefined) {
      reveal(menu, item);
    }
  }, [active]);

  /** Highlight the item at `index`. A menu without items keeps its highlight empty. */
  function highlight(index: number) {
    if (index < 0 || index >= items.length) {
      return;
    }
    activeRef.current = index;
    setActive(index);
  }

  /** A held key repeats its keydown. Only a fresh Enter or Space chooses the highlighted item. */
  function activate(event: KeyboardEvent) {
    if (event.repeat) {
      event.preventDefault();
      return;
    }
    const item = activeRef.current === null ? undefined : items[activeRef.current];
    if (item !== undefined) {
      event.preventDefault();
      choose(item);
    }
  }

  function onKeyDown(event: KeyboardEvent) {
    const current = activeRef.current;
    const last = items.length - 1;
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        highlight(current === null || current === last ? 0 : current + 1);
        break;
      case "ArrowUp":
        event.preventDefault();
        highlight(current === null || current === 0 ? last : current - 1);
        break;
      case "Home":
        event.preventDefault();
        highlight(0);
        break;
      case "End":
        event.preventDefault();
        highlight(last);
        break;
      case " ":
        // Space would otherwise scroll the page behind the menu, and that scroll closes it.
        event.preventDefault();
        activate(event);
        break;
      case "Enter":
        activate(event);
        break;
      case "Escape":
      case "Tab":
        event.preventDefault();
        closeContextMenu();
        break;
    }
  }

  return (
    <div
      ref={menuRef}
      role="menu"
      tabIndex={-1}
      aria-activedescendant={active === null ? undefined : itemId(active)}
      class={MENU_CLASS}
      // Until it is placed, the menu is measured where it cannot be seen.
      style={
        position === null
          ? { left: "0px", top: "0px", opacity: 0 }
          : { left: `${position.left}px`, top: `${position.top}px` }
      }
      onKeyDown={onKeyDown}
      // The host's own menu would open on top of this one.
      onContextMenu={(event) => event.preventDefault()}
    >
      {rows.map((row, order) =>
        row === null ? (
          <div key={order} role="separator" class={SEPARATOR_CLASS} />
        ) : (
          <div
            key={order}
            id={itemId(row.index)}
            role="menuitem"
            class={
              row.index === active ? `${ITEM_CLASS} bg-menu-active text-menu-active-fg` : ITEM_CLASS
            }
            onPointerMove={() => highlight(row.index)}
            onClick={() => choose(row.item)}
          >
            {row.item.title}
          </div>
        )
      )}
    </div>
  );
}

/** The open context menu, if any. Callers open one by setting the store through the actions. */
export function ContextMenu() {
  const state = contextMenu.value;
  if (state === null) {
    return null;
  }

  const serial = serialOf(state);
  return <Menu key={serial} state={state} serial={serial} />;
}
