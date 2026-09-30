import { useLayoutEffect, useRef } from "preact/hooks";

import type { WorkingTreeFile, WorkingTreeGroup } from "@/backend/types";
import { DetailsRow } from "@/webview/components/commit/CommitDetails";
import { QueryStatus } from "@/webview/components/history/QueryControls";
import { Button } from "@/webview/components/ui/Button";
import { refresh } from "@/webview/lib/actions";
import { sendRepositoryAction } from "@/webview/lib/repository-actions";
import { usePage } from "@/webview/lib/use-page";
import { useRepositoryQuery } from "@/webview/lib/use-repository-query";

const GROUPS: WorkingTreeGroup[] = ["conflicts", "unstaged", "staged", "untracked"];

function groupLabel(group: WorkingTreeGroup) {
  return {
    conflicts: window.l10n.conflicts,
    unstaged: window.l10n.unstagedChanges,
    staged: window.l10n.stagedChanges,
    untracked: window.l10n.untrackedFiles
  }[group];
}

/** The file button to focus when a refresh removed the focused one, such as a file just staged. */
function replacement(list: HTMLElement, lost: { group: string; path: string; index: number }) {
  const buttons = [...list.querySelectorAll<HTMLButtonElement>("button[data-file-path]")];
  const inGroup = buttons.filter((button) => button.dataset["fileGroup"] === lost.group);
  return (
    buttons.find((button) => button.dataset["filePath"] === lost.path) ??
    inGroup[Math.min(lost.index, inGroup.length - 1)] ??
    buttons[0]
  );
}

export function WorkingTreeDetails() {
  const query = useRepositoryQuery({ kind: "workingTree" });
  const list = useRef<HTMLDivElement>(null);
  const focused = useRef<{
    element: HTMLElement;
    group: string;
    path: string;
    index: number;
  } | null>(null);

  // A refresh keeps rows that stay in their group, and with them focus. Only a row that left its
  // group, or the list, takes focus with it; move it to the same file or its neighbour.
  useLayoutEffect(() => {
    const lost = focused.current;
    const active = document.activeElement;
    if (
      lost === null ||
      lost.element.isConnected ||
      list.current === null ||
      (active !== null && active !== document.body)
    ) {
      return;
    }
    replacement(list.current, lost)?.focus();
  }, [query.data]);

  const files = query.data?.files;
  return (
    <DetailsRow>
      <div class="mr-8 flex h-full flex-col px-3 py-2" data-working-tree-details>
        <div class="flex shrink-0 items-center justify-between gap-3 pb-2">
          <span class="text-muted">{window.l10n.workingTreeHint}</span>
          <Button onClick={refresh}>{window.l10n.refresh}</Button>
        </div>
        <div
          ref={list}
          class="min-h-0 overflow-auto"
          aria-busy={query.loading}
          onFocusIn={(event) => {
            const button = (event.target as HTMLElement).closest<HTMLButtonElement>(
              "button[data-file-path]"
            );
            focused.current =
              button === null
                ? null
                : {
                    element: button,
                    group: button.dataset["fileGroup"]!,
                    path: button.dataset["filePath"]!,
                    index: Number(button.dataset["fileIndex"])
                  };
          }}
          onFocusOut={(event) => {
            // Focus moved elsewhere on purpose; a removed row has no next target.
            const next = event.relatedTarget as Node | null;
            if (next !== null && !list.current?.contains(next)) {
              focused.current = null;
            }
          }}
        >
          {/* The previous list stays while a refresh loads, so focus and scrolling survive it. */}
          <QueryStatus loading={query.loading && files === undefined} error={query.error} />
          {!query.error &&
            files !== undefined &&
            (files.length === 0 ? (
              <p class="p-3 text-muted">{window.l10n.noWorkingTreeChanges}</p>
            ) : (
              GROUPS.map((group) => (
                <FileGroup
                  key={group}
                  group={group}
                  files={files.filter((file) => file.group === group)}
                />
              ))
            ))}
        </div>
      </div>
    </DetailsRow>
  );
}

function FileGroup({ group, files }: { group: WorkingTreeGroup; files: WorkingTreeFile[] }) {
  const page = usePage(files);
  if (files.length === 0) {
    return null;
  }
  const label = groupLabel(group);
  return (
    <section class="pb-3" aria-label={label}>
      <h3 class="pb-1 font-semibold">
        {label} ({files.length})
      </h3>
      <ul class="list-none">
        {page.shown.map((file, index) => (
          <li key={file.path}>
            <button
              type="button"
              class="flex w-full cursor-pointer items-center gap-2 rounded px-2 py-1 text-left hover:bg-row-hover focus:outline-1 focus:outline-focus"
              title={file.oldPath !== file.path ? `${file.oldPath} → ${file.path}` : file.path}
              data-file-group={group}
              data-file-path={file.path}
              data-file-index={index}
              onClick={() =>
                sendRepositoryAction({ kind: "viewWorkingTreeFile", path: file.path, group })
              }
            >
              <span class="w-6 shrink-0 font-mono text-muted">{file.status}</span>
              <span class="truncate">{file.path}</span>
              {file.repository && (
                <span class="shrink-0 text-muted">({window.l10n.nestedRepository})</span>
              )}
              {file.oldPath !== file.path && (
                <span class="truncate text-muted">← {file.oldPath}</span>
              )}
            </button>
          </li>
        ))}
      </ul>
      {page.more}
    </section>
  );
}
