import { useLayoutEffect, useRef } from "preact/hooks";

import type { GitRepo } from "@/types";
import { ActivityIndicator, openActivity } from "@/webview/components/history/ActivityView";
import {
  openCompare,
  openFileHistory,
  openReflog
} from "@/webview/components/history/HistoryTools";
import { openCleanup, openWorkspaceSync } from "@/webview/components/history/WorkflowTools";
import { openBisect } from "@/webview/components/repository/BisectView";
import { openRemotes } from "@/webview/components/repository/RemoteManager";
import { openStashes } from "@/webview/components/repository/StashManager";
import { openWorktrees } from "@/webview/components/repository/WorktreeManager";
import { Button } from "@/webview/components/ui/Button";
import { Dropdown } from "@/webview/components/ui/Dropdown";
import { GearIcon, RefreshIcon, SearchIcon } from "@/webview/components/ui/Icons";
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
import {
  historyActive,
  refsVisible,
  searchVisible,
  selectedCommits,
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
const PICKER_CLASS = "max-w-56";

/** The background of a toggle whose pane or row is open. */
const pressed = (open: boolean) => (open ? "bg-row-selected" : undefined);

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

  return (
    <header
      ref={header}
      class="sticky top-0 z-20 flex flex-wrap items-center gap-2 border-b border-line-soft bg-editor px-3 py-2 text-ui"
    >
      <Button aria-expanded={refsOpen} class={pressed(refsOpen)} onClick={toggleRefs}>
        {l10n.branchesPane}
      </Button>
      <Button
        aria-expanded={workspaceOpen}
        class={pressed(workspaceOpen)}
        onClick={toggleWorkspace}
      >
        {l10n.workspaceOverview}
      </Button>
      <Dropdown
        label={l10n.repo}
        class={PICKER_CLASS}
        options={repoOptions(repos, repo)}
        value={repo}
        onChange={selectRepo}
      />
      <Dropdown
        label={l10n.branch}
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
      <div class="ml-auto flex flex-wrap items-center gap-2">
        <ActivityIndicator />
        <Button
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
          <SearchIcon class="size-4" />
        </Button>
        <Button onClick={refresh}>
          <RefreshIcon class="size-3.5" />
          {l10n.refresh}
        </Button>
        <Button disabled={noRepo} onClick={() => openRemoteAction("fetch")}>
          {l10n.fetch}
        </Button>
        <Button disabled={noRepo} onClick={compareSelection}>
          {l10n.compareSubmit}
        </Button>
        <Button
          aria-label={l10n.settingsTools}
          title={l10n.settingsTools}
          aria-haspopup="menu"
          aria-expanded={toolsOpen}
          disabled={noRepo}
          onClick={(event) => openContextMenu(event, TOOLS_MENU, toolsMenu())}
        >
          <GearIcon class="size-4" />
        </Button>
      </div>
    </header>
  );
}
