import { signal } from "@preact/signals";

/** The latest message, numbered so that the same words said twice are heard twice. */
const message = signal<{ text: string; serial: number } | null>(null);

/** The notice on show, by the serial of its message, and the timer that takes it down. */
const shown = signal<number | null>(null);
let hiding: ReturnType<typeof setTimeout> | undefined;

/** How long a notice stays on show, in milliseconds. */
export const NOTICE_FOR = 2000;

/** Have a screen reader say `text` politely, without showing anything or moving focus. */
export function announce(text: string): void {
  message.value = { text, serial: (message.peek()?.serial ?? 0) + 1 };
}

/**
 * Say `text` as `announce` does, and show it for a moment at the foot of the page: for something
 * done that leaves nothing else to see, such as a copy from a menu. It takes no click and no
 * keyboard, and a newer notice takes its place.
 */
export function notify(text: string): void {
  announce(text);
  shown.value = message.peek()!.serial;
  clearTimeout(hiding);
  hiding = setTimeout(() => {
    shown.value = null;
  }, NOTICE_FOR);
}

/**
 * The page's polite live region, and the notice shown with it. The region stays mounted, so
 * that assistive technology is already watching it when a message arrives; each message replaces
 * the last one as a new node. The notice repeats the words for the eye only.
 */
export function Announcer() {
  const current = message.value;
  const notice = current !== null && shown.value === current.serial ? current.text : null;
  return (
    <>
      <div role="status" aria-live="polite" data-announcer class="sr-only">
        {current !== null && <span key={current.serial}>{current.text}</span>}
      </div>
      {notice !== null && (
        <div
          aria-hidden="true"
          data-notice
          class="pointer-events-none fixed bottom-6 left-1/2 z-50 -translate-x-1/2 rounded-md border border-line bg-menu px-3 py-1.5 text-ui text-menu-fg shadow-dialog"
        >
          {notice}
        </div>
      )}
    </>
  );
}
