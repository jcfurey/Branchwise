import { useComputed } from "@preact/signals";
import type { ComponentChildren } from "preact";
import { useId, useState } from "preact/hooks";

import type { BranchDetails, GitRef, RefDetails, RemoteDetails } from "@/backend/types";
import { remoteForRef } from "@/backend/utils/remoteVisibility";
import { abbrevCommit } from "@/backend/utils/string";
import { BranchFocusBadge } from "@/webview/components/commit/BranchFocusBadge";
import { addRemote, remoteMenu } from "@/webview/components/repository/RemoteManager";
import {
  applyStash,
  inspectStash,
  saveStash,
  stashMenu
} from "@/webview/components/repository/StashManager";
import {
  BranchIcon,
  ChevronDownIcon,
  EyeClosedIcon,
  EyeIcon,
  KebabIcon,
  PlusIcon,
  RemoteIcon,
  StashIcon,
  TagIcon
} from "@/webview/components/ui/Icons";
import { INPUT_CLASS } from "@/webview/components/ui/Input";
import { Loading } from "@/webview/components/ui/Loading";
import { SHOW_ALL_BRANCHES } from "@/webview/constants";
import {
  openContextMenu,
  openFormDialog,
  runAction,
  selectBranch,
  setRemoteVisible,
  setShowRemoteBranch
} from "@/webview/lib/actions";
import { checkoutBranchAction, refMenu, refMenuSource } from "@/webview/lib/menus";
import { collapsedSections, focusHistory, toggleSection } from "@/webview/lib/navigation";
import { openRemoteAction } from "@/webview/lib/remote-actions";
import { repositoryState } from "@/webview/lib/repository-actions";
import {
  activeSource,
  commitHead,
  hiddenRemotes,
  selectedBranch,
  selectedRepo,
  showRemoteBranch
} from "@/webview/lib/stores";
import { PAGE_SIZE, usePage } from "@/webview/lib/use-page";
import { useRepositoryQuery } from "@/webview/lib/use-repository-query";
import type { ContextMenuEntry } from "@/webview/types";
import { format } from "@/webview/utils/format";

const ACTION_CLASS =
  "flex shrink-0 cursor-pointer items-center rounded px-1.5 py-0.5 text-xs hover:bg-btn-hover focus:outline-1 focus:outline-focus disabled:cursor-not-allowed disabled:opacity-50";
const ROW_ICON = "size-3.5 shrink-0 text-muted";
/** Rows each list renders before Show more, so thousands of refs stay responsive. */
export const REF_PAGE = PAGE_SIZE;

type RemoteGroup = { remote: string; details: RemoteDetails | undefined; branches: RefDetails[] };

/**
 * Groups remote-tracking refs under the remote that owns them. A ref whose
 * remote is no longer configured keeps its first path segment as the group.
 */
export function groupRemoteBranches(remotes: RemoteDetails[], refs: RefDetails[]): RemoteGroup[] {
  const names = remotes.map((remote) => remote.name).toSorted((a, b) => b.length - a.length);
  const groups = new Map<string, RemoteGroup>(
    remotes.map((remote) => [remote.name, { remote: remote.name, details: remote, branches: [] }])
  );
  for (const ref of refs) {
    const remote = remoteForRef(ref.name, names);
    let group = groups.get(remote);
    if (group === undefined) {
      group = { remote, details: undefined, branches: [] };
      groups.set(remote, group);
    }
    group.branches.push(ref);
  }
  return [...groups.values()];
}

function newBranch(head: string) {
  openFormDialog({
    message: format(
      window.l10n.newBranchFrom,
      <b>
        <i>{abbrevCommit(head)}</i>
      </b>
    ),
    inputs: [{ kind: "ref", value: "" }],
    action: window.l10n.dialogCreateBranchSubmit,
    source: null,
    onSubmit: ([branchName]) => runAction({ command: "createBranch", branchName, commitHash: head })
  });
}

