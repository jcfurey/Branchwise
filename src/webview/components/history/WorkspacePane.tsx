import { useState } from "preact/hooks";

import type { RepositoryAction, WorkspaceEntry } from "@/backend/types";
import { openSubmodule, openWorkspaceSync } from "@/webview/components/history/WorkflowTools";
import { Button } from "@/webview/components/ui/Button";
import { Checkbox } from "@/webview/components/ui/Checkbox";
import { KebabIcon } from "@/webview/components/ui/Icons";
import { INPUT_CLASS } from "@/webview/components/ui/Input";
import { openContextMenu, selectRepo } from "@/webview/lib/actions";
import { confirmRepositoryAction, repositoryRevision } from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";
import { useRepositoryQuery } from "@/webview/lib/use-repository-query";
import { format } from "@/webview/utils/format";

import { QueryStatus } from "./QueryControls";

function changed(entry: WorkspaceEntry) {
  return (
    !entry.initialized ||
    entry.dirty > 0 ||
    entry.ahead > 0 ||
    entry.behind > 0 ||
    (entry.recorded !== null && entry.head !== entry.recorded) ||
    entry.recorded !== entry.committed ||
    entry.error !== null
  );
}

function submoduleAction(entry: WorkspaceEntry, operation: "initialize" | "sync" | "update") {
  if (!entry.parent || !entry.submodulePath || !entry.recorded) {
    return;
  }
  const label =
    window.l10n[
      operation === "sync"
        ? "syncSubmodule"
        : operation === "initialize"
          ? "initializeSubmodule"
          : "updateSubmodule"
    ];
  const action: RepositoryAction = {
    kind: "submodule",
    path: entry.submodulePath,
    recorded: entry.recorded,
    operation
  };
  confirmRepositoryAction(
    operation === "sync"
      ? format(window.l10n.submoduleSyncConfirm, <b>{entry.submodulePath}</b>)
      : format(
          window.l10n.submoduleActionConfirm,
          <b>{label}</b>,
          <b>{entry.submodulePath}</b>,
          <code>{entry.recorded.slice(0, 12)}</code>
        ),
    label,
    action,
    entry.parent
  );
}

function RepoRow({ entry, depth }: { entry: WorkspaceEntry; depth: number }) {
  const mismatch = entry.recorded !== null && entry.head !== entry.recorded;
  const staged = entry.recorded !== entry.committed;
  const label = entry.submodulePath ?? entry.path.split("/").at(-1) ?? entry.path;
  return (
    <div
      class={
        "border-b border-line-soft px-2 py-2 " +
        (entry.path === selectedRepo.value ? "bg-row-head" : "hover:bg-row-hover")
      }
      style={{ paddingLeft: 8 + Math.min(depth, 8) * 12 }}
    >
      <div class="flex items-center gap-2">
        <button
          class="min-w-0 flex-1 cursor-pointer truncate text-left font-medium disabled:cursor-default"
          disabled={!entry.initialized}
          onClick={() => selectRepo(entry.path)}
          title={entry.path}
        >
          {label}
        </button>
        {entry.submodulePath && (
          <button
            class="flex cursor-pointer items-center rounded px-1.5 py-1 hover:bg-btn-hover focus:outline-1 focus:outline-focus"
            aria-label={label + " " + window.l10n.repositoryTools}
            onClick={(event) =>
              openContextMenu(event, "workspace:" + entry.path, [
                ...(!entry.initialized
                  ? [
                      {
                        title: window.l10n.initializeSubmodule,
                        onClick: () => submoduleAction(entry, "initialize")
                      }
                    ]
                  : [
                      { title: window.l10n.submoduleChanges, onClick: () => openSubmodule(entry) },
                      {
                        title: window.l10n.updateSubmodule,
                        onClick: () => submoduleAction(entry, "update")
                      }
                    ]),
                { title: window.l10n.syncSubmodule, onClick: () => submoduleAction(entry, "sync") }
              ])
            }
          >
            <KebabIcon />
          </button>
        )}
      </div>
      <p class="mt-1 truncate text-xs text-muted">
        {entry.initialized
          ? entry.branch || `${window.l10n.detachedHead} ${entry.head?.slice(0, 8) ?? ""}`
          : window.l10n.submoduleUninitialized}
      </p>
      {entry.initialized && (
        <div class="mt-1 flex flex-wrap gap-x-2 text-xs">
          <span class={entry.dirty ? "text-git-modified" : "text-muted"}>
            {window.l10n.dirtyFiles.replace("{0}", String(entry.dirty))}
          </span>
          {(entry.ahead > 0 || entry.behind > 0) && (
            <span
              title={window.l10n.trackingStatus
                .replace("{0}", entry.branch)
                .replace("{1}", String(entry.ahead))
                .replace("{2}", String(entry.behind))}
            >
              ↑{entry.ahead} ↓{entry.behind}
            </span>
          )}
        </div>
      )}
      {mismatch && (
        <button
          class="mt-1 cursor-pointer text-left text-xs text-git-modified hover:underline"
          disabled={!entry.initialized}
          onClick={() => openSubmodule(entry)}
          title={window.l10n.indexRevision.replace("{0}", entry.recorded ?? "")}
        >
          {window.l10n.submoduleMoved}
        </button>
      )}
      {staged && entry.submodulePath && (
        <button
          class="mt-1 cursor-pointer text-left text-xs text-git-added hover:underline"
          disabled={!entry.initialized}
          onClick={() => openSubmodule(entry, true)}
          title={window.l10n.parentRevision.replace("{0}", entry.committed ?? "∅")}
        >
          {window.l10n.submoduleStaged}
        </button>
      )}
      {entry.error && <p class="mt-1 break-words text-xs text-git-deleted">{entry.error}</p>}
    </div>
  );
}

