/**
 * Up to two letters for a person's name, as on an avatar: the first letters of the first and
 * last words, in upper case, or "?" for a blank name.
 */
export function initials(name: string) {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words.at(-1)!] : words.slice(0, 1);
  return letters.map((word) => [...word][0]!.toLocaleUpperCase()).join("") || "?";
}
