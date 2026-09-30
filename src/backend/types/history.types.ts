import type { GitCommitNode } from "./git.types";

export type HistoryFilter = {
  text: string;
  author: string;
  since: string;
  until: string;
  path: string;
  revision: string;
  follow: boolean;
};
export type HistoryEntry = GitCommitNode & {
  filePath?: string;
  previousPath?: string;
  change?: string;
};
export type HistoryPage = { entries: HistoryEntry[]; more: boolean };
export type ComparedFile = { before: string; after: string; status: string };
export type Comparison = {
  left: string;
  right: string;
  base: string;
  files: ComparedFile[];
  leftOnly: HistoryPage;
  rightOnly: HistoryPage;
};
export type ReflogEntry = { hash: string; selector: string; message: string; date: number };
export type WorkspaceEntry = {
  path: string;
  parent: string | null;
  submodulePath: string | null;
  recorded: string | null;
  committed: string | null;
  head: string | null;
  branch: string;
  dirty: number;
  ahead: number;
  behind: number;
  initialized: boolean;
  error: string | null;
};
export type FileRestorePlan = {
  source: string;
  sourcePath: string;
  destination: string;
  snapshot: string;
  dirty: boolean;
};
/** A file's contents before a restore replaced them, kept as a Git object for Undo. */
export type RestoreBackup = {
  /** Repository-relative path of the restored file. */
  path: string;
  blob: string;
  mode: number;
  symlink: boolean;
  /** Snapshot right after the restore; Undo refuses to replace later edits. */
  after: string;
};
export type StagedPlan = { head: string; tree: string; files: string[]; target: string };
export type BatchPlan = { head: string; branch: string; entries: HistoryEntry[] };

export type HistoryQuery =
  | {
      kind: "history";
      filter: HistoryFilter;
      offset: number;
      showRemoteBranches?: boolean;
      hiddenRemotes?: string[];
    }
  | { kind: "compare"; left: string; right: string; mergeBase: boolean }
  | { kind: "compareCommits"; left: string; right: string; side: "left" | "right"; offset: number }
  | { kind: "reflog"; offset: number }
  | { kind: "workspace" }
  | { kind: "restorePlan"; source: string; sourcePath: string; destination: string }
  | { kind: "stagedPlan"; target: string }
  | { kind: "batchPlan"; hashes: string[] };

export type HistoryQueryData =
  | { kind: "history"; page: HistoryPage }
  | { kind: "compare"; comparison: Comparison }
  | { kind: "compareCommits"; page: HistoryPage }
  | { kind: "reflog"; entries: ReflogEntry[]; more: boolean }
  | { kind: "workspace"; entries: WorkspaceEntry[] }
  | { kind: "restorePlan"; plan: FileRestorePlan }
  | { kind: "stagedPlan"; plan: StagedPlan }
  | { kind: "batchPlan"; plan: BatchPlan };

export type HistoryAction =
  | {
      kind: "submodule";
      path: string;
      operation: "initialize" | "sync" | "update";
      recorded: string;
    }
  | { kind: "restoreFile"; plan: FileRestorePlan }
  | { kind: "undoRestore"; backup: RestoreBackup }
  | { kind: "previewFileRestore"; plan: FileRestorePlan }
  | { kind: "fixup"; plan: StagedPlan }
  | { kind: "batch"; operation: "cherry-pick" | "revert"; plan: BatchPlan; mainline: number }
  | { kind: "recoverBranch"; hash: string; name: string }
  | {
      kind: "viewRangeFile";
      left: string | null;
      right: string | null;
      before: string;
      after: string;
    }
  | { kind: "viewHistoricalFile"; hash: string; path: string };
