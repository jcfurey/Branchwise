/** How many characters of a commit hash label a commit wherever it is shown. */
const SHORT_HASH_LENGTH = 8;

/**
 * The short form of a commit hash for the graph, dialogs and diff titles: its first eight
 * characters, whatever `core.abbrev` says. The webview bundles this module, so it imports nothing.
 */
export function abbrevCommit(commitHash: string): string {
  return commitHash.slice(0, SHORT_HASH_LENGTH);
}
