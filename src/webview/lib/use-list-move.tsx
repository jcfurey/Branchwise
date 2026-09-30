import { useCallback, useLayoutEffect, useRef, useState } from "preact/hooks";

/**
 * Moves entries of an ordered list of commits one place at a time. Moving re-orders the rows, which
 * takes keyboard focus away from the button that was pressed, so focus returns to the moved entry's
 * button and a live region announces the entry's new position.
 */
export function useListMove<T extends { hash: string }>(
  entries: T[],
  setEntries: (entries: T[]) => void
) {
  const container = useRef<HTMLElement | null>(null);
  /** A ref for the element that holds the rows. */
  const root = useCallback((element: HTMLElement | null) => {
    container.current = element;
  }, []);
  const moved = useRef<{ hash: string; direction: "earlier" | "later" } | null>(null);
  const [announcement, setAnnouncement] = useState("");

  useLayoutEffect(() => {
    const target = moved.current;
    moved.current = null;
    const row = target && container.current?.querySelector(`[data-entry="${target.hash}"]`);
    if (!target || !row) {
      return;
    }
    const buttons = [...row.querySelectorAll<HTMLButtonElement>("button[data-move]")];
    // At the first or last place the pressed button is disabled, so the other one takes focus.
    (
      buttons.find((button) => button.dataset["move"] === target.direction && !button.disabled) ??
      buttons.find((button) => !button.disabled)
    )?.focus();
  }, [entries]);

  function move(index: number, delta: -1 | 1) {
    const entry = entries[index];
    const other = entries[index + delta];
    if (entry === undefined || other === undefined) {
      return;
    }
    const next = [...entries];
    next[index] = other;
    next[index + delta] = entry;
    moved.current = { hash: entry.hash, direction: delta < 0 ? "earlier" : "later" };
    setEntries(next);
    setAnnouncement(
      window.l10n.movedEntry
        .replace("{0}", entry.hash.slice(0, 8))
        .replace("{1}", String(index + delta + 1))
        .replace("{2}", String(entries.length))
    );
  }

  return {
    root,
    move,
    /** Render once inside the list's container. */
    status: (
      <p role="status" class="sr-only">
        {announcement}
      </p>
    )
  };
}

/** Attributes for an entry's Move Earlier or Move Later button, named with the entry's commit. */
export function moveButton(hash: string, direction: "earlier" | "later") {
  const label = direction === "earlier" ? window.l10n.moveEarlier : window.l10n.moveLater;
  return { "data-move": direction, "aria-label": `${label} ${hash.slice(0, 8)}` };
}
