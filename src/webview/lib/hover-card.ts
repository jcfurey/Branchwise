import { effect, signal } from "@preact/signals";
import type { RefObject } from "preact";
import { useEffect } from "preact/hooks";

import { UNCOMMITTED_CHANGES } from "@/webview/constants";
import { contextMenu, dialog } from "@/webview/lib/stores";
import { getWebviewConfig } from "@/webview/lib/webview-config";

/** How long the pointer or the keyboard must rest on a commit before its card shows, in ms. */
export const HOVER_CARD_DELAY = 600;

/** Space kept between the card and the edges of the window, in pixels. */
const EDGE = 8;

/** Space between the card and what it stands beside, in pixels. */
const GAP = 4;

/** Room left under the pointer for its arrow, so that the card starts below it. */
const POINTER_HEIGHT = 18;

/** A box on screen, in pixels from the top left of the window. */
export type Box = { left: number; top: number; right: number; bottom: number };

/** What brought a card up: the pointer resting on a message, or the keyboard resting on a row. */
export type CardSource = "pointer" | "keyboard";

/** The card on screen: the commit it describes and the box it stands beside. */
export type HoverCardState = { hash: string; anchor: Box; source: CardSource };

/** The card on screen, or `null`. */
export const hoverCard = signal<HoverCardState | null>(null);

/** The card that shows once the timer fires, if nothing stops it first. */
let waiting: { hash: string; source: CardSource; timer: ReturnType<typeof setTimeout> } | null =
  null;

/** Whether a card may show now: the setting is on and no menu or dialog is open. */
function allowed() {
  return (
    getWebviewConfig().commitHoverCards && contextMenu.peek() === null && dialog.peek() === null
  );
}

/**
 * Show the card of `hash` after `HOVER_CARD_DELAY`, beside the box `anchor` gives then, unless
 * something hides it first. Asking again for the card already shown or on its way changes nothing,
 * so a pointer moving over one message does not start the wait again.
 */
export function showHoverCardSoon(hash: string, source: CardSource, anchor: () => Box | null) {
  const shown = hoverCard.peek();
  if (
    (shown?.hash === hash && shown.source === source) ||
    (waiting?.hash === hash && waiting.source === source)
  ) {
    return;
  }
  hideHoverCard();
  if (!allowed()) {
    return;
  }
  const timer = setTimeout(() => {
    waiting = null;
    const box = anchor();
    if (box !== null && allowed()) {
      hoverCard.value = { hash, anchor: box, source };
    }
  }, HOVER_CARD_DELAY);
  waiting = { hash, source, timer };
}

/** Hide the card and stop the one on its way, or only those `source` brought up. */
export function hideHoverCard(source?: CardSource): void {
  if (waiting !== null && (source === undefined || waiting.source === source)) {
    clearTimeout(waiting.timer);
    waiting = null;
  }
  const shown = hoverCard.peek();
  if (shown !== null && (source === undefined || shown.source === source)) {
    hoverCard.value = null;
  }
}

/**
 * Where a card `size` big goes beside `anchor` in a window `viewport` big. It starts below the
 * anchor at its left edge; it goes above instead when it does not fit below and there is more
 * room above, and ends at the anchor's right edge when it does not fit to the right. Then it
 * moves just enough to stay `EDGE` pixels inside the window, the top left winning when the card
 * is bigger than the window.
 */
export function placeCard(
  anchor: Box,
  size: { width: number; height: number },
  viewport: { width: number; height: number }
): { left: number; top: number; above: boolean; before: boolean } {
  const below = viewport.height - EDGE - (anchor.bottom + GAP);
  const overhead = anchor.top - GAP - EDGE;
  const above = size.height > below && overhead > below;
  const before =
    anchor.left + size.width > viewport.width - EDGE && anchor.right - size.width >= EDGE;
  const top = above ? anchor.top - GAP - size.height : anchor.bottom + GAP;
  const left = before ? anchor.right - size.width : anchor.left;
  return {
    left: Math.max(EDGE, Math.min(left, viewport.width - EDGE - size.width)),
    top: Math.max(EDGE, Math.min(top, viewport.height - EDGE - size.height)),
    above,
    before
  };
}

