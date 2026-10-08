import { Component } from "preact";
import { useCallback, useMemo, useState } from "preact/hooks";

import type { GitFileChange, TreeEntry } from "@/backend/types";
import { abbrevCommit } from "@/backend/utils/string";
import {
  CHANGE_COLOUR,
  CLOSED_FOLDER,
  ENTRY_CLASS,
  GLYPH_CLASS,
  indent,
  OPEN_FOLDER,
  openMenuFromKeys,
  PAGE,
  StatusCell
} from "@/webview/components/commit/FileTree";
import { treeFileMenu } from "@/webview/components/history/file-menu";
import { Icon } from "@/webview/components/ui/Icons";
import { Loading } from "@/webview/components/ui/Loading";
import { openContextMenu } from "@/webview/lib/actions";
import { useCommitTree } from "@/webview/lib/commit-tree";
import { sendRepositoryAction } from "@/webview/lib/repository-actions";
import type { TreeFolder, TreeNode, TreeRow } from "@/webview/utils/allFiles";
import { format } from "@/webview/utils/format";

/**
 * How many entries the list draws at first, and how many more each Show More adds. The details
 * are 250 pixels high, so the first step alone fills them many times over.
 */
export const ROW_STEP = 500;

/** A bent arrow, down then right: an entry that points somewhere else. */
const SYMLINK = (
  <Icon class={GLYPH_CLASS}>
    <path d="M2 2h1.6v6.4A1.6 1.6 0 0 0 5.2 10H11V7.4l4 3.4-4 3.4V11.6H5.2A3.2 3.2 0 0 1 2 8.4z" />
  </Icon>
);

/** A frame around a smaller block: a repository kept inside this one. */
const SUBMODULE = (
  <Icon class={GLYPH_CLASS}>
    <path fill-rule="evenodd" d="M1.5 2h13v12h-13zM3 3.5v9h10v-9zM5 5.5h6v5H5z" />
  </Icon>
);

type AllFilesProps = {
  /** The commit whose tree is listed. */
  hash: string;
  /** The files the commit changed, which keep their status letter here. */
  changes: ReadonlyArray<GitFileChange>;
  /** Only files whose path contains this, ignoring case; `""` lists the tree by folder. */
  filter: string;
};

/**
 * Every file of a commit, by folder. The tree is read when the list first shows, and is kept
 * for the commit. Folders start closed and are only looked into when opened, and the list draws
 * `ROW_STEP` entries at a time, so a tree of tens of thousands of files opens at once.
 */
export function AllFiles(props: AllFilesProps) {
  // Folders opened in one commit mean nothing in another, so a new commit starts afresh.
  return <Listing key={props.hash} {...props} />;
}

function Listing({ hash, changes, filter }: AllFilesProps) {
  const { data, error } = useCommitTree(hash);
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [shown, setShown] = useState({ filter, limit: ROW_STEP });
  // A new filter starts again from the first step.
  const limit = shown.filter === filter ? shown.limit : ROW_STEP;
  const changed = useMemo(
    () => new Map(changes.map((change) => [change.newFilePath, change])),
    [changes]
  );
  const toggle = useCallback((path: string) => {
    setOpen((previous) => {
      const next = new Set(previous);
      if (!next.delete(path)) {
        next.add(path);
      }
      return next;
    });
  }, []);
  const layout = useMemo(() => {
    if (data === null) {
      return null;
    }
    const text = filter.trim();
    return text === "" ? data.tree.rows(open, limit) : data.tree.matching(text, limit);
  }, [data, open, filter, limit]);

  const l10n = window.l10n;
  if (error !== null) {
    return (
      <p role="alert" class="px-2.5 py-1 text-muted">
        {format(l10n.unableToListFiles, error).join("")}
      </p>
    );
  }
  if (data === null || layout === null) {
    return <Loading />;
  }
  return (
    <div data-all-files>
      {data.more && (
        <p class="px-2.5 py-1 text-xs text-muted">
          {format(l10n.allFilesLimited, String(data.tree.entries.length)).join("")}
        </p>
      )}
      {layout.rows.length === 0 && filter.trim() !== "" && (
        <p class="px-2.5 py-1 text-muted">{l10n.noMatchingFiles}</p>
      )}
      <ul class="list-none">
        {layout.rows.map((row) => (
          <Entry
            key={row.node.type === "folder" ? `d:${row.node.path}` : `f:${row.node.entry.path}`}
            row={row}
            open={row.node.type === "folder" && open.has(row.node.path)}
            hash={hash}
            change={row.node.type === "file" ? changed.get(row.node.entry.path) : undefined}
            onToggle={toggle}
          />
        ))}
      </ul>
      {layout.more && (
        <button
          type="button"
          class="mx-2.5 my-1 cursor-pointer rounded-sm px-1 text-xs hover:bg-btn-hover focus:outline-1 focus:outline-focus"
          onClick={() => setShown({ filter, limit: limit + ROW_STEP })}
        >
          {l10n.showMoreFiles}
        </button>
      )}
    </div>
  );
}

