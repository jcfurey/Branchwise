import { signal } from "@preact/signals";

/** The latest message, numbered so that the same words said twice are heard twice. */
const message = signal<{ text: string; serial: number } | null>(null);

/** Have a screen reader say `text` politely, without showing anything or moving focus. */
export function announce(text: string): void {
  message.value = { text, serial: (message.peek()?.serial ?? 0) + 1 };
}

/**
 * The page's polite live region. It stays mounted, so that assistive technology is already
 * watching it when a message arrives; each message replaces the last one as a new node.
 */
export function Announcer() {
  const current = message.value;
  return (
    <div role="status" aria-live="polite" data-announcer class="sr-only">
      {current !== null && <span key={current.serial}>{current.text}</span>}
    </div>
  );
}
