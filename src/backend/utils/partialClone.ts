import type { SimpleGit } from "simple-git";

/**
 * Whether the repository is a partial clone that left file contents out, such as one made with
 * `--filter=blob:none`. Git fetches a missing file from the remote the moment a command needs
 * it, so a command that compares many versions of many files, run in such a clone, downloads
 * them one request after another. What the graph reads without being asked, to fill a column
 * or to forecast a merge, is left undone there instead.
 *
 * A clone that only left out files over a size (`blob:limit=…`) has nearly all of them and
 * counts as whole. A remote marked as a promisor without a filter may lack anything.
 */
export async function lacksFileContents(git: SimpleGit): Promise<boolean> {
  // Git exits with 1 when nothing matches, as in every ordinary clone.
  const output = await git
    .raw(["config", "--null", "--get-regexp", "^remote\\..*\\.(promisor|partialclonefilter)$"])
    .catch(() => "");
  const promisors = new Set<string>();
  const filters = new Map<string, string>();
  for (const entry of output.split("\0")) {
    // The key, then a line break and the value.
    const [key = "", value = ""] = entry.split(/\n(.*)/s);
    const setting = /^remote\.(.*)\.(promisor|partialclonefilter)$/.exec(key);
    if (setting === null) {
      continue;
    }
    if (setting[2] === "partialclonefilter") {
      filters.set(setting[1]!, value);
    } else if (value === "true") {
      promisors.add(setting[1]!);
    }
  }
  return [...new Set([...promisors, ...filters.keys()])].some(
    (remote) => !(filters.get(remote) ?? "").startsWith("blob:limit=")
  );
}