export function WorkspacePane() {
  const [filter, setFilter] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const query = useRepositoryQuery<"workspace">({ kind: "workspace" });
  const entries = query.data?.entries ?? [];
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const visible = new Set<string>();
  for (const entry of entries) {
    if (
      (!onlyChanged || changed(entry)) &&
      (entry.path + " " + entry.branch).toLowerCase().includes(filter.toLowerCase())
    ) {
      let cursor: WorkspaceEntry | undefined = entry;
      while (cursor && !visible.has(cursor.path)) {
        visible.add(cursor.path);
        cursor = cursor.parent ? byPath.get(cursor.parent) : undefined;
      }
    }
  }
  function depth(entry: WorkspaceEntry) {
    let n = 0;
    let cursor = entry;
    while (cursor.parent && byPath.has(cursor.parent) && n < 20) {
      n++;
      cursor = byPath.get(cursor.parent)!;
    }
    return n;
  }
  return (
    <aside
      aria-label={window.l10n.workspaceOverview}
      class="flex max-h-72 min-h-0 w-full flex-1 flex-col overflow-y-auto border-b border-line-soft bg-editor text-ui md:max-h-none md:border-b-0"
    >
      <div class="space-y-3 border-b border-line-soft p-3">
        <div class="flex items-center justify-between">
          <h2 class="font-semibold">
            {window.l10n.workspaceOverview} <span class="text-muted">{entries.length || ""}</span>
          </h2>
          <Button
            onClick={() => {
              repositoryRevision.value++;
            }}
          >
            {window.l10n.refresh}
          </Button>
        </div>
        <input
          class={INPUT_CLASS}
          aria-label={window.l10n.overviewFilter}
          placeholder={window.l10n.overviewFilter}
          value={filter}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
        <Checkbox
          label={window.l10n.changedReposOnly}
          checked={onlyChanged}
          onInput={(event) => setOnlyChanged(event.currentTarget.checked)}
        />
        <Button onClick={openWorkspaceSync}>{window.l10n.workspaceSync}</Button>
      </div>
      <QueryStatus {...query} />
      {entries
        .filter((entry) => visible.has(entry.path))
        .map((entry) => (
          <RepoRow key={entry.path} entry={entry} depth={depth(entry)} />
        ))}
    </aside>
  );
}
