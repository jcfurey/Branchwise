import type { ComponentChildren } from "preact";
import { useEffect, useState } from "preact/hooks";

import type { BulkSkipReason, BulkSyncPlan, WorkspaceEntry } from "@/backend/types";
import { Button } from "@/webview/components/ui/Button";
import { openContentDialog } from "@/webview/lib/actions";
import {
  backgroundQuery,
  fetchWorkspace,
  syncWorkspace,
  workspaceBusy,
  workspaceJobs
} from "@/webview/lib/workspace-actions";

import { QueryStatus } from "./QueryControls";

export type BulkOperation = "fetch" | "pull" | "push";

/**
 * One repository of a bulk action as the confirmation lists it: what will happen, or why
 * nothing will. `plan` is null for a fetch and for a repository skipped before asking it.
 */
type Review = {
  repo: string;
  plan: BulkSyncPlan | null;
  /** Why the whole repository is left alone, decided without reading it, or why reading failed. */
  skip: string | null;
};

/** Repositories that cannot be fetched from, pulled into or pushed from at all. */
function precheck(entry: WorkspaceEntry): string | null {
  if (!entry.initialized) {
    return window.l10n.bulkSkipUninitialized;
  }
  if (entry.error !== null) {
    return window.l10n.bulkSkipUnreadable;
  }
  return entry.remotes === 0 ? window.l10n.bulkSkipNoRemote : null;
}

function reasonText(reason: BulkSkipReason, operation: "pull" | "push") {
  switch (reason) {
    case "operation":
      return window.l10n.bulkSkipOperation;
    case "uncommitted":
      return window.l10n.bulkSkipUncommitted;
    case "detached":
      return window.l10n.bulkSkipDetached;
    case "noUpstream":
      return window.l10n.bulkSkipNoUpstream;
    case "upstreamGone":
      return window.l10n.bulkSkipUpstreamGone;
    case "diverged":
      return window.l10n.bulkSkipDiverged;
    case "upToDate":
      return operation === "pull"
        ? window.l10n.bulkSkipUpToDate
        : window.l10n.bulkSkipNothingToPush;
  }
}

/** What will happen in one repository, a line per branch. */
function steps(review: Review, operation: BulkOperation): ComponentChildren[] {
  if (review.skip !== null) {
    return [window.l10n.bulkSkipRepository.replace("{0}", review.skip)];
  }
  if (review.plan === null) {
    return [window.l10n.bulkFetchStep];
  }
  const { plan } = review;
  return [
    ...plan.syncs.map((sync) =>
      (operation === "pull" ? window.l10n.fastForwardBehind : window.l10n.bulkPushStep)
        .replace("{0}", sync.branch)
        .replace("{1}", `${sync.remote}/${sync.remoteBranch}`)
        .replace("{2}", String(operation === "pull" ? sync.behind : sync.ahead))
    ),
    ...plan.skipped.map(({ branch, reason }) => {
      const text = reasonText(reason, plan.operation);
      return branch === ""
        ? window.l10n.bulkSkipRepository.replace("{0}", text)
        : window.l10n.bulkSkipBranch.replace("{0}", branch).replace("{1}", text);
    })
  ];
}

/** Whether a repository has anything to run. */
function runnable(review: Review) {
  return review.skip === null && (review.plan === null || review.plan.syncs.length > 0);
}

/**
 * Ask each repository what a pull or push would do there, four at a time, as the workspace
 * overview reads them. A repository that cannot be asked is skipped with the reason.
 */
async function readPlans(entries: WorkspaceEntry[], operation: "pull" | "push") {
  const reviews = new Map<string, Review>();
  const queue = entries.filter((entry) => {
    const skip = precheck(entry);
    reviews.set(entry.path, { repo: entry.path, plan: null, skip });
    return skip === null;
  });
  async function worker() {
    for (let entry = queue.shift(); entry !== undefined; entry = queue.shift()) {
      // eslint-disable-next-line no-await-in-loop
      const { data, error } = await backgroundQuery(entry.path, {
        kind: "bulkSyncPlan",
        operation
      });
      reviews.set(entry.path, {
        repo: entry.path,
        plan: data?.kind === "bulkSyncPlan" ? data.plan : null,
        skip: data?.kind === "bulkSyncPlan" ? null : (error ?? window.l10n.bulkSkipUnreadable)
      });
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()]);
  return entries.map((entry) => reviews.get(entry.path)!);
}

