import { Component } from "preact";
import { useCallback, useMemo, useState } from "preact/hooks";

import type { GitFileChange } from "@/backend/types";
import { fileContextMenu } from "@/webview/components/history/file-menu";
import { Icon } from "@/webview/components/ui/Icons";
import { openContextMenu, viewDiff } from "@/webview/lib/actions";
import type { FileTreeFile, FileTreeFolder, FileTreeNode } from "@/webview/utils/fileTree";
import { format } from "@/webview/utils/format";

type FileTreeProps = {
  nodes: Array<FileTreeNode>;
  /** The commit the changes belong to. Diff requests and the file menu are made for it. */
  commitHash: string;
};

/** One entry as it is laid out: the node and the number of folders it sits in. */
type Row = { key: string; depth: number; node: FileTreeNode };

/** Text colour of a file, by the kind of change. Written out in full so Tailwind finds them. */
export const CHANGE_COLOUR: Record<GitFileChange["type"], string> = {
  A: "text-git-added",
  M: "text-git-modified",
  R: "text-git-modified",
  D: "text-git-deleted"
};

const ENTRY_CLASS = "flex w-full items-center overflow-hidden text-left whitespace-nowrap";
const GLYPH_CLASS = "mr-2 size-3.25 shrink-0 text-fg/60";

// The glyphs never change, so each is built once and shared by every entry that shows it.

/** A closed folder: the back panel with its tab, and the front panel shut over it. */
const CLOSED_FOLDER = (
  <Icon class={GLYPH_CLASS}>
    <path d="M1 3.5a1 1 0 0 1 1-1h3.6l1.6 1.6H14a1 1 0 0 1 1 1V6H1zM1 7h14v5.5a1 1 0 0 1-1 1H2a1 1 0 0 1-1-1z" />
  </Icon>
);

/** An open folder: the front panel leans forward, off the back panel and its tab. */
const OPEN_FOLDER = (
  <Icon class={GLYPH_CLASS}>
    <path d="M1 3.5a1 1 0 0 1 1-1h3.6l1.6 1.6H13a1 1 0 0 1 1 1v1.4H3.2L1 11.5zM3.7 7.5h11.8l-2.7 6H1z" />
  </Icon>
);

/** A page with its top right corner folded over. */
const PAGE = (
  <Icon class={GLYPH_CLASS}>
    <path d="M3 1h6.2v4.3h4.3V15H3zM10.2 1l3.3 3.3h-3.3z" />
  </Icon>
);

/** Left padding of an entry, in pixels: the top level sits 10px in, each folder adds 30px. */
function indent(depth: number) {
  return 10 + 30 * depth;
}

/**
 * The entries to show, depth first, leaving out everything inside a closed folder. A stack
 * is used rather than recursion because a path can be thousands of folders deep.
 *
 * Keys are built from content, so a tree built again for the same commit patches the entries
 * already shown and a focused one keeps focus. A folder is known by its path and a file by its
 * change; the count keeps two identical changes apart.
 */
function layout(nodes: Array<FileTreeNode>, closed: ReadonlySet<string>): Array<Row> {
  const rows: Array<Row> = [];
  const seen = new Map<string, number>();
  const stack: Array<{ node: FileTreeNode; depth: number }> = [];
  const pushLevel = (level: Array<FileTreeNode>, depth: number) => {
    for (let index = level.length - 1; index >= 0; index--) {
      stack.push({ node: level[index]!, depth });
    }
  };

  pushLevel(nodes, 0);
  for (let item = stack.pop(); item !== undefined; item = stack.pop()) {
    const { node, depth } = item;
    const identity = JSON.stringify(
      node.type === "folder"
        ? [node.path]
        : [node.file.type, node.file.oldFilePath, node.file.newFilePath]
    );
    const count = seen.get(identity) ?? 0;
    seen.set(identity, count + 1);
    rows.push({ key: count === 0 ? identity : `${identity}#${count}`, depth, node });

    if (node.type === "folder" && !closed.has(node.path)) {
      pushLevel(node.children, depth + 1);
    }
  }

  return rows;
}

/**
 * A commit's changed files grouped by folder. Every folder starts open; a closed one is
 * remembered by its path for as long as the tree shows the same commit.
 */
export function FileTree({ nodes, commitHash }: FileTreeProps) {
  // A path names a different folder in another commit, so a new commit starts a new tree.
  return <Tree key={commitHash} nodes={nodes} commitHash={commitHash} />;
}

function Tree({ nodes, commitHash }: FileTreeProps) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(() => new Set());
  const rows = useMemo(() => layout(nodes, closed), [nodes, closed]);
  // Kept the same across renders, so entries that did not change can skip rendering.
  const toggle = useCallback((path: string) => {
    setClosed((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) {
        next.add(path);
      }
      return next;
    });
  }, []);

  // One flat list, indented per entry, so a deep path does not nest elements as deeply.
  return (
    <ul class="list-none">
      {rows.map(({ key, depth, node }) => (
        <Entry
          key={key}
          node={node}
          depth={depth}
          open={node.type === "folder" && !closed.has(node.path)}
          commitHash={commitHash}
          onToggle={toggle}
        />
      ))}
    </ul>
  );
}