function TrackingBadge({ branch }: { branch: BranchDetails }) {
  if (!branch.upstream || branch.gone || (branch.ahead === 0 && branch.behind === 0)) {
    return null;
  }
  return (
    <span class="shrink-0 text-xs text-muted">
      ↑{branch.ahead} ↓{branch.behind}
    </span>
  );
}

/**
 * One ref, stash or remote. The label selects it; the trailing controls and
 * the context menu carry its actions. `depth` indents rows under a remote.
 * `name` identifies the row in its controls' names, such as `refs/remotes/origin/main` for a
 * row labelled `main`, so rows with the same label stay distinct.
 */
function Row({
  source,
  label,
  name = label,
  icon,
  title,
  active = false,
  bold = false,
  dimmed = false,
  depth = 0,
  badge,
  actions,
  onSelect,
  menu
}: {
  source: string;
  label: string;
  name?: string;
  icon: ComponentChildren;
  title?: string;
  active?: boolean;
  bold?: boolean;
  dimmed?: boolean;
  depth?: number;
  badge?: ComponentChildren;
  actions?: ComponentChildren;
  onSelect: () => void;
  menu?: () => Array<ContextMenuEntry>;
}) {
  // Only the rows whose menu opens or closes re-render, however many refs are listed.
  const menuOpen = useComputed(() => activeSource.value === source).value;
  return (
    <div
      class={`group flex items-center gap-1 pr-1 ${
        active ? "bg-row-head" : menuOpen ? "bg-btn-hover" : "hover:bg-row-hover"
      } ${dimmed ? "text-muted" : ""}`}
      style={{ paddingLeft: 8 + depth * 12 }}
      onContextMenu={menu && ((event) => openContextMenu(event, source, menu()))}
    >
      <button
        type="button"
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 py-1 text-left focus:outline-1 focus:outline-focus"
        title={title ?? label}
        aria-current={active ? "true" : undefined}
        onClick={onSelect}
      >
        {icon}
        <span class={`truncate ${bold ? "font-bold" : ""}`}>{label}</span>
        {badge}
      </button>
      <span
        class={`flex shrink-0 items-center gap-0.5 group-hover:opacity-100 group-focus-within:opacity-100 ${
          menuOpen ? "" : "opacity-0"
        }`}
      >
        {actions}
        {menu && (
          <button
            type="button"
            class={ACTION_CLASS}
            aria-label={window.l10n.refActions.replace("{0}", name)}
            aria-haspopup="menu"
            onClick={(event) => openContextMenu(event, source, menu())}
          >
            <KebabIcon class="size-3.5" />
          </button>
        )}
      </span>
    </div>
  );
}

function Section({
  id,
  title,
  count,
  icon,
  trailing,
  depth = 0,
  children
}: {
  id: string;
  title: string;
  count?: number;
  icon?: ComponentChildren;
  trailing?: ComponentChildren;
  depth?: number;
  children: ComponentChildren;
}) {
  const collapsed = collapsedSections.value.has(id);
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} class={depth === 0 ? "border-b border-line-soft" : ""}>
      <div class="flex items-center gap-1 pr-1" style={{ paddingLeft: 4 + depth * 12 }}>
        <button
          type="button"
          class="flex min-w-0 flex-1 cursor-pointer items-center gap-1 py-1.5 text-left focus:outline-1 focus:outline-focus"
          aria-expanded={!collapsed}
          onClick={() => toggleSection(id)}
        >
          <ChevronDownIcon class={`size-3.5 shrink-0 ${collapsed ? "-rotate-90" : ""}`} />
          {icon}
          <span id={headingId} class={`truncate ${depth === 0 ? "font-semibold" : "font-medium"}`}>
            {title}
          </span>
          {count !== undefined && <span class="text-muted">{count}</span>}
        </button>
        {trailing}
      </div>
      {!collapsed && children}
    </section>
  );
}

