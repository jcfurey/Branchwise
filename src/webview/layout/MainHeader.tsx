import { useLayoutEffect, useRef } from "preact/hooks";

import type { GitRepo } from "@/types";
import { ActivityIndicator, openActivity } from "@/webview/components/history/ActivityView";
import {
  openCompare,
  openFileHistory,
  openReflog
} from "@/webview/components/history/HistoryTools";
import {
  openCleanup,
  openFastForward,
  openWorkspaceSync
} from "@/webview/components/history/WorkflowTools";
import { openBisect } from "@/webview/components/repository/BisectView";
import { openRemotes } from "@/webview/components/repository/RemoteManager";
import { openStashes } from "@/webview/components/repository/StashManager";
import { openWorktrees } from "@/webview/components/repository/WorktreeManager";
import { Button } from "@/webview/components/ui/Button";
import { Dropdown } from "@/webview/components/ui/Dropdown";
import {
  BranchIcon,
  CompareIcon,
  EyeIcon,
  FetchIcon,
  GearIcon,
  LocateIcon,
  RefreshIcon,
  RepoIcon,
  ReposIcon,
  SearchIcon,
  SidebarIcon
} from "@/webview/components/ui/Icons";
import { SHOW_ALL_BRANCHES } from "@/webview/constants";
import {
  openContextMenu,
  openFormDialog,
  refresh,
  selectBranch,
  selectRepo,
  setBranchDisplay,
  setShowRemoteBranch
} from "@/webview/lib/actions";
import { focusSearch } from "@/webview/lib/focus";
import { jumpToHead, useHeadOutOfSight } from "@/webview/lib/jump-to-head";
import {
  activeTab,
  historyActive,
  refsVisible,
  searchVisible,
  selectedCommits,
  showTab,
  toggleRefs,
  toggleSearch,
  toggleWorkspace,
  workspaceVisible
} from "@/webview/lib/navigation";
import { openRemoteAction } from "@/webview/lib/remote-actions";
import { rpcClient } from "@/webview/lib/rpc/rpc-client";
import {
  branchDisplay,
  branchList,
  commitHead,
  contextMenu,
  selectedBranch,
  selectedRepo,
  showRemoteBranch
} from "@/webview/lib/stores";
import type { BranchDisplay, ContextMenuEntry } from "@/webview/types";

/** The context menu key of the Settings & Tools button. */
const TOOLS_MENU = "repository-tools";

/** Where the sticky parts of the page read the header's height. */
const HEIGHT_PROPERTY = "--main-header-height";

/** Long repository and branch names are cut short rather than widening the header. */
const PICKER_CLASS = "max-w-48";

/** The size of every toolbar icon. */
const ICON = "size-4";

/** A thin upright line between groups of toolbar controls. */
function Separator() {
  return <span aria-hidden="true" class="mx-1 h-4 w-px shrink-0 bg-line-soft" />;
}

/** The background of a toggle whose pane or row is open. */
const pressed = (open: boolean) => (open ? "bg-row-selected" : undefined);

/**
 * The views below the header, as a row of tabs. Arrow keys move between them, as in any tab
 * list, and the chosen one is the only tab stop.
 */
