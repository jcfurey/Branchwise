import { useLayoutEffect, useRef, useState } from "preact/hooks";

import type { FastForwardSkip, HistoryPage, SyncPlan, WorkspaceEntry } from "@/backend/types";
import { Button } from "@/webview/components/ui/Button";
import { Checkbox } from "@/webview/components/ui/Checkbox";
import { closeDialog, openContentDialog, selectRepo } from "@/webview/lib/actions";
import { focusHistory } from "@/webview/lib/navigation";
import {
  confirmRepositoryAction,
  repositoryRevision,
  sendRepositoryAction
} from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";
import { useRepositoryQuery } from "@/webview/lib/use-repository-query";
import {
  backgroundAction,
  fetchWorkspace,
  workspaceBusy,
  workspaceJobs
} from "@/webview/lib/workspace-actions";

import { openCompare } from "./HistoryTools";
import { PageControls, QueryStatus } from "./QueryControls";

export function CommitPage({ page, repo }: { page: HistoryPage; repo: string }) {
  return (
    <ul class="max-h-64 divide-y divide-line-soft overflow-auto">
      {page.entries.map((entry) => (
        <li key={entry.hash}>
          <button
            class="flex w-full cursor-pointer gap-2 p-2 text-left hover:bg-row-hover"
            title={entry.hash}
            onClick={() => {
              closeDialog();
              selectRepo(repo);
              focusHistory(entry.hash);
            }}
          >
            <code class="shrink-0">{entry.hash.slice(0, 8)}</code>
            <span class="min-w-0 break-words">{entry.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function CommitRange({
  repo,
  left,
  right,
  page,
  side,
  title
}: {
  repo: string;
  left: string;
  right: string;
  page: HistoryPage;
  side: "left" | "right";
  title: string;
}) {
  const [offset, setOffset] = useState(0);
  const query = useRepositoryQuery<"compareCommits">(
    offset ? { kind: "compareCommits", left, right, side, offset } : null,
    repo
  );
  const current = offset ? query.data?.page : page;
  return (
    <section class="min-w-0 rounded border border-line-soft p-2">
      <h3 class="font-semibold">{title}</h3>
      <QueryStatus {...query} />
      {current && (
        <>
          <CommitPage page={current} repo={repo} />
          <PageControls
            offset={offset}
            count={current.entries.length}
            more={current.more}
            change={setOffset}
          />
        </>
      )}
    </section>
  );
}

function SubmoduleView({
  entry,
  initialStaged
}: {
  entry: WorkspaceEntry;
  initialStaged: boolean;
}) {
  const [staged, setStaged] = useState(initialStaged);
  const query = useRepositoryQuery<"submodulePlan">(
    { kind: "submodulePlan", path: entry.submodulePath!, staged },
    entry.parent!
  );
  const data = query.data;
  return (
    <div class="space-y-3 text-left">
      <p class="break-all">
        {entry.parent} → {entry.submodulePath}
      </p>
      <Checkbox
        label={window.l10n.stagedPointer}
        checked={staged}
        onInput={(event) => setStaged(event.currentTarget.checked)}
      />
      <QueryStatus {...query} />
      {data && (
        <>
          <dl class="grid grid-cols-[auto_minmax(0,1fr)] gap-2 text-xs">
            <dt>{window.l10n.parentCommitLabel}</dt>
            <dd class="break-all font-mono">{data.plan.committed ?? "∅"}</dd>
            <dt>{window.l10n.parentIndexLabel}</dt>
            <dd class="break-all font-mono">{data.plan.recorded}</dd>
            <dt>{window.l10n.childCheckout}</dt>
            <dd class="break-all font-mono">{data.plan.head}</dd>
          </dl>
          <p class="text-muted">{window.l10n.pointerHint}</p>
          <div class="flex flex-wrap gap-2">
            <Button
              disabled={query.loading || data.plan.head === data.plan.recorded}
              onClick={() =>
                sendRepositoryAction(
                  { kind: "submodulePointer", operation: "stage", plan: data.plan },
                  entry.parent!
                )
              }
            >
              {window.l10n.stagePointer}
            </Button>
            <Button
              disabled={query.loading || data.plan.committed === data.plan.recorded}
              onClick={() =>
                sendRepositoryAction(
                  { kind: "submodulePointer", operation: "unstage", plan: data.plan },
                  entry.parent!
                )
              }
            >
              {window.l10n.unstagePointer}
            </Button>
            <Button
              onClick={() => {
                closeDialog();
                selectRepo(entry.parent!);
              }}
            >
              {window.l10n.parentCheckout}
            </Button>
            <Button
              onClick={() => {
                closeDialog();
                selectRepo(data.plan.child);
              }}
            >
              {window.l10n.childGraph}
            </Button>
          </div>
          {data.comparison ? (
            <>
              <div class="grid gap-3 md:grid-cols-2">
                <CommitRange
                  key={data.comparison.left + data.comparison.right + "left"}
                  repo={data.plan.child}
                  left={data.comparison.left}
                  right={data.comparison.right}
                  page={data.comparison.leftOnly}
                  side="left"
                  title={window.l10n.removedCommits}
                />
                <CommitRange
                  key={data.comparison.left + data.comparison.right + "right"}
                  repo={data.plan.child}
                  left={data.comparison.left}
                  right={data.comparison.right}
                  page={data.comparison.rightOnly}
                  side="right"
                  title={window.l10n.addedCommits}
                />
              </div>
              <Button
                onClick={() => {
                  const comparison = data.comparison!;
                  selectRepo(data.plan.child);
                  openCompare(comparison.left, comparison.right);
                }}
              >
                {window.l10n.compareRevisions}
              </Button>
            </>
          ) : (
            <p>{window.l10n.newPointer}</p>
          )}
        </>
      )}
    </div>
  );
}
export function openSubmodule(entry: WorkspaceEntry, staged = false) {
  openContentDialog(
    window.l10n.submoduleChanges,
    <SubmoduleView entry={entry} initialStaged={staged} />,
    true
  );
}

export type SyncOptions = { operation: "push" | "pull"; setUpstream: boolean; force: boolean };
export function SyncReview({
  plan,
  repo,
  options,
  onApply,
  onDone
}: {
  plan: SyncPlan;
  repo: string;
  options: SyncOptions;
  onApply?: () => void;
  /** Called once the push or pull it starts has succeeded. */
  onDone?: (() => void) | undefined;
}) {
  const [applying, setApplying] = useState(false);
  return (
    <div class="space-y-3 text-left">
      <p class="break-all">
        {repo}
        <br />
        <b>
          {plan.branch} ↔ {plan.remote}/{plan.remoteBranch}
        </b>
      </p>
      <p class="text-muted">{window.l10n.fetchedTipHint}</p>
      <p class="break-all font-mono text-xs">
        {plan.local} ↔ {plan.remoteHead ?? "∅"}
      </p>
      {!plan.remoteHead && <p>{window.l10n.noRemoteBranch}</p>}
      <div class="grid gap-3 md:grid-cols-2">
        {plan.remoteHead ? (
          <>
            <CommitRange
              repo={repo}
              left={plan.local}
              right={plan.remoteHead}
              page={plan.outgoing}
              side="left"
              title={`${window.l10n.outgoingCommits} (${plan.ahead})`}
            />
            <CommitRange
              repo={repo}
              left={plan.local}
              right={plan.remoteHead}
              page={plan.incoming}
              side="right"
              title={`${window.l10n.incomingCommits} (${plan.behind})`}
            />
          </>
        ) : (
          <section>
            <h3>
              {window.l10n.outgoingCommits} ({plan.ahead})
            </h3>
            <CommitPage repo={repo} page={plan.outgoing} />
            {plan.outgoing.more && (
              <Button
                onClick={() => {
                  closeDialog();
                  selectRepo(repo);
                  focusHistory(plan.local);
                }}
              >
                {window.l10n.showBranchHistory}
              </Button>
            )}
          </section>
        )}
      </div>
      {options.operation === "pull" && !plan.canFastForward && (
        <p role="status">{window.l10n.cannotFastForward}</p>
      )}
      {options.force && (
        <>
          <p class="text-git-modified">
            {window.l10n.forcePushConfirm
              .replace("{0}", plan.remoteBranch)
              .replace("{1}", plan.remote)
              .replace("{2}", plan.remoteHead?.slice(0, 12) ?? "∅")}
          </p>
          <p class="text-xs text-muted">{window.l10n.explainForcePush}</p>
        </>
      )}
      <Button
        variant="primary"
        disabled={
          applying ||
          (options.operation === "pull"
            ? !plan.canFastForward || plan.behind === 0
            : options.force && !plan.remoteHead)
        }
        onClick={() => {
          if (applying) {
            return;
          }
          setApplying(true);
          if (onApply) {
            onApply();
          } else {
            sendRepositoryAction(
              { kind: "sync", ...options, plan },
              repo,
              onDone && ((error) => error === null && onDone())
            );
          }
        }}
      >
        {options.operation === "push" ? window.l10n.pushBranch : window.l10n.fastForward}
      </Button>
    </div>
  );
}

function SyncView({
  repo,
  branch,
  remote,
  remoteBranch,
  options,
  onDone
}: {
  repo: string;
  branch: string;
  remote: string;
  remoteBranch: string;
  options: SyncOptions;
  onDone: (() => void) | undefined;
}) {
  const query = useRepositoryQuery<"syncPlan">(
    { kind: "syncPlan", branch, remote, remoteBranch },
    repo
  );
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const review = useRef<HTMLDivElement>(null);
  const focused = useRef<HTMLElement | null>(null);
  const plan = query.data?.plan;
  const planKey = plan ? plan.local + plan.remoteHead : "";
  // A changed plan is a new review, which replaces the control that had focus; keep focus in it.
  useLayoutEffect(() => {
    const lost = focused.current;
    const active = document.activeElement;
    if (lost !== null && !lost.isConnected && (active === null || active === document.body)) {
      review.current?.querySelector<HTMLElement>("button:not(:disabled)")?.focus();
    }
  }, [planKey]);
  return (
    <div class="space-y-3">
      <Button
        disabled={fetching}
        onClick={async () => {
          setFetching(true);
          setError(await backgroundAction(repo, { kind: "fetch", remote }));
          setFetching(false);
          repositoryRevision.value++;
        }}
      >
        {window.l10n.fetchPreview}
      </Button>
      <QueryStatus
        loading={fetching || (query.loading && plan === undefined)}
        error={error || query.error}
      />
      {/* A background refresh keeps the review, and the control with focus, on screen. */}
      {plan && !fetching && !error && !query.error && (
        <div
          ref={review}
          aria-busy={query.loading}
          onFocusIn={(event) => (focused.current = event.target as HTMLElement)}
        >
          <SyncReview key={planKey} plan={plan} repo={repo} options={options} onDone={onDone} />
        </div>
      )}
    </div>
  );
}
/** Review a push or a fast-forward pull, then run it; `onDone` hears that it succeeded. */
export function openSync(
  repo: string,
  branch: string,
  remote: string,
  remoteBranch: string,
  options: SyncOptions,
  onDone?: () => void
) {
  openContentDialog(
    window.l10n.syncPreview,
    <SyncView
      repo={repo}
      branch={branch}
      remote={remote}
      remoteBranch={remoteBranch}
      options={options}
      onDone={onDone}
    />,
    true
  );
}

function WorkspaceSyncView() {
  const query = useRepositoryQuery<"workspace">({ kind: "workspace" });
  const entries = (query.data?.entries ?? []).filter((entry) => entry.initialized && !entry.error);
  const [selection, setSelection] = useState<string[]>([]);
  const selected = selection.filter((repo) => entries.some((entry) => entry.path === repo));
  const jobs = workspaceJobs.value;
  const [review, setReview] = useState<string | null>(null);
  const job = jobs.find((item) => item.repo === review);
  return (
    <div class="space-y-3 text-left">
      <p class="text-muted">{window.l10n.workspaceSyncHint}</p>
      <QueryStatus {...query} />
      <Checkbox
        label={window.l10n.selectAllRepos}
        checked={entries.length > 0 && selected.length === entries.length}
        onInput={(event) =>
          setSelection(event.currentTarget.checked ? entries.map((entry) => entry.path) : [])
        }
      />
      <div class="max-h-52 space-y-2 overflow-auto">
        {entries.map((entry) => (
          <div key={entry.path} class="break-all">
            <Checkbox
              label={entry.path}
              checked={selected.includes(entry.path)}
              onInput={(event) =>
                setSelection(
                  event.currentTarget.checked
                    ? [...selected, entry.path]
                    : selected.filter((repo) => repo !== entry.path)
                )
              }
            />
          </div>
        ))}
      </div>
      <div class="flex flex-wrap gap-2">
        <Button
          disabled={workspaceBusy.value || !selected.length}
          onClick={() => {
            setReview(null);
            void fetchWorkspace(selected);
          }}
        >
          {window.l10n.fetchSelected}
        </Button>
        <Button
          disabled={workspaceBusy.value || !entries.length}
          onClick={() => {
            setReview(null);
            void fetchWorkspace(entries.map((entry) => entry.path));
          }}
        >
          {window.l10n.fetchAllRepos}
        </Button>
      </div>
      <ul class="divide-y divide-line-soft" aria-live="polite">
        {jobs.map((item) => (
          <li key={item.repo} class="space-y-1 py-2">
            <p class="break-all">{item.repo}</p>
            <p>
              {
                window.l10n[
                  item.state === "queued"
                    ? "queued"
                    : item.state === "running"
                      ? "activityRunning"
                      : item.state === "error"
                        ? "activityFailed"
                        : "activitySucceeded"
                ]
              }
            </p>
            {(item.error || item.planError) && (
              <p class="break-words text-xs text-muted">{item.error || item.planError}</p>
            )}
            {item.plan && (
              <Button disabled={workspaceBusy.value} onClick={() => setReview(item.repo)}>
                {window.l10n.reviewUpdate} ↑{item.plan.ahead} ↓{item.plan.behind}
              </Button>
            )}
          </li>
        ))}
      </ul>
      {job?.plan && (
        <SyncReview
          key={job.repo + job.plan.local + job.plan.remoteHead}
          repo={job.repo}
          plan={job.plan}
          options={{ operation: "pull", force: false, setUpstream: false }}
          onApply={async () => {
            workspaceJobs.value = workspaceJobs.value.map((item) =>
              item.repo === job.repo ? Object.assign({}, item, { state: "running" as const }) : item
            );
            const error = await backgroundAction(job.repo, {
              kind: "sync",
              operation: "pull",
              force: false,
              setUpstream: false,
              plan: job.plan!
            });
            workspaceJobs.value = workspaceJobs.value.map((item) =>
              item.repo === job.repo
                ? Object.assign({}, item, {
                    error,
                    state: error ? ("error" as const) : ("done" as const),
                    plan: null
                  })
                : item
            );
            setReview(null);
          }}
        />
      )}
    </div>
  );
}
export function openWorkspaceSync() {
  openContentDialog(window.l10n.workspaceSync, <WorkspaceSyncView />, true);
}

function CleanupView() {
  const query = useRepositoryQuery<"cleanupPlan">({ kind: "cleanupPlan" });
  const [selected, setSelected] = useState<string[]>([]);
  const plan = query.data?.plan;
  return (
    <div class="space-y-3 text-left">
      <p>{window.l10n.cleanupHint}</p>
      <QueryStatus {...query} />
      {plan && (
        <>
          <code class="break-all text-xs">{plan.base}</code>
          {!plan.branches.length && <p>{window.l10n.noMergedBranches}</p>}
          <ul class="space-y-2">
            {plan.branches.map((branch) => (
              <li key={branch.name}>
                <Checkbox
                  label={`${branch.name} · ${branch.hash.slice(0, 12)}`}
                  checked={selected.includes(branch.name)}
                  onInput={(event) =>
                    setSelected(
                      event.currentTarget.checked
                        ? [...selected, branch.name]
                        : selected.filter((name) => name !== branch.name)
                    )
                  }
                />
              </li>
            ))}
          </ul>
          <Button
            disabled={
              query.loading || !plan.branches.some((branch) => selected.includes(branch.name))
            }
            onClick={() => {
              const branches = plan.branches.filter((branch) => selected.includes(branch.name));
              confirmRepositoryAction(
                <>
                  {window.l10n.deleteSelectedBranches}
                  <ul>
                    {branches.map((branch) => (
                      <li key={branch.name}>
                        {branch.name} · {branch.hash.slice(0, 12)}
                      </li>
                    ))}
                  </ul>
                </>,
                window.l10n.deleteSelectedBranches,
                { kind: "cleanup", plan: { ...plan, branches } }
              );
            }}
          >
            {window.l10n.deleteSelectedBranches}
          </Button>
        </>
      )}
    </div>
  );
}
export function openCleanup() {
  openContentDialog(window.l10n.cleanupBranches, <CleanupView />);
}

function skipReason(skip: FastForwardSkip) {
  const l10n = window.l10n;
  const text = {
    diverged: l10n.fastForwardDiverged,
    worktree: l10n.fastForwardWorktree,
    uncommitted: l10n.fastForwardUncommitted
  }[skip.reason];
  // A function replacement inserts the name as written, even when it contains `$`.
  return text.replace("{0}", () => skip.name);
}

/**
 * The branches that can move up to their upstream, all chosen at first, and the ones that
 * cannot, with why. Fetching refreshes the list; the update runs here, so the dialog stays to
 * show what is left.
 */
function FastForwardView({ repo }: { repo: string }) {
  const l10n = window.l10n;
  const query = useRepositoryQuery<"fastForwardPlan">({ kind: "fastForwardPlan" }, repo);
  const [excluded, setExcluded] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [moved, setMoved] = useState<number | null>(null);
  const plan = query.data?.plan;
  const chosen = plan?.branches.filter((branch) => !excluded.includes(branch.name)) ?? [];
  const run = async (action: Parameters<typeof backgroundAction>[1], done?: number) => {
    setBusy(true);
    setMoved(null);
    const failure = await backgroundAction(repo, action);
    setError(failure);
    if (failure === null && done !== undefined) {
      setMoved(done);
    }
    setBusy(false);
  };
  return (
    <div class="space-y-3 text-left" data-fast-forward>
      <p>{l10n.fastForwardHint}</p>
      <Button disabled={busy} onClick={() => run({ kind: "fetch", remote: null })}>
        {l10n.fetchAllAndRefresh}
      </Button>
      <QueryStatus
        loading={busy || (query.loading && plan === undefined)}
        error={error || query.error}
      />
      {moved !== null && <p role="status">{l10n.fastForwardDone.replace("{0}", String(moved))}</p>}
      {plan && (
        <>
          {plan.branches.length === 0 && <p>{l10n.noFastForwards}</p>}
          <ul class="space-y-2">
            {plan.branches.map((branch) => (
              <li key={branch.name} data-fast-forward-branch={branch.name}>
                <Checkbox
                  label={l10n.fastForwardBehind
                    .replace("{0}", () => branch.name)
                    .replace("{1}", () => branch.upstream)
                    .replace("{2}", String(branch.behind))}
                  checked={!excluded.includes(branch.name)}
                  onInput={(event) =>
                    setExcluded(
                      event.currentTarget.checked
                        ? excluded.filter((name) => name !== branch.name)
                        : [...excluded, branch.name]
                    )
                  }
                />
              </li>
            ))}
          </ul>
          {plan.skipped.length > 0 && (
            <div>
              <p class="font-semibold">{l10n.fastForwardSkipped}</p>
              <ul class="list-disc pl-5 text-muted">
                {plan.skipped.map((skip) => (
                  <li key={skip.name} data-fast-forward-skipped={skip.reason}>
                    {skipReason(skip)}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <Button
            variant="primary"
            disabled={busy || query.loading || chosen.length === 0}
            onClick={() => run({ kind: "fastForward", branches: chosen }, chosen.length)}
          >
            {l10n.fastForwardRun.replace("{0}", String(chosen.length))}
          </Button>
        </>
      )}
    </div>
  );
}

export function openFastForward() {
  const repo = selectedRepo.value;
  if (repo !== undefined) {
    openContentDialog(window.l10n.fastForwardTitle, <FastForwardView repo={repo} />);
  }
}
