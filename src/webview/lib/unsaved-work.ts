import { signal } from "@preact/signals";
import { useLayoutEffect } from "preact/hooks";

/** Whether the open dialog holds work that closing it would lose. */
const unsaved = signal(false);

/** Whether closing the open dialog now would throw away something the user did in it. */
export function holdsUnsavedWork(): boolean {
  return unsaved.peek();
}

/**
 * Say, from inside a dialog, that it holds work while `dirty`: an edited message, a rearranged
 * plan. The dialog then asks before Escape, a click beside it or Close throws that away. Sending
 * the work, and whatever else replaces the dialog, never asks. One dialog shows at a time, so
 * one answer is all there is to keep.
 */
export function useUnsavedWork(dirty: boolean): void {
  // With the drawing itself, not after the next frame: a key pressed right after the one that
  // changed the work must already find it counted.
  useLayoutEffect(() => {
    unsaved.value = dirty;
    return () => {
      unsaved.value = false;
    };
  }, [dirty]);
}