function ViewTabs() {
  const l10n = window.l10n;
  const tabs = [
    { id: "graph", label: l10n.tabGraph },
    { id: "reflog", label: l10n.tabReflog },
    { id: "statistics", label: l10n.tabStatistics }
  ] as const;
  const current = activeTab.value;
  return (
    <div
      role="tablist"
      aria-label={l10n.viewTabs}
      class="flex self-stretch"
      onKeyDown={(event) => {
        const step = { ArrowLeft: -1, ArrowRight: 1 }[event.key];
        if (step === undefined) {
          return;
        }
        event.preventDefault();
        // The event lets go of its target once it has been handled.
        const list = event.currentTarget;
        const at = tabs.findIndex((tab) => tab.id === current);
        const next = tabs[(at + step + tabs.length) % tabs.length]!;
        showTab(next.id);
        requestAnimationFrame(() =>
          list.querySelector<HTMLElement>(`[data-view-tab="${next.id}"]`)?.focus()
        );
      }}
    >
      {tabs.map((tab) => {
        const selected = tab.id === current;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            data-view-tab={tab.id}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            class={`-mb-px cursor-pointer border-b-2 px-2.5 py-1.5 font-medium focus-visible:outline-1 focus-visible:outline-focus ${
              selected ? "border-graph text-fg" : "border-transparent text-muted hover:text-fg"
            }`}
            onClick={() => showTab(tab.id)}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** A name for a selected repository the scan did not list: its last path segment. */
function repoLabel(path: string) {
  return path.split(/[/\\]/).findLast((segment) => segment !== "") ?? path;
}

function repoOptions(repos: Array<GitRepo>, selected: string | undefined) {
  const options = repos.map((repo) => ({ label: repo.name, value: repo.path }));
  if (selected !== undefined && !repos.some((repo) => repo.path === selected)) {
    options.push({ label: repoLabel(selected), value: selected });
  }
  return options;
}

function askForFileHistory() {
  const l10n = window.l10n;
  openFormDialog({
    message: l10n.fileHistory,
    inputs: [{ kind: "text", label: l10n.historyPath, value: "" }],
    action: l10n.fileHistory,
    source: null,
    onSubmit: ([path]) => {
      // A blank path would only clear the current search.
      if (path.trim() !== "") {
        openFileHistory(path);
      }
    }
  });
}

/** The Settings & Tools entries, built when the menu opens so the check mark is current. */
function toolsMenu(): Array<ContextMenuEntry> {
  const l10n = window.l10n;
  const remotesShown = showRemoteBranch.value;
  return [
    { title: l10n.manageRemotes, onClick: openRemotes },
    { title: l10n.stashes, onClick: openStashes },
    { title: l10n.worktrees, onClick: openWorktrees },
    { title: l10n.workspaceSync, onClick: openWorkspaceSync },
    { title: l10n.fastForwardTitle, onClick: openFastForward },
    { title: l10n.cleanupBranches, onClick: openCleanup },
    { title: l10n.bisectTitle, onClick: openBisect },
    null,
    { title: l10n.reflog, onClick: openReflog },
    { title: l10n.fileHistory, onClick: askForFileHistory },
    { title: l10n.operationActivity, onClick: openActivity },
    null,
    {
      title: (remotesShown ? "✓ " : "") + l10n.showRemoteBranches,
      onClick: () => setShowRemoteBranch(!remotesShown)
    },
    {
      title: l10n.gettingStarted,
      onClick: () => void rpcClient.request("walkthrough.open", null)
    },
    { title: l10n.learnMore, onClick: () => void rpcClient.request("docs.open", null) },
    { title: l10n.openSettings, onClick: () => void rpcClient.request("settings.open", null) }
  ];
}

/** Compare the first two selected commits, standing in HEAD for any that are missing. */
function compareSelection() {
  const [left, right] = selectedCommits.value;
  openCompare(left?.hash ?? "HEAD", right?.hash ?? "HEAD");
}

/** Publish the header's height while it is mounted, including every time it wraps. */
function useHeightProperty(header: { current: HTMLElement | null }) {
  useLayoutEffect(() => {
    const element = header.current;
    if (element === null) {
      return;
    }
    const style = document.documentElement.style;
    const measure = () => {
      style.setProperty(HEIGHT_PROPERTY, `${element.getBoundingClientRect().height}px`);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => {
      observer.disconnect();
      style.removeProperty(HEIGHT_PROPERTY);
    };
  }, []);
}

/**
 * The toolbar pinned to the top of the page: the pane toggles, the repository, branch and view
 * pickers, and the tools that act on the whole repository.
 */
export function MainHeader({ repos }: { repos: Array<GitRepo> }) {
  const header = useRef<HTMLElement>(null);
  useHeightProperty(header);

  const l10n = window.l10n;
  const repo = selectedRepo.value;
  const branches = branchList.value;
  const noRepo = repo === undefined;
  const refsOpen = refsVisible.value;
  const workspaceOpen = workspaceVisible.value;
  // A filter keeps the search row open even when its own toggle is off.
  const searchOpen = searchVisible.value || historyActive.value;
  const toolsOpen = contextMenu.value?.source === TOOLS_MENU;
  const headOutOfSight = useHeadOutOfSight();

  return (
    <header
      ref={header}
      class="sticky top-0 z-20 flex flex-wrap items-center gap-x-1 gap-y-0.5 border-b border-line-soft bg-editor px-2 text-ui"
    >
      <ViewTabs />
      <Separator />
      <Dropdown
        label={l10n.repo}
        icon={<RepoIcon class={ICON} />}
        class={PICKER_CLASS}
        options={repoOptions(repos, repo)}
        value={repo}
        onChange={selectRepo}
      />
      <Dropdown
        label={l10n.branch}
        icon={<BranchIcon class={ICON} />}
        class={PICKER_CLASS}
        disabled={branches === undefined}
        options={[
          { label: l10n.showAll, value: SHOW_ALL_BRANCHES },
          ...(branches ?? []).map((branch) => ({
            label: branch.replace(/^remotes\//, ""),
            value: branch
          }))
        ]}
        value={selectedBranch.value}
        onChange={selectBranch}
      />
      <Dropdown
        label={l10n.branchDisplay}
        icon={<EyeIcon class={ICON} />}
        class={PICKER_CLASS}
        // Emphasis needs a branch, so the modes wait for a list with one in it.
        disabled={branches === undefined || branches.length === 0}
        options={[
          { label: l10n.filterToBranch, value: "filter" },
          { label: l10n.focusDirectHistory, value: "focus" },
          { label: l10n.focusAllAncestors, value: "ancestors" }
        ]}
        value={branchDisplay.value}
        onChange={(value) => setBranchDisplay(value as BranchDisplay)}
      />
      <div class="ml-auto flex items-center gap-0.5 py-1">
        <ActivityIndicator />
        <Button
          variant="ghost"
          aria-label={l10n.historySearch}
          title={l10n.historySearch}
          aria-expanded={searchOpen}
          class={pressed(searchOpen)}
          onClick={() => {
            // Only a row opened by its toggle can be closed by it; a filter keeps it open.
            if (searchVisible.value && !historyActive.value) {
              toggleSearch();
            } else {
              focusSearch();
            }
          }}
        >
          <SearchIcon class={ICON} />
        </Button>
        <Button
          aria-label={l10n.jumpToHead}
          title={headOutOfSight ? l10n.jumpToHeadOutOfSight : l10n.jumpToHead}
          // Stands out while the checked-out commit is off the screen.
          variant={headOutOfSight ? "primary" : "ghost"}
          class={headOutOfSight ? "px-1.5" : undefined}
          disabled={noRepo || commitHead.value === null}
          onClick={jumpToHead}
        >
          <LocateIcon class={ICON} />
        </Button>
        <Button variant="ghost" aria-label={l10n.refresh} title={l10n.refresh} onClick={refresh}>
          <RefreshIcon class={ICON} />
        </Button>
        <Button
          variant="ghost"
          aria-label={l10n.fetch}
          title={l10n.fetch}
          disabled={noRepo}
          onClick={() => openRemoteAction("fetch")}
        >
          <FetchIcon class={ICON} />
        </Button>
        <Button
          variant="ghost"
          aria-label={l10n.compareSubmit}
          title={l10n.compareSubmit}
          disabled={noRepo}
          onClick={compareSelection}
        >
          <CompareIcon class={ICON} />
        </Button>
        <Separator />
        <Button
          variant="ghost"
          aria-label={l10n.branchesPane}
          title={l10n.branchesPane}
          aria-expanded={refsOpen}
          class={pressed(refsOpen)}
          onClick={toggleRefs}
        >
          <SidebarIcon class={ICON} />
        </Button>
        <Button
          variant="ghost"
          aria-label={l10n.workspaceOverview}
          title={l10n.workspaceOverview}
          aria-expanded={workspaceOpen}
          class={pressed(workspaceOpen)}
          onClick={toggleWorkspace}
        >
          <ReposIcon class={ICON} />
        </Button>
        <Button
          variant="ghost"
          aria-label={l10n.settingsTools}
          title={l10n.settingsTools}
          aria-haspopup="menu"
          aria-expanded={toolsOpen}
          disabled={noRepo}
          onClick={(event) => openContextMenu(event, TOOLS_MENU, toolsMenu())}
        >
          <GearIcon class={ICON} />
        </Button>
      </div>
    </header>
  );
}
