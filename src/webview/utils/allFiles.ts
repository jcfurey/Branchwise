import type { TreeEntry } from "@/backend/types";
import { getWebviewConfig } from "@/webview/lib/webview-config";
import { collatorFor } from "@/webview/utils/fileTree";

/** A folder of a commit's tree, known by its path from the root, segments joined with "/". */
export type TreeFolder = { type: "folder"; name: string; path: string };

/** A file, symbolic link or submodule, named by the last segment of its path. */
export type TreeFile = { type: "file"; name: string; entry: TreeEntry };

export type TreeNode = TreeFolder | TreeFile;

/** One entry as the list lays it out, with the number of folders it sits in. */
export type TreeRow = { depth: number; node: TreeNode };

/**
 * A commit's whole tree, which may hold tens of thousands of files. Nothing is grouped up front:
 * a folder's contents are found the first time it is opened, by one pass over the entries, and
 * kept for as long as the tree is.
 */
export class LazyTree {
  readonly entries: ReadonlyArray<TreeEntry>;
  private readonly levels = new Map<string, Array<TreeNode>>();
  private readonly collator = collatorFor(getWebviewConfig().locale);

  constructor(entries: ReadonlyArray<TreeEntry>) {
    this.entries = entries;
  }

  /** The folders, then the files, directly inside `folder` (`""` is the top), each by name. */
  childrenOf(folder: string): Array<TreeNode> {
    const known = this.levels.get(folder);
    if (known !== undefined) {
      return known;
    }
    const prefix = folder === "" ? "" : `${folder}/`;
    const folders = new Map<string, TreeFolder>();
    const files: Array<TreeFile> = [];
    for (const entry of this.entries) {
      if (!entry.path.startsWith(prefix)) {
        continue;
      }
      const rest = entry.path.slice(prefix.length);
      const slash = rest.indexOf("/");
      if (slash === -1) {
        files.push({ type: "file", name: rest, entry });
      } else if (!folders.has(rest.slice(0, slash))) {
        const name = rest.slice(0, slash);
        folders.set(name, { type: "folder", name, path: prefix + name });
      }
    }
    const byName = (a: TreeNode, b: TreeNode) => this.collator.compare(a.name, b.name);
    const level = [...[...folders.values()].toSorted(byName), ...files.toSorted(byName)];
    this.levels.set(folder, level);
    return level;
  }

  /**
   * The entries to show, depth first, inside the folders in `open` only, up to `limit` of them.
   * `more` says some were left out. A stack is used rather than recursion, since a path can be
   * thousands of folders deep.
   */
  rows(open: ReadonlySet<string>, limit: number): { rows: Array<TreeRow>; more: boolean } {
    const rows: Array<TreeRow> = [];
    const stack: Array<TreeRow> = [];
    const pushLevel = (folder: string, depth: number) => {
      const level = this.childrenOf(folder);
      for (let index = level.length - 1; index >= 0; index--) {
        stack.push({ depth, node: level[index]! });
      }
    };
    pushLevel("", 0);
    for (let row = stack.pop(); row !== undefined; row = stack.pop()) {
      if (rows.length === limit) {
        return { rows, more: true };
      }
      rows.push(row);
      if (row.node.type === "folder" && open.has(row.node.path)) {
        pushLevel(row.node.path, row.depth + 1);
      }
    }
    return { rows, more: false };
  }

  /**
   * The files whose path contains `text`, ignoring case, as a flat list in tree order, up to
   * `limit` of them. `more` says some were left out.
   */
  matching(text: string, limit: number): { rows: Array<TreeRow>; more: boolean } {
    const needle = text.toLowerCase();
    const rows: Array<TreeRow> = [];
    for (const entry of this.entries) {
      if (entry.path.toLowerCase().includes(needle)) {
        if (rows.length === limit) {
          return { rows, more: true };
        }
        rows.push({ depth: 0, node: { type: "file", name: entry.path, entry } });
      }
    }
    return { rows, more: false };
  }
}