/** The first `limit` items of a list, and a button that shows the next page. */
function RemoteBranches({
  group,
  shown
}: {
  group: { remote: string; branches: RefDetails[] };
  shown: boolean;
}) {
  const page = usePage(group.branches);
  return (
    <>
      {page.shown.map((ref) => {
        const gitRef: GitRef = { type: "remote", name: ref.name, hash: ref.hash };
        const value = "remotes/" + ref.name;
        return (
          <Row
            key={ref.name}
            depth={2}
            source={refMenuSource(gitRef)}
            label={ref.name.slice(group.remote.length + 1)}
            name={`refs/remotes/${ref.name}`}
            title={ref.name}
            icon={<BranchIcon class={ROW_ICON} />}
            dimmed={!shown}
            active={selectedBranch.value === value}
            badge={<BranchFocusBadge branch={value} />}
            onSelect={() => selectBranch(value)}
            menu={() => refMenu(gitRef, false)}
            actions={
              <button
                type="button"
                class={ACTION_CLASS}
                aria-label={`${window.l10n.checkout} refs/remotes/${ref.name}`}
                onClick={() => checkoutBranchAction(gitRef)}
              >
                {window.l10n.checkout}
              </button>
            }
          />
        );
      })}
      {page.more}
    </>
  );
}

function Hint({
  children,
  tone = "muted"
}: {
  children: ComponentChildren;
  tone?: "muted" | "error";
}) {
  return (
    <p class={`px-3 pb-2 text-xs ${tone === "error" ? "text-git-deleted" : "text-muted"}`}>
      {children}
    </p>
  );
}

