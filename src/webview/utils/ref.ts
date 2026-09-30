/**
 * Characters a name may not hold anywhere: the ones Git forbids, plus `"`, `<` and `>`, which are
 * refused so that a name is always safe to quote and show. Only the plain space counts as a space.
 */
const FORBIDDEN_CHARACTERS = new Set([" ", "~", "^", ":", "?", "*", "[", "\\", '"', "<", ">"]);

/** Sequences a name may not hold anywhere. `/.` catches a later component that starts with a dot. */
const FORBIDDEN_SEQUENCES = ["..", "//", "@{", "/."];

/** Names that are refused as a whole. */
const RESERVED_NAMES = new Set(["@", "HEAD"]);

/** C0 controls (U+0000 to U+001F) and DEL (U+007F). */
function isControl(character: string): boolean {
  const code = character.charCodeAt(0);
  return code <= 0x1f || code === 0x7f;
}

/**
 * Whether `name` breaks a rule for Git ref names, as the dialogs check them before asking Git.
 * Start and end mean those of the whole string, even across line breaks. The empty string passes:
 * the dialogs check for emptiness on their own.
 */
export function hasInvalidRefChars(name: string): boolean {
  if (RESERVED_NAMES.has(name)) {
    return true;
  }
  if (name.startsWith("-") || name.startsWith("/") || name.startsWith(".")) {
    return true;
  }
  if (name.endsWith(".") || name.endsWith("/")) {
    return true;
  }
  for (const character of name) {
    if (FORBIDDEN_CHARACTERS.has(character) || isControl(character)) {
      return true;
    }
  }
  if (FORBIDDEN_SEQUENCES.some((sequence) => name.includes(sequence))) {
    return true;
  }
  // Git keeps `<name>.lock` files beside its refs, so no component may end that way.
  return name.split("/").some((component) => component.endsWith(".lock"));
}
