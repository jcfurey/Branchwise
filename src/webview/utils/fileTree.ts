import type { GitFileChange } from "@/backend/types";
import { getWebviewConfig } from "@/webview/lib/webview-config";

/** A changed file, named by the last segment of its new path. `file` is the change itself. */
export type FileTreeFile = {
  type: "file";
  name: string;
  file: GitFileChange;
};

/**
 * A folder with at least one changed file beneath it. `path` is its segments joined with "/",
 * so the same folder has the same path each time a tree is built, which is how the file tree
 * remembers the folders the user closed.
 */
export type FileTreeFolder = {
  type: "folder";
  name: string;
  path: string;
  children: Array<FileTreeNode>;
};

export type FileTreeNode = FileTreeFile | FileTreeFolder;

/**
 * The top level, or a folder, while the tree is built. Subfolders are looked up by name here
 * rather than on the node, so a finished node holds its own fields and nothing else.
 */
type Level = { folders: Map<string, Folder>; files: Array<FileTreeFile> };

type Folder = Level & { node: FileTreeFolder };

// A tree is built for every commit whose details are shown, so each display language's
// collator is built once and kept under its tag.
const collators = new Map<string, Intl.Collator>();

/**
 * How names are ordered in `locale`: digits are read as numbers, so "file2" comes before
 * "file10". Intl rejects some tags, such as "en_US", and those order names in the runtime's
 * default locale. The fallback is kept under the rejected tag, so the tag is tried only once.
 */
function collatorFor(locale: string): Intl.Collator {
  let collator = collators.get(locale);
  if (collator === undefined) {
    try {
      collator = new Intl.Collator(locale, { numeric: true });
    } catch {
      collator = new Intl.Collator(undefined, { numeric: true });
    }
    collators.set(locale, collator);
  }

  return collator;
}

/** The nodes of one level: its folders, then its files, each by name. */
function nodesOf(level: Level, collator: Intl.Collator): Array<FileTreeNode> {
  const byName = (a: FileTreeNode, b: FileTreeNode) => collator.compare(a.name, b.name);
  // Both lists are in the order their entries were first met and the sort is stable, so
  // names the collator counts as equal keep that order.
  const folders = Array.from(level.folders.values(), (folder) => folder.node);
  return [...folders.toSorted(byName), ...level.files.toSorted(byName)];
}

/**
 * The changes of a commit as a folder tree, returned as its top level. Each change becomes one
 * file node at its new path, and each folder on the way gets a node of its own, even one that
 * holds a single folder. Empty segments are skipped, so "/a//b/" is file "b" in folder "a",
 * and a path with no segment at all is a top-level file named "".
 */
export function buildFileTree(files: Array<GitFileChange>): Array<FileTreeNode> {
  const collator = collatorFor(getWebviewConfig().locale);
  const top: Level = { folders: new Map(), files: [] };
  // Folders are finished from this list rather than by walking the tree, because a path can
  // be thousands of folders deep.
  const opened: Array<Folder> = [];

  for (const file of files) {
    const segments = file.newFilePath.split("/").filter((segment) => segment !== "");
    const name = segments.pop() ?? "";

    let parent: Folder | null = null;
    for (const segment of segments) {
      const level: Level = parent ?? top;
      let folder = level.folders.get(segment);
      if (folder === undefined) {
        const path: string = parent === null ? segment : `${parent.node.path}/${segment}`;
        folder = {
          folders: new Map(),
          files: [],
          node: { type: "folder", name: segment, path, children: [] }
        };
        level.folders.set(segment, folder);
        opened.push(folder);
      }
      parent = folder;
    }

    (parent ?? top).files.push({ type: "file", name, file });
  }

  for (const folder of opened) {
    folder.node.children = nodesOf(folder, collator);
  }

  return nodesOf(top, collator);
}
