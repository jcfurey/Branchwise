import path from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { notReachedArgs } from "@/backend/queries/history";
import { gitDirectory, loadOperation, readOptional } from "@/backend/queries/repository";
import type { LostCommit, SafetyNetEntry, SafetyRecord, SafetyUndo } from "@/backend/types";

/**
 * Where the Safety Net keeps the old tips of the refs it records. Git keeps whatever these refs
 * reach, and the graph, the branch lists and the reflog leave the namespace out, since they read
 * only `--branches`, `--tags`, `--remotes` and the reflogs of HEAD and the branches.
 */
export const BACKUP_NAMESPACE = "refs/branchwise/backup/";

/** The most records the journal keeps; older ones and their backups are pruned. */
export const SAFETY_NET_LIMIT = 50;

/** How long a record is kept, in seconds: 30 days, Git's own default for unreachable reflogs. */
export const SAFETY_NET_AGE = 30 * 24 * 60 * 60;

/** How many lost commits are listed under one record. */
const LOST_PER_RECORD = 10;

/** How many lost commits are read in all, across every record. */
const LOST_LIMIT = 500;

/**
 * The repository's common Git directory, shared by all its worktrees like the refs are. A linked
 * worktree's own Git directory names it in its `commondir` file.
 */
async function commonDirectory(git: SimpleGit) {
  const directory = await gitDirectory(git);
  const common = await readOptional(path.join(directory, "commondir"));
  return common === null ? directory : path.resolve(directory, common.trim());
}

/**
 * The journal sits in the repository's Git directory, beside the refs it describes: it travels
 * with the repository rather than with one VS Code profile, every worktree shares it, and
 * deleting the repository deletes it.
 */
export async function safetyJournalFile(git: SimpleGit) {
  return path.join(await commonDirectory(git), "branchwise", "safety-net.json");
}

/**
 * The recorded actions, oldest first. A journal that is missing or cannot be read counts as
 * empty; the backup refs stay until they are pruned by age.
 */
export async function readSafetyJournal(git: SimpleGit): Promise<SafetyRecord[]> {
  const text = await readOptional(await safetyJournalFile(git));
  if (text === null) {
    return [];
  }
  try {
    const parsed = JSON.parse(text) as { records?: unknown };
    return Array.isArray(parsed.records) ? (parsed.records as SafetyRecord[]) : [];
  } catch {
    return [];
  }
}

/** The ref a backup keeps under, for the `index`th value of record `id`. */
export function backupRef(id: string, name: string) {
  return `${BACKUP_NAMESPACE}${id}/${name}`;
}

/** A ref's name as the graph shows it. */
export function shortRef(ref: string) {
  return ref.replace(/^refs\/(?:heads|tags|remotes)\//, "");
}

/** The localized name of a recorded action, such as "Hard Reset of main". */
export function safetyTitle(record: Pick<SafetyRecord, "kind" | "subject" | "detail">): string {
  const { subject, detail } = record;
  switch (record.kind) {
    case "softReset":
      return l10n.t("Soft Reset of {0}", subject);
    case "mixedReset":
      return l10n.t("Mixed Reset of {0}", subject);
    case "hardReset":
      return l10n.t("Hard Reset of {0}", subject);
    case "rebase":
      return l10n.t("Rebase of {0}", subject);
    case "interactiveRebase":
      return l10n.t("Interactive Rebase of {0}", subject);
    case "reword":
      return l10n.t("Message Edit on {0}", subject);
    case "amend":
      return l10n.t("Commit Amend on {0}", subject);
    case "absorb":
      return l10n.t("Absorb into {0}", subject);
    case "merge":
      return l10n.t("Merge into {0}", subject);
    case "cherryPick":
      return l10n.t("Cherry-Pick onto {0}", subject);
    case "revert":
      return l10n.t("Revert on {0}", subject);
    case "fastForward":
      return detail === ""
        ? l10n.t("Fast-Forward of {0}", subject)
        : l10n.t("Fast-Forward of {0} Branches", detail);
    case "deleteBranch":
      return l10n.t("Deletion of Branch {0}", subject);
    case "cleanup":
      return l10n.t("Deletion of {0} Merged Branches", subject);
    case "renameBranch":
      return l10n.t("Rename of Branch {0} to {1}", subject, detail);
    case "deleteTag":
      return l10n.t("Deletion of Tag {0}", subject);
    case "dropStash":
      return l10n.t("Drop of Stash {0}", subject);
    case "forcePush":
      return l10n.t("Force Push to {0}", subject);
    case "deleteRemoteBranch":
      return l10n.t("Deletion of Remote Branch {0}", subject);
  }
}

/**
 * How a record reads now. A pending record whose operation is no longer in progress ended
 * outside Branchwise, so what it changed is unknown.
 */
function currentState(record: SafetyRecord, operation: boolean) {
  return record.state === "pending" && !operation ? "unfinished" : record.state;
}

/**
 * The commits that only the Safety Net's backups still reach, by the record that keeps them. A
 * commit two records keep is listed under one of them.
 */
async function lostCommits(git: SimpleGit) {
  const byRecord = new Map<string, LostCommit[]>();
  const output = await git
    .raw([
      "log",
      "-z",
      "--source",
      "--date-order",
      `--max-count=${LOST_LIMIT}`,
      "--format=%H%x00%S%x00%ct%x00%s",
      `--glob=${BACKUP_NAMESPACE}`,
      ...(await notReachedArgs(git)),
      "--"
    ])
    // Without any backup there is nothing to walk.
    .catch(() => "");
  const fields = output.split("\0");
  for (let index = 0; index + 3 < fields.length; index += 4) {
    const source = fields[index + 1]!;
    if (!source.startsWith(BACKUP_NAMESPACE)) {
      continue;
    }
    const id = source.slice(BACKUP_NAMESPACE.length).split("/")[0]!;
    const list = byRecord.get(id) ?? [];
    list.push({
      hash: fields[index]!,
      subject: fields[index + 3]!,
      date: Number(fields[index + 2])
    });
    byRecord.set(id, list);
  }
  return byRecord;
}

/** The recorded actions, newest first, with the commits each one left unreachable. */
export async function loadSafetyNet(git: SimpleGit): Promise<SafetyNetEntry[]> {
  const [records, operation, lost] = await Promise.all([
    readSafetyJournal(git),
    loadOperation(git).catch(() => null),
    lostCommits(git)
  ]);
  // The records were just read from the journal, so they are completed in place.
  return records.toReversed().map((record) => {
    const state = currentState(record, operation !== null);
    const commits = lost.get(record.id) ?? [];
    return Object.assign(record, {
      state,
      title: safetyTitle(record),
      restorable: state === "done" && record.undoable,
      lost: commits.slice(0, LOST_PER_RECORD),
      moreLost: commits.length > LOST_PER_RECORD
    });
  });
}

/**
 * The newest action Undo can put back. Undone and record-only actions are passed over; an
 * unfinished one stops the search, since what came before it may since have changed.
 */
export async function loadSafetyUndo(git: SimpleGit): Promise<SafetyUndo | null> {
  const records = await readSafetyJournal(git);
  for (const record of records.toReversed()) {
    if (record.state === "undone" || (record.state === "done" && !record.undoable)) {
      continue;
    }
    return record.state === "done" ? { id: record.id, title: safetyTitle(record) } : null;
  }
  return null;
}