type EntryProps = {
  node: FileTreeNode;
  depth: number;
  /** For a folder, whether its contents are shown. */
  open: boolean;
  commitHash: string;
  onToggle: (path: string) => void;
};

/** Whether two nodes show the same thing, though one may come from a tree built again. */
function sameContent(a: FileTreeNode, b: FileTreeNode) {
  if (a === b) {
    return true;
  }
  if (a.type === "folder" || b.type === "folder") {
    return a.type === "folder" && b.type === "folder" && a.name === b.name && a.path === b.path;
  }
  const [before, after] = [a.file, b.file];
  return (
    a.name === b.name &&
    before.type === after.type &&
    before.oldFilePath === after.oldFilePath &&
    before.newFilePath === after.newFilePath &&
    before.additions === after.additions &&
    before.deletions === after.deletions
  );
}

/**
 * One list item. A toggle, or a new tree for the same commit, renders the whole list again;
 * in a commit of thousands of files nearly every entry shows what it showed before, and skips.
 */
class Entry extends Component<EntryProps> {
  shouldComponentUpdate(next: EntryProps) {
    const now = this.props;
    return !(
      now.depth === next.depth &&
      now.open === next.open &&
      now.commitHash === next.commitHash &&
      now.onToggle === next.onToggle &&
      sameContent(now.node, next.node)
    );
  }

  render({ node, depth, open, commitHash, onToggle }: EntryProps) {
    return (
      <li class="mt-1 overflow-hidden" style={{ paddingLeft: `${indent(depth)}px` }}>
        {node.type === "folder" ? (
          <FolderEntry folder={node} open={open} onToggle={onToggle} />
        ) : (
          <FileEntry entry={node} commitHash={commitHash} />
        )}
      </li>
    );
  }
}

function FolderEntry({
  folder,
  open,
  onToggle
}: {
  folder: FileTreeFolder;
  open: boolean;
  onToggle: (path: string) => void;
}) {
  return (
    <button
      type="button"
      class={`${ENTRY_CLASS} cursor-pointer`}
      aria-expanded={open}
      onClick={() => onToggle(folder.path)}
    >
      {open ? OPEN_FOLDER : CLOSED_FOLDER}
      <span class="min-w-0 truncate">{folder.name}</span>
    </button>
  );
}

/**
 * A changed file. A click opens its diff; a file Git gave no line counts for is binary and has
 * no diff to open, so it only offers its menu.
 */
function FileEntry({ entry, commitHash }: { entry: FileTreeFile; commitHash: string }) {
  const change = entry.file;
  const { type, oldFilePath, newFilePath, additions, deletions } = change;
  const binary = additions === null || deletions === null;
  const source = `file:${newFilePath}`;
  const menu = () => fileContextMenu(commitHash, newFilePath, oldFilePath, type === "D");

  return (
    <button
      type="button"
      class={`${ENTRY_CLASS} ${CHANGE_COLOUR[type]} ${binary ? "cursor-default" : "cursor-pointer"}`}
      title={binary ? window.l10n.tooltipBinaryFile : undefined}
      aria-disabled={binary ? "true" : undefined}
      onClick={(event) => {
        // A double-click's second click would ask for the same diff again. Keyboard
        // activation reports no clicks at all.
        if (!binary && event.detail < 2) {
          viewDiff(commitHash, change);
        }
      }}
      onContextMenu={(event) => openContextMenu(event, source, menu())}
      onKeyDown={(event) => {
        if (event.key === "ContextMenu" || (event.key === "F10" && event.shiftKey)) {
          event.preventDefault();
          const box = event.currentTarget.getBoundingClientRect();
          openContextMenu(
            new MouseEvent("contextmenu", { clientX: box.left, clientY: box.bottom }),
            source,
            menu()
          );
        }
      }}
    >
      {PAGE}
      <span class="min-w-0 truncate">{entry.name}</span>
      {type === "R" && (
        <span
          class="ml-2 shrink-0 cursor-help text-fg"
          title={format(window.l10n.tooltipRenamedTo, oldFilePath, newFilePath).join("")}
        >
          {type}
        </span>
      )}
      {!binary && (type === "M" || type === "R") && (
        <LineCounts added={additions} removed={deletions} />
      )}
    </button>
  );
}

/** "(+3|-1)", each number explained by its own tooltip. */
function LineCounts({ added, removed }: { added: number; removed: number }) {
  const addedTitle = added === 1 ? window.l10n.tooltipAddition : window.l10n.tooltipAdditions;
  const removedTitle = removed === 1 ? window.l10n.tooltipDeletion : window.l10n.tooltipDeletions;

  return (
    <span class="ml-2 shrink-0 text-fg">
      (
      <span
        class="cursor-help px-0.75 text-git-added"
        title={format(addedTitle, String(added)).join("")}
      >
        {`+${added}`}
      </span>
      |
      <span
        class="cursor-help px-0.75 text-git-deleted"
        title={format(removedTitle, String(removed)).join("")}
      >
        {`-${removed}`}
      </span>
      )
    </span>
  );
}