/** The box beside which a pointer's card goes: the pointer's arrow. */
export function pointerBox(x: number, y: number): Box {
  return { left: x, top: y, right: x, bottom: y + POINTER_HEIGHT };
}

/** The box beside which a row's card goes: its message, or the row when it has none. */
export function rowBox(row: HTMLElement): Box {
  const own = row.getBoundingClientRect();
  const message = row.querySelector("[data-commit-message]")?.getBoundingClientRect() ?? own;
  return { left: message.left, top: own.top, right: message.right, bottom: own.bottom };
}

/** The commit row `element` is, or is in, or `null` for the uncommitted changes and the rest. */
function commitRow(element: EventTarget | null) {
  const row =
    element instanceof Element ? element.closest<HTMLElement>("tr[data-commit-hash]") : null;
  const hash = row?.dataset["commitHash"];
  return row === null || hash === undefined || hash === UNCOMMITTED_CHANGES ? null : { row, hash };
}

/**
 * Bring up commit cards from the rows inside `container`: after the pointer rests on a message,
 * or after a key moves the focus to a row and nothing else is pressed. A card goes when the
 * pointer leaves the message or the focus the row, on any key, press, scroll or resize, and
 * when a menu or dialog opens or the setting is turned off.
 */
export function useHoverCards(container: RefObject<HTMLElement>): void {
  useEffect(() => {
    const element = container.current;
    if (element === null) {
      return;
    }
    let pointer = { x: 0, y: 0 };
    const onOver = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
      const target = event.target instanceof Element ? event.target : null;
      const found = commitRow(target?.closest("[data-commit-message]") ?? null);
      if (found === null) {
        hideHoverCard("pointer");
      } else {
        showHoverCardSoon(found.hash, "pointer", () => pointerBox(pointer.x, pointer.y));
      }
    };
    const onMove = (event: MouseEvent) => {
      pointer = { x: event.clientX, y: event.clientY };
    };
    const onLeave = () => hideHoverCard("pointer");
    const onFocusOut = (event: FocusEvent) => {
      if (commitRow(event.target)?.row === event.target) {
        hideHoverCard("keyboard");
      }
    };
    const onKey = (event: KeyboardEvent) => {
      const before = document.activeElement;
      hideHoverCard();
      if (event.key === "Escape") {
        return;
      }
      // Once the row has handled the key, a key that moved the focus to a row starts its wait.
      setTimeout(() => {
        const now = document.activeElement;
        const found = now === before ? null : commitRow(now);
        if (found !== null && found.row === now && element.contains(now)) {
          showHoverCardSoon(found.hash, "keyboard", () =>
            found.row.isConnected ? rowBox(found.row) : null
          );
        }
      });
    };
    const onScroll = () => {
      // The keyboard's wait goes on: a key that moves to a row out of sight scrolls to it.
      hideHoverCard("pointer");
      if (hoverCard.peek() !== null) {
        hideHoverCard();
      }
    };
    const hideAll = () => hideHoverCard();
    element.addEventListener("mouseover", onOver);
    element.addEventListener("mousemove", onMove);
    element.addEventListener("mouseleave", onLeave);
    element.addEventListener("focusout", onFocusOut);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", hideAll, true);
    window.addEventListener("mousedown", hideAll, true);
    window.addEventListener("scroll", onScroll, { capture: true, passive: true });
    window.addEventListener("resize", hideAll);
    window.addEventListener("blur", hideAll);
    // A menu or dialog opening, or the setting going off, takes the card away.
    const stopWatching = effect(() => {
      if (
        contextMenu.value !== null ||
        dialog.value !== null ||
        !getWebviewConfig().commitHoverCards
      ) {
        hideHoverCard();
      }
    });
    return () => {
      element.removeEventListener("mouseover", onOver);
      element.removeEventListener("mousemove", onMove);
      element.removeEventListener("mouseleave", onLeave);
      element.removeEventListener("focusout", onFocusOut);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", hideAll, true);
      window.removeEventListener("mousedown", hideAll, true);
      window.removeEventListener("scroll", onScroll, { capture: true });
      window.removeEventListener("resize", hideAll);
      window.removeEventListener("blur", hideAll);
      stopWatching();
      hideHoverCard();
    };
  }, []);
}