type EntryProps = {
  row: TreeRow;
  open: boolean;
  hash: string;
  change: GitFileChange | undefined;
  onToggle: (path: string) => void;
};

/** One list item. Opening a folder draws the list again; entries that show the same skip it. */
class Entry extends Component<EntryProps> {
  shouldComponentUpdate(next: EntryProps) {
    const now = this.props;
    return !(
      now.row.node === next.row.node &&
      now.row.depth === next.row.depth &&
      now.open === next.open &&
      now.hash === next.hash &&
      now.change === next.change &&
      now.onToggle === next.onToggle
    );
  }

  render({ row, open, hash, change, onToggle }: EntryProps) {
    const { node, depth } = row;
    return (
      <li class="mt-1 overflow-hidden" style={{ paddingLeft: `${indent(depth)}px` }}>
        {node.type === "folder" ? (
          <FolderEntry folder={node} open={open} onToggle={onToggle} />
        ) : (
          <FileEntry node={node} hash={hash} change={change} />
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
  folder: TreeFolder;
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

/** What an entry is, for its tooltip: a symbolic link or a submodule; nothing for a file. */
function kindName(entry: TreeEntry) {
  if (entry.kind === "symlink") {
    return window.l10n.symbolicLink;
  }
  if (entry.kind === "submodule") {
    return format(window.l10n.submoduleAt, abbrevCommit(entry.commit ?? "")).join("");
  }
  return null;
}

/**
 * A file as it is at the commit. A click opens it read-only; a submodule has nothing to open and
 * only offers its menu. A file the commit changed shows its status letter, as in Changed Files.
 */
function FileEntry({
  node,
  hash,
  change
}: {
  node: Extract<TreeNode, { type: "file" }>;
  hash: string;
  change: GitFileChange | undefined;
}) {
  const { entry } = node;
  const submodule = entry.kind === "submodule";
  const kind = kindName(entry);
  const source = `tree:${entry.path}`;
  const menu = () => treeFileMenu(hash, entry);
  const glyph = submodule ? SUBMODULE : entry.kind === "symlink" ? SYMLINK : PAGE;

  return (
    <button
      type="button"
      class={`${ENTRY_CLASS} ${change ? CHANGE_COLOUR[change.type] : ""} ${submodule ? "cursor-default" : "cursor-pointer"}`}
      title={kind === null ? entry.path : `${entry.path} · ${kind}`}
      aria-disabled={submodule ? "true" : undefined}
      data-kind={entry.kind}
      onClick={(event) => {
        // A double-click's second click would open the same file again.
        if (!submodule && event.detail < 2) {
          sendRepositoryAction({ kind: "viewHistoricalFile", hash, path: entry.path });
        }
      }}
      onContextMenu={(event) => openContextMenu(event, source, menu())}
      onKeyDown={(event) => openMenuFromKeys(event, source, menu)}
    >
      {glyph}
      <span class="min-w-0 truncate">{node.name}</span>
      {kind !== null && <span class="sr-only">{`, ${kind}`}</span>}
      {change && <StatusCell letter={change.type} />}
    </button>
  );
}
