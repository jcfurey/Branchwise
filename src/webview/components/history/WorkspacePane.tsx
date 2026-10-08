import type { ComponentChildren, VNode } from "preact";
import { useRef, useState } from "preact/hooks";

import type { RepositoryAction, WorkspaceEntry } from "@/backend/types";
import { openSubmodule, openWorkspaceSync } from "@/webview/components/history/WorkflowTools";
import { openBulkAction } from "@/webview/components/history/WorkspaceBulk";
import { Button } from "@/webview/components/ui/Button";
import { Checkbox } from "@/webview/components/ui/Checkbox";
import {
  BranchIcon,
  ChevronDownIcon,
  ConflictIcon,
  DetachedIcon,
  FetchIcon,
  KebabIcon,
  PausedIcon,
  PublishIcon,
  StashIcon
} from "@/webview/components/ui/Icons";
import { INPUT_CLASS } from "@/webview/components/ui/Input";
import { Select } from "@/webview/components/ui/Select";
import { openContextMenu, selectRepo } from "@/webview/lib/actions";
import {
  setWorkspaceFilter,
  setWorkspaceOrder,
  workspaceFilter,
  workspaceOrder
} from "@/webview/lib/navigation";
import { confirmRepositoryAction, repositoryRevision } from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";
import { useSettledRepositoryQuery } from "@/webview/lib/use-repository-query";
import { workspaceBusy } from "@/webview/lib/workspace-actions";
import {
  isUnpublished,
  matchesFilter,
  sortSiblings,
  STALE_FETCH_SECONDS,
  WORKSPACE_FILTERS,
  workspaceTotals,
  type WorkspaceFilter
} from "@/webview/lib/workspace-status";
import { getFullDate, getRelativeDate } from "@/webview/utils/date";
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

/** A short fact about a repository: an icon and a few words, in the row's small text. */
function Badge({
  icon,
  title,
  class: tone = "",
  children
}: {
  icon: ComponentChildren;
  title?: string;
  class?: string;
  children: ComponentChildren;
}) {
  return (
    <span class={`inline-flex items-center gap-1 ${tone}`} title={title}>
      {icon}
      {children}
    </span>
  );
}

const BADGE_ICON = "size-3 shrink-0";

function operationText(entry: WorkspaceEntry) {
  switch (entry.operation) {
    case null:
      return null;
    case "bisect":
      return window.l10n.bisectActive;
    default:
      return window.l10n.operationInProgress.replace(
        "{0}",
        {
          merge: window.l10n.mergeOperation,
          rebase: window.l10n.rebaseOperation,
          "cherry-pick": window.l10n.cherryPickOperation,
          revert: window.l10n.revertOperation
        }[entry.operation]
      );
  }
}

/** What needs attention besides changed files and the upstream counts, most urgent first. */
function AttentionBadges({ entry }: { entry: WorkspaceEntry }) {
  const operation = operationText(entry);
  const stale = entry.fetched !== null && Date.now() / 1000 - entry.fetched > STALE_FETCH_SECONDS;
  return (
    <>
      {operation !== null && (
        <Badge class="text-git-conflict" icon={<PausedIcon class={BADGE_ICON} />}>
          {operation}
        </Badge>
      )}
      {entry.conflicts > 0 && (
        <Badge class="text-git-conflict" icon={<ConflictIcon class={BADGE_ICON} />}>
          {window.l10n.conflictedFiles.replace("{0}", String(entry.conflicts))}
        </Badge>
      )}
      {isUnpublished(entry) && (
        <Badge
          icon={<PublishIcon class={BADGE_ICON} />}
          title={window.l10n.unpublishedBranchHint.replace("{0}", entry.branch)}
        >
          {window.l10n.unpublishedBranch}
        </Badge>
      )}
      {entry.aheadBranches > 0 && (
        <Badge icon={<BranchIcon class={BADGE_ICON} />} title={window.l10n.otherBranchesAheadHint}>
          {window.l10n.otherBranchesAhead.replace("{0}", String(entry.aheadBranches))}
        </Badge>
      )}
      {entry.stashes > 0 && (
        <Badge icon={<StashIcon class={BADGE_ICON} />}>
          {window.l10n.stashCount.replace("{0}", String(entry.stashes))}
        </Badge>
      )}
      {stale && (
        <Badge
          class="text-muted"
          icon={<FetchIcon class={BADGE_ICON} />}
          title={window.l10n.lastFetched.replace("{0}", getFullDate(entry.fetched!))}
        >
          {window.l10n.fetchedAgo.replace("{0}", getRelativeDate(entry.fetched!))}
        </Badge>
      )}
    </>
  );
}

