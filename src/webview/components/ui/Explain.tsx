import type { ComponentChildren } from "preact";

/** One muted sentence under a dialog message: what will happen, and how to undo it. */
export function Explain({ children }: { children: ComponentChildren }) {
  return <span class="mt-2 block text-xs text-muted">{children}</span>;
}