function jobState(repo: string) {
  const job = workspaceJobs.value.find((item) => item.repo === repo);
  if (job === undefined) {
    return null;
  }
  return {
    label:
      window.l10n[
        job.state === "queued"
          ? "queued"
          : job.state === "running"
            ? "activityRunning"
            : job.state === "error"
              ? "activityFailed"
              : "activitySucceeded"
      ],
    error: job.error,
    failed: job.state === "error"
  };
}

export function BulkView({
  operation,
  entries
}: {
  operation: BulkOperation;
  entries: WorkspaceEntry[];
}) {
  const [reviews, setReviews] = useState<Review[] | null>(() =>
    operation === "fetch"
      ? entries.map((entry) => ({ repo: entry.path, plan: null, skip: precheck(entry) }))
      : null
  );
  const [started, setStarted] = useState(false);
  useEffect(() => {
    if (operation === "fetch") {
      return;
    }
    let live = true;
    void readPlans(entries, operation).then((result) => {
      if (live) {
        setReviews(result);
      }
    });
    return () => {
      live = false;
    };
  }, []);
  const ready = reviews?.filter(runnable) ?? [];
  const branches = ready.reduce((total, review) => total + (review.plan?.syncs.length ?? 0), 0);
  const busy = workspaceBusy.value;
  const run = () => {
    setStarted(true);
    void (operation === "fetch"
      ? fetchWorkspace(ready.map((review) => review.repo))
      : syncWorkspace(ready.map((review) => ({ repo: review.repo, plan: review.plan! }))));
  };
  const finished = started && !busy;
  const jobs = finished ? ready.map((review) => jobState(review.repo)) : [];
  return (
    <div class="space-y-3 text-left">
      <p class="text-muted">
        {
          window.l10n[
            operation === "fetch"
              ? "bulkFetchHint"
              : operation === "pull"
                ? "bulkPullHint"
                : "bulkPushHint"
          ]
        }
      </p>
      <QueryStatus loading={reviews === null} error={null} />
      {reviews !== null && (
        <>
          <ul class="max-h-80 divide-y divide-line-soft overflow-auto" aria-live="polite">
            {reviews.map((review) => {
              const state = started && runnable(review) ? jobState(review.repo) : null;
              return (
                <li key={review.repo} class="space-y-1 py-2" data-repo={review.repo}>
                  <p class="break-all font-medium">{review.repo}</p>
                  <ul class="space-y-0.5 text-xs">
                    {steps(review, operation).map((step, index) => (
                      <li key={index} class={runnable(review) ? "" : "text-muted"}>
                        {step}
                      </li>
                    ))}
                  </ul>
                  {started && (
                    <p class={`text-xs ${state?.failed ? "text-git-deleted" : ""}`}>
                      {state?.label ?? window.l10n.bulkSkipped}
                    </p>
                  )}
                  {state?.error && (
                    <p class="break-words text-xs text-git-deleted">{state.error}</p>
                  )}
                </li>
              );
            })}
          </ul>
          {ready.length === 0 && <p>{window.l10n.bulkNothingToDo}</p>}
          {finished ? (
            <p role="status" class="font-medium">
              {window.l10n.bulkSummary
                .replace("{0}", String(jobs.filter((job) => job && !job.failed).length))
                .replace("{1}", String(reviews.length - ready.length))
                .replace("{2}", String(jobs.filter((job) => job?.failed).length))}
            </p>
          ) : (
            <Button variant="primary" disabled={started || busy || !ready.length} onClick={run}>
              {(operation === "fetch"
                ? window.l10n.bulkRunFetch
                : operation === "pull"
                  ? window.l10n.fastForwardRun
                  : window.l10n.bulkRunPush
              ).replace("{0}", String(operation === "fetch" ? ready.length : branches))}
            </Button>
          )}
        </>
      )}
    </div>
  );
}

/** Confirm a fetch, pull or push of `entries`, listing what each repository will do. */
export function openBulkAction(operation: BulkOperation, entries: WorkspaceEntry[]) {
  openContentDialog(
    window.l10n[
      operation === "fetch" ? "bulkFetch" : operation === "pull" ? "bulkPull" : "bulkPush"
    ],
    <BulkView operation={operation} entries={entries} />,
    true
  );
}
