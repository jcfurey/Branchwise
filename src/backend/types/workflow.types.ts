import type { Comparison, HistoryPage } from "./history.types";

export type SubmodulePlan = {
  path: string;
  child: string;
  parentHead: string | null;
  recorded: string;
  committed: string | null;
  head: string;
};
export type SyncPlan = {
  branch: string;
  remote: string;
  remoteBranch: string;
  local: string;
  remoteHead: string | null;
  incoming: HistoryPage;
  outgoing: HistoryPage;
  ahead: number;
  behind: number;
  canFastForward: boolean;
};
export type CleanupBranch = { name: string; hash: string };
export type CleanupPlan = { base: string; branches: CleanupBranch[] };
/** A local branch whose upstream has moved ahead of it, and where it would move. */
export type FastForwardBranch = {
  name: string;
  upstream: string;
  /** The branch's commit now, which the update replaces only if it is still there. */
  from: string;
  to: string;
  behind: number;
  /** The branch checked out here, which moves with a merge instead of a ref update. */
  current: boolean;
};
/** A branch behind its upstream that cannot simply move forward, and why. */
export type FastForwardSkip = {
  name: string;
  upstream: string;
  reason: "diverged" | "worktree" | "uncommitted";
};
export type FastForwardPlan = { branches: FastForwardBranch[]; skipped: FastForwardSkip[] };
export type BisectState = {
  id: string;
  original: string;
  head: string;
  subject: string;
  good: string[];
  bad: string;
  skipped: string[];
  remaining: number;
  firstBad: string | null;
  ambiguous: boolean;
  terms: { good: string; bad: string };
};
export type WorkflowQuery =
  | { kind: "submodulePlan"; path: string; staged: boolean }
  | { kind: "syncPlan"; branch: string; remote: string; remoteBranch: string }
  | { kind: "upstreamPlan" }
  | { kind: "cleanupPlan" }
  | { kind: "fastForwardPlan" }
  | { kind: "bisect" };
export type WorkflowQueryData =
  | { kind: "submodulePlan"; plan: SubmodulePlan; comparison: Comparison | null }
  | { kind: "syncPlan"; plan: SyncPlan }
  | { kind: "upstreamPlan"; plan: SyncPlan }
  | { kind: "cleanupPlan"; plan: CleanupPlan }
  | { kind: "fastForwardPlan"; plan: FastForwardPlan }
  | { kind: "bisect"; state: BisectState | null; head: string | null };
export type WorkflowAction =
  | { kind: "submodulePointer"; operation: "stage" | "unstage"; plan: SubmodulePlan }
  | { kind: "fetch"; remote: string | null }
  | {
      kind: "sync";
      operation: "push" | "pull";
      plan: SyncPlan;
      setUpstream: boolean;
      force: boolean;
    }
  | { kind: "cleanup"; plan: CleanupPlan }
  | { kind: "fastForward"; branches: FastForwardBranch[] }
  | { kind: "bisectStart"; good: string; bad: string; expectedHead: string }
  | { kind: "bisectMark"; state: BisectState; mark: "good" | "bad" | "skip" | "reset" };