/** A submodule by its path in the superproject, a nested repository by its path in its parent. */
function rowLabel(entry: WorkspaceEntry, parent: WorkspaceEntry | undefined) {
  if (entry.submodulePath) {
    return entry.submodulePath;
  }
  if (parent && entry.path.startsWith(parent.path + "/")) {
    return entry.path.slice(parent.path.length + 1);
  }
  return entry.path.split("/").at(-1) || entry.path;
}

function RepoRow({
  entry,
  parent,
  depth,
  expanded,
  onToggle
}: {
  entry: WorkspaceEntry;
  parent: WorkspaceEntry | undefined;
  depth: number;
  /** Undefined for a repository without rows below it. */
  expanded: boolean | undefined;
  onToggle: () => void;
}) {
  const mismatch = entry.recorded !== null && entry.head !== entry.recorded;
  const staged = entry.recorded !== entry.committed;
  const label = rowLabel(entry, parent);
  return (
    <div
      class={
        "border-b border-line-soft px-2 py-2 " +
        (entry.path === selectedRepo.value ? "bg-row-head" : "hover:bg-row-hover")
      }
      style={{ paddingLeft: 4 + Math.min(depth, 8) * 16 }}
    >
      <div class="flex items-center gap-1">
        {expanded === undefined ? (
          <span class="size-5 shrink-0" />
        ) : (
          <button
            type="button"
            class="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded hover:bg-btn-hover focus:outline-1 focus:outline-focus"
            aria-expanded={expanded}
            aria-label={(expanded
              ? window.l10n.collapseRepository
              : window.l10n.expandRepository
            ).replace("{0}", label)}
            onClick={onToggle}
          >
            <ChevronDownIcon class={`size-3.5 ${expanded ? "" : "-rotate-90"}`} />
          </button>
        )}
        <button
          class="min-w-0 flex-1 cursor-pointer truncate text-left font-medium disabled:cursor-default"
          disabled={!entry.initialized}
          onClick={() => selectRepo(entry.path)}
          title={entry.path}
        >
          {label}
        </button>
        {parent && (
          <span class="shrink-0 text-xs text-muted">
            {entry.submodulePath ? window.l10n.submoduleTag : window.l10n.nestedRepoTag}
          </span>
        )}
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
      <p class="mt-1 flex items-center gap-1 truncate pl-6 text-xs text-muted">
        {entry.detached && <DetachedIcon class={BADGE_ICON} />}
        {entry.initialized
          ? entry.branch || `${window.l10n.detachedHead} ${entry.head?.slice(0, 8) ?? ""}`
          : window.l10n.submoduleUninitialized}
      </p>
      {entry.initialized && (
        <div class="mt-1 flex flex-wrap gap-x-2 gap-y-0.5 pl-6 text-xs">
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
          <AttentionBadges entry={entry} />
        </div>
      )}
      {mismatch && (
        <button
          class="mt-1 ml-6 cursor-pointer text-left text-xs text-git-modified hover:underline"
          disabled={!entry.initialized}
          onClick={() => openSubmodule(entry)}
          title={window.l10n.indexRevision.replace("{0}", entry.recorded ?? "")}
        >
          {window.l10n.submoduleMoved}
        </button>
      )}
      {staged && entry.submodulePath && (
        <button
          class="mt-1 ml-6 cursor-pointer text-left text-xs text-git-added hover:underline"
          disabled={!entry.initialized}
          onClick={() => openSubmodule(entry, true)}
          title={window.l10n.parentRevision.replace("{0}", entry.committed ?? "∅")}
        >
          {window.l10n.submoduleStaged}
        </button>
      )}
      {entry.error && <p class="mt-1 break-words pl-6 text-xs text-git-deleted">{entry.error}</p>}
    </div>
  );
}

const TOTAL_LABELS = {
  attention: "workspaceNeedAttention",
  unpushed: "workspaceUnpushed",
  behind: "workspaceBehind",
  conflicted: "workspaceConflicted",
  changes: "workspaceWithChanges"
} as const;

/**
 * The totals of the repositories the text filter matches. Each one narrows the tree to its
 * repositories, and pressing it again shows them all; a total of none is left out unless chosen.
 */
