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
  | { kind: "bisect" };
export type WorkflowQueryData =
  | { kind: "submodulePlan"; plan: SubmodulePlan; comparison: Comparison | null }
  | { kind: "syncPlan"; plan: SyncPlan }
  | { kind: "upstreamPlan"; plan: SyncPlan }
  | { kind: "cleanupPlan"; plan: CleanupPlan }
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
  | { kind: "bisectStart"; good: string; bad: string; expectedHead: string }
  | { kind: "bisectMark"; state: BisectState; mark: "good" | "bad" | "skip" | "reset" };
