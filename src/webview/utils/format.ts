import type { ComponentChildren } from "preact";

/**
 * A numbered placeholder: ASCII digits, and nothing else, in braces. The capture keeps the number
 * in the pieces `split` returns, so that text and numbers alternate.
 */
const PLACEHOLDER = /\{([0-9]+)\}/;

/**
 * Cut a localized `template` at its placeholders `{0}`, `{1}`, ... and put `parts[n]` in place of
 * each `{n}`, as the very value given: an element stays an element, and a string is shown as text,
 * never as markup. The result is rendered as a list of children.
 *
 * Text between placeholders becomes one string, and empty stretches are left out. A placeholder
 * without a part becomes `undefined`, which renders as nothing; parts no placeholder names are
 * ignored. Anything else in braces is plain text.
 */
/**
 * How many things there are, in words: `one` for exactly one, otherwise `many` with `count` in
 * place of `{0}`. The singular is a template of its own, since a noun is rarely all that changes.
 */
export function counted(count: number, one: string, many: string): string {
  return count === 1 ? one : many.replace("{0}", String(count));
}

export function format(
  template: string,
  ...parts: Array<ComponentChildren>
): Array<ComponentChildren> {
  const pieces: Array<ComponentChildren> = [];
  // Even positions hold text, odd positions the digits of a placeholder.
  template.split(PLACEHOLDER).forEach((piece, position) => {
    if (position % 2 === 1) {
      pieces.push(parts[Number(piece)]);
    } else if (piece !== "") {
      pieces.push(piece);
    }
  });
  return pieces;
}