export function RefsPane() {
  const [filter, setFilter] = useState("");
  const repo = selectedRepo.value;
  const state = repositoryState.value;
  const stashQuery = useRepositoryQuery<"stashes">({ kind: "stashes" });
  const stashes = stashQuery.data?.stashes ?? [];
  const needle = filter.trim().toLowerCase();
  const matches = (text: string) => needle === "" || text.toLowerCase().includes(needle);
  const branches = (state?.branches ?? []).filter((branch) => matches(branch.name));
  const groups = groupRemoteBranches(state?.remotes ?? [], state?.remoteBranches ?? []).flatMap(
    (group) => {
      const refs = group.branches.filter((ref) => matches(ref.name));
      return needle === "" || refs.length > 0 || matches(group.remote)
        ? [{ remote: group.remote, details: group.details, branches: refs }]
        : [];
    }
  );
  const tags = (state?.tags ?? []).filter((tag) => matches(tag.name));
  const visibleStashes = stashes.filter((stash) => matches(stash.message) || matches(stash.ref));
  const remotesShown = showRemoteBranch.value;
  const head = commitHead.value;
  const nothing =
    needle !== "" && branches.length + groups.length + tags.length + visibleStashes.length === 0;
  const branchPage = usePage(branches);
  const tagPage = usePage(tags);

  return (
    <nav
      aria-label={window.l10n.branchesPane}
      class="flex max-h-72 min-h-0 w-full flex-1 flex-col border-b border-line-soft bg-editor text-ui md:max-h-none md:border-b-0"
    >
      <div class="space-y-2 border-b border-line-soft p-3">
        <h2 class="font-semibold">{window.l10n.branchesPane}</h2>
        <input
          class={INPUT_CLASS}
          aria-label={window.l10n.refFilter}
          placeholder={window.l10n.refFilter}
          value={filter}
          onInput={(event) => setFilter(event.currentTarget.value)}
        />
      </div>
      {state === null ? (
        <Loading />
      ) : (
        <div class="min-h-0 flex-1 overflow-y-auto">
          <Section
            id="branches"
            title={window.l10n.localBranches}
            count={state.branches.length}
            icon={<BranchIcon class={ROW_ICON} />}
            trailing={
              <button
                type="button"
                class={ACTION_CLASS}
                aria-label={window.l10n.createBranchHere}
                title={window.l10n.createBranchHere}
                disabled={head === null}
                onClick={() => head !== null && newBranch(head)}
              >
                <PlusIcon class="size-3.5" />
              </button>
            }
          >
            {needle === "" && (
              <Row
                source="ref:all"
                label={window.l10n.showAll}
                icon={<span class="size-3.5 shrink-0" />}
                active={selectedBranch.value === SHOW_ALL_BRANCHES}
                onSelect={() => selectBranch(SHOW_ALL_BRANCHES)}
              />
            )}
            {branchPage.shown.map((branch) => {
              const gitRef: GitRef = { type: "head", name: branch.name, hash: branch.hash };
              const isHead = state.head === branch.name;
              const worktree = isHead
                ? undefined
                : state.worktrees.find((entry) => entry.branch === branch.name);
              return (
                <Row
                  key={branch.name}
                  source={refMenuSource(gitRef)}
                  label={branch.name}
                  name={`refs/heads/${branch.name}`}
                  bold={isHead}
                  icon={<BranchIcon class={ROW_ICON} />}
                  active={selectedBranch.value === branch.name}
                  title={[
                    branch.name,
                    branch.upstream,
                    branch.gone ? window.l10n.upstreamGone : null,
                    worktree ? window.l10n.worktreeAt.replace("{0}", worktree.path) : null
                  ]
                    .filter(Boolean)
                    .join("\n")}
                  badge={
                    <>
                      <BranchFocusBadge branch={branch.name} />
                      <TrackingBadge branch={branch} />
                      {worktree && <span class="shrink-0 text-xs">↗</span>}
                    </>
                  }
                  onSelect={() => selectBranch(branch.name)}
                  menu={() => refMenu(gitRef, isHead)}
                  actions={
                    !isHead &&
                    !worktree && (
                      <button
                        type="button"
                        class={ACTION_CLASS}
                        aria-label={`${window.l10n.checkout} refs/heads/${branch.name}`}
                        onClick={() => checkoutBranchAction(gitRef)}
                      >
                        {window.l10n.checkout}
                      </button>
                    )
                  }
                />
              );
            })}
            {branchPage.more}
          </Section>
          <Section
            id="remotes"
            title={window.l10n.manageRemotes}
            count={state.remoteBranches.length}
            icon={<RemoteIcon class={ROW_ICON} />}
            trailing={
              <>
                <button
                  type="button"
                  class={ACTION_CLASS}
                  aria-label={window.l10n.showRemoteBranches}
                  aria-pressed={remotesShown}
                  title={
                    remotesShown
                      ? window.l10n.remoteBranchesShown
                      : window.l10n.remoteBranchesHidden
                  }
                  onClick={() => setShowRemoteBranch(!remotesShown)}
                >
                  {remotesShown ? <EyeIcon class="size-3.5" /> : <EyeClosedIcon class="size-3.5" />}
                </button>
                <button
                  type="button"
                  class={ACTION_CLASS}
                  aria-label={window.l10n.addRemote}
                  title={window.l10n.addRemote}
                  disabled={repo === undefined}
                  onClick={() => repo !== undefined && addRemote(repo)}
                >
                  <PlusIcon class="size-3.5" />
                </button>
              </>
            }
          >
            {!remotesShown && <Hint>{window.l10n.hiddenFromGraph}</Hint>}
            {groups.map((group) => {
              const shown = remotesShown && !hiddenRemotes.value.includes(group.remote);
              return (
                <Section
                  key={group.remote}
                  id={`remote:${group.remote}`}
                  depth={1}
                  title={group.remote}
                  count={group.branches.length}
                  trailing={
                    <span class="flex shrink-0 items-center gap-0.5">
                      <button
                        type="button"
                        class={ACTION_CLASS}
                        aria-label={window.l10n.showRemoteInGraph.replace("{0}", group.remote)}
                        aria-pressed={shown}
                        title={(shown
                          ? window.l10n.hideRemoteFromGraph
                          : window.l10n.showRemoteInGraph
                        ).replace("{0}", group.remote)}
                        onClick={() => setRemoteVisible(group.remote, !shown)}
                      >
                        {shown ? <EyeIcon class="size-3.5" /> : <EyeClosedIcon class="size-3.5" />}
                      </button>
                      <button
                        type="button"
                        class={ACTION_CLASS}
                        onClick={() => openRemoteAction("fetch", "", group.remote + "/")}
                      >
                        {window.l10n.fetch}
                      </button>
                      {group.details !== undefined && repo !== undefined && (
                        <button
                          type="button"
                          class={ACTION_CLASS}
                          aria-label={window.l10n.remoteActions.replace("{0}", group.remote)}
                          aria-haspopup="menu"
                          onClick={(event) =>
                            openContextMenu(
                              event,
                              `remote:${group.remote}`,
                              remoteMenu(group.details!, repo)
                            )
                          }
                        >
                          <KebabIcon class="size-3.5" />
                        </button>
                      )}
                    </span>
                  }
                >
                  <RemoteBranches group={group} shown={shown} />
                </Section>
              );
            })}
          </Section>
          <Section
            id="tags"
            title={window.l10n.tags}
            count={state.tags.length}
            icon={<TagIcon class={ROW_ICON} />}
          >
            {state.tags.length === 0 && <Hint>{window.l10n.noTags}</Hint>}
            {tagPage.shown.map((tag) => {
              const gitRef: GitRef = { type: "tag", name: tag.name, hash: tag.hash };
              return (
                <Row
                  key={tag.name}
                  source={refMenuSource(gitRef)}
                  label={tag.name}
                  name={`refs/tags/${tag.name}`}
                  title={`${tag.name}\n${tag.hash}`}
                  icon={<TagIcon class={ROW_ICON} />}
                  onSelect={() => focusHistory(tag.hash)}
                  menu={() => refMenu(gitRef, false)}
                  actions={
                    <button
                      type="button"
                      class={ACTION_CLASS}
                      aria-label={`${window.l10n.showInGraph} refs/tags/${tag.name}`}
                      onClick={() => focusHistory(tag.hash)}
                    >
                      {window.l10n.showInGraph}
                    </button>
                  }
                />
              );
            })}
            {tagPage.more}
          </Section>
          <Section
            id="stashes"
            title={window.l10n.stashes}
            count={stashes.length}
            icon={<StashIcon class={ROW_ICON} />}
            trailing={
              <button
                type="button"
                class={ACTION_CLASS}
                aria-label={window.l10n.saveStash}
                title={window.l10n.saveStash}
                disabled={repo === undefined}
                onClick={() => repo !== undefined && saveStash(repo)}
              >
                <PlusIcon class="size-3.5" />
              </button>
            }
          >
            {stashQuery.error !== null && <Hint tone="error">{stashQuery.error}</Hint>}
            {stashes.length === 0 && !stashQuery.loading && stashQuery.error === null && (
              <Hint>{window.l10n.noStashes}</Hint>
            )}
            {repo !== undefined &&
              visibleStashes.map((stash) => (
                <Row
                  key={stash.hash}
                  source={`stash:${stash.hash}`}
                  label={stash.message}
                  name={stash.ref}
                  title={`${stash.ref}\n${stash.message}`}
                  icon={<StashIcon class={ROW_ICON} />}
                  badge={<span class="shrink-0 text-xs text-muted">{stash.ref}</span>}
                  onSelect={() => inspectStash(stash, repo)}
                  menu={() => stashMenu(stash, repo)}
                  actions={
                    <>
                      <button
                        type="button"
                        class={ACTION_CLASS}
                        title={window.l10n.applyStash}
                        aria-label={`${window.l10n.applyShort} ${stash.ref}`}
                        onClick={() => applyStash("apply", stash, repo)}
                      >
                        {window.l10n.applyShort}
                      </button>
                      <button
                        type="button"
                        class={ACTION_CLASS}
                        title={window.l10n.popStash}
                        aria-label={`${window.l10n.popShort} ${stash.ref}`}
                        onClick={() => applyStash("pop", stash, repo)}
                      >
                        {window.l10n.popShort}
                      </button>
                    </>
                  }
                />
              ))}
          </Section>
          {nothing && <p class="p-3 text-muted">{window.l10n.noMatchingRefs}</p>}
        </div>
      )}
    </nav>
  );
}