function OverviewStrip({ totals }: { totals: Record<WorkspaceFilter, number> }) {
  const chosen = workspaceFilter.value;
  const shown = WORKSPACE_FILTERS.filter((filter) => totals[filter] > 0 || filter === chosen);
  return (
    <div role="group" aria-label={window.l10n.workspaceTotals} class="flex flex-wrap gap-1">
      {shown.length === 0 && <p class="text-xs text-muted">{window.l10n.workspaceAllClear}</p>}
      {shown.map((filter) => (
        <button
          key={filter}
          type="button"
          data-total={filter}
          aria-pressed={filter === chosen}
          class={
            "cursor-pointer rounded-full border px-2 py-0.5 text-xs focus:outline-1 focus:outline-focus " +
            (filter === chosen
              ? "border-focus bg-row-head font-medium"
              : "border-line-soft hover:bg-btn-hover")
          }
          onClick={() => setWorkspaceFilter(filter === chosen ? null : filter)}
        >
          {(filter === "attention" && totals.attention === 1
            ? window.l10n.workspaceNeedsAttentionOne
            : window.l10n[TOTAL_LABELS[filter]]
          ).replace("{0}", String(totals[filter]))}
        </button>
      ))}
    </div>
  );
}

export function WorkspacePane() {
  const [filter, setFilter] = useState("");
  const [onlyChanged, setOnlyChanged] = useState(false);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(new Set());
  const query = useSettledRepositoryQuery<"workspace">({ kind: "workspace" });
  // The listing is the workspace's, whichever repository is selected, so the last one stays while
  // the listing asked for by a newly selected repository loads. Choosing a repository here must
  // not empty the pane for as long as every repository's status takes to read.
  const lastListing = useRef(query.data);
  if (query.data !== null || query.error !== null) {
    lastListing.current = query.data;
  }
  const listing = lastListing.current;
  const entries = listing?.entries ?? [];
  const byPath = new Map(entries.map((entry) => [entry.path, entry]));
  const status = workspaceFilter.value;
  // The totals count what the text filter matches; the bulk actions act on what every filter does.
  const named = entries.filter((entry) =>
    (entry.path + " " + entry.branch).toLowerCase().includes(filter.toLowerCase())
  );
  const matches = named.filter(
    (entry) => (!onlyChanged || changed(entry)) && (status === null || matchesFilter(entry, status))
  );
  const visible = new Set<string>();
  for (const entry of matches) {
    let cursor: WorkspaceEntry | undefined = entry;
    while (cursor && !visible.has(cursor.path)) {
      visible.add(cursor.path);
      cursor = cursor.parent ? byPath.get(cursor.parent) : undefined;
    }
  }
  // Each listed repository goes under its listed parent; the others start the tree.
  const children = new Map<string | null, WorkspaceEntry[]>();
  for (const entry of entries.filter((item) => visible.has(item.path))) {
    const parent = entry.parent !== null && byPath.has(entry.parent) ? entry.parent : null;
    children.set(parent, [...(children.get(parent) ?? []), entry]);
  }
  const below = (entry: WorkspaceEntry) => children.get(entry.path) ?? [];
  // While filtering, every match shows, whatever was collapsed.
  const filtering = onlyChanged || filter !== "" || status !== null;
  const toggle = (repo: string) => {
    const next = new Set(collapsed);
    if (!next.delete(repo)) {
      next.add(repo);
    }
    setCollapsed(next);
  };
  const rows: VNode[] = [];
  const addRows = (parent: string | null, depth: number) => {
    for (const entry of sortSiblings(children.get(parent) ?? [], workspaceOrder.value, below)) {
      const expanded =
        below(entry).length === 0 ? undefined : filtering || !collapsed.has(entry.path);
      rows.push(
        <RepoRow
          key={entry.path}
          entry={entry}
          parent={parent === null ? undefined : byPath.get(parent)}
          depth={depth}
          expanded={expanded}
          onToggle={() => toggle(entry.path)}
        />
      );
      if (expanded) {
        addRows(entry.path, depth + 1);
      }
    }
  };
  addRows(null, 0);
  const bulk = (operation: "fetch" | "pull" | "push") => (
    <Button
      disabled={workspaceBusy.value || matches.length === 0}
      onClick={() => openBulkAction(operation, matches)}
    >
      {
        window.l10n[
          operation === "fetch" ? "bulkFetch" : operation === "pull" ? "bulkPull" : "bulkPush"
        ]
      }
    </Button>
  );
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
        {listing && <OverviewStrip totals={workspaceTotals(named)} />}
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
        <Select
          aria-label={window.l10n.workspaceOrder}
          value={workspaceOrder.value}
          onChange={(value) => setWorkspaceOrder(value === "attention" ? "attention" : "name")}
          options={[
            { value: "name", label: window.l10n.workspaceOrderName },
            { value: "attention", label: window.l10n.workspaceOrderAttention }
          ]}
        />
        <div role="group" aria-label={window.l10n.bulkActions} class="flex flex-wrap gap-2">
          {bulk("fetch")}
          {bulk("pull")}
          {bulk("push")}
        </div>
        <Button onClick={openWorkspaceSync}>{window.l10n.workspaceSync}</Button>
      </div>
      <QueryStatus {...query} />
      {rows}
    </aside>
  );
}
