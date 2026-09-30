import { computed, signal } from "@preact/signals";

import type {
  RepositoryAction,
  RepositoryQuery,
  RepositoryQueryData,
  SyncPlan
} from "@/backend/types";
import { sendRemoteAction } from "@/webview/lib/remote-actions";
import { repositoryRevision, requestPanelQuery } from "@/webview/lib/repository-actions";

export type WorkspaceJob = {
  repo: string;
  state: "queued" | "running" | "done" | "error";
  error: string | null;
  plan: SyncPlan | null;
  planError: string | null;
};
export const workspaceJobs = signal<WorkspaceJob[]>([]);
export const workspaceBusy = computed(() =>
  workspaceJobs.value.some((job) => job.state === "queued" || job.state === "running")
);
let sequence = 0;

/** Work belongs to the captured repository, even when its dialog is hidden. */
export function backgroundAction(repo: string, action: RepositoryAction): Promise<string | null> {
  return new Promise((resolve) => {
    sendRemoteAction(
      { command: "repositoryAction", requestId: `workspace-action-${++sequence}`, action },
      repo,
      window.l10n.runningGitAction,
      {
        background: true,
        otherRepo: true,
        mutates: true,
        onComplete: (error) => {
          repositoryRevision.value++;
          resolve(error);
        }
      }
    );
  });
}
export function backgroundQuery(
  repo: string,
  query: RepositoryQuery
): Promise<{ data: RepositoryQueryData | null; error: string | null }> {
  return new Promise((resolve) => {
    requestPanelQuery(query, (data, error) => resolve({ data, error }), repo, true);
  });
}

export async function fetchWorkspace(repos: string[]) {
  if (workspaceBusy.value) {
    return;
  }
  const queue = [...new Set(repos)];
  workspaceJobs.value = queue.map((repo) => ({
    repo,
    state: "queued",
    error: null,
    plan: null,
    planError: null
  }));
  const update = (repo: string, patch: Partial<WorkspaceJob>) => {
    workspaceJobs.value = workspaceJobs.value.map((job) =>
      job.repo === repo ? Object.assign({}, job, patch) : job
    );
  };
  async function worker() {
    for (let repo = queue.shift(); repo !== undefined; repo = queue.shift()) {
      update(repo, { state: "running" });
      // Two workers bound concurrent Git/network work; each repository is sequential.
      // eslint-disable-next-line no-await-in-loop
      const error = await backgroundAction(repo, { kind: "fetch", remote: null });
      if (error) {
        update(repo, { state: "error", error });
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      const result = await backgroundQuery(repo, { kind: "upstreamPlan" });
      update(repo, {
        state: "done",
        plan: result.data?.kind === "upstreamPlan" ? result.data.plan : null,
        planError: result.error
      });
    }
  }
  await Promise.all([worker(), worker()]);
}
