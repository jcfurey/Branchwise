import { mkdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { requireIdle } from "@/backend/actions/rebase";
import { loadOperation, loadStashes, loadWorktrees } from "@/backend/queries/repository";
import {
  BACKUP_NAMESPACE,
  backupRef,
  readSafetyJournal,
  SAFETY_NET_AGE,
  SAFETY_NET_LIMIT,
  safetyJournalFile,
  safetyTitle,
  shortRef
} from "@/backend/queries/safetyNet";
import type {
  ActionRequest,
  OperationKind,
  SafetyActionKind,
  SafetyRecord,
  SafetyRefChange
} from "@/backend/types";
import { normalizeRepoPath } from "@/backend/utils/repoPath";
import { readGitWithInput, runGit } from "@/backend/utils/runGit";

/** What a destructive action is about to change, worked out before it runs. */
type SafetyPlan = {
  kind: SafetyActionKind;
  /** What the title names; the checked-out branch when left out. */
  subject?: string;
  detail?: string;
  /** Full names of the refs the action may move, create or delete. */
  refs: string[];
  /** The action moves the checked-out branch, or a detached HEAD. */
  movesHead?: boolean;
  mode?: SafetyRecord["mode"];
  undoable?: boolean;
  /** The operation the action may leave stopped, such as a rebase on a conflict. */
  operation?: OperationKind;
  /** Keep the uncommitted changes the action discards: all of them, or only what is staged. */
  saveChanges?: "worktree" | "index";
  stash?: { hash: string; message: string };
  deletedBranches?: string[];
  /** A force push: the remote branch's old commit, by its remote-tracking name, and the source. */
  push?: { ref: string; old: string; source: string };
};

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** The checked-out branch as a full ref, or `null` for a detached or missing HEAD. */
async function headRef(git: SimpleGit) {
  const ref = (await git.raw(["symbolic-ref", "--quiet", "HEAD"]).catch(() => "")).trim();
  return ref === "" ? null : ref;
}

/** The objects `refs` point to now, unpeeled, so a tag keeps its tag object. Missing refs are left out. */
async function readRefs(git: SimpleGit, refs: string[]) {
  const values = new Map<string, string>();
  const named = refs.filter((ref) => ref !== "HEAD");
  if (named.length > 0) {
    // A pattern also matches the refs below it, so only exact names are taken. Many names are
    // read by namespace instead, which keeps the command line short.
    const patterns =
      named.length > 50
        ? [...new Set(named.map((ref) => ref.split("/").slice(0, 2).join("/") + "/"))]
        : named;
    const output = await git.raw([
      "for-each-ref",
      "--format=%(refname)%00%(objectname)",
      ...patterns
    ]);
    const wanted = new Set(named);
    for (const line of output.split("\n")) {
      const [ref = "", hash = ""] = line.split("\0");
      if (wanted.has(ref)) {
        values.set(ref, hash);
      }
    }
  }
  if (refs.includes("HEAD")) {
    const head = (
      await git.raw(["rev-parse", "--verify", "--quiet", "HEAD"]).catch(() => "")
    ).trim();
    if (head !== "") {
      values.set("HEAD", head);
    }
  }
  return values;
}

/** Apply `update-ref --stdin` instructions all together, or none of them. */
async function updateRefs(git: SimpleGit, lines: string[], message?: string) {
  if (lines.length === 0) {
    return;
  }
  await readGitWithInput(
    git,
    // Backups get no reflog of their own, so the Reflog tab never lists them.
    [
      "-c",
      "core.logAllRefUpdates=true",
      "update-ref",
      ...(message === undefined ? [] : ["-m", message]),
      "--stdin"
    ],
    lines.join("\n") + "\n"
  );
}

/** The configuration of branches about to be deleted, such as their upstream. */
async function branchConfig(git: SimpleGit, branches: string[]) {
  const output = await git.raw(["config", "--null", "--get-regexp", "^branch\\."]).catch(() => "");
  const entries: Array<[string, string]> = [];
  for (const item of output.split("\0")) {
    const newline = item.indexOf("\n");
    const key = newline < 0 ? item : item.slice(0, newline);
    const value = newline < 0 ? "" : item.slice(newline + 1);
    if (
      branches.some((branch) => {
        const prefix = `branch.${branch}.`;
        return key.startsWith(prefix) && !key.slice(prefix.length).includes(".");
      })
    ) {
      entries.push([key, value]);
    }
  }
  return entries;
}

/**
 * Run a Git command that writes a commit object. Without a configured identity Git refuses, so
 * the backup is then signed with a placeholder rather than refusing the user's action.
 */
async function writeCommit(git: SimpleGit, args: string[]) {
  try {
    return (await runGit(git, args)).trim();
  } catch {
    const identity = ["-c", "user.name=Branchwise", "-c", "user.email=branchwise@localhost"];
    return (await runGit(git, [...identity, ...args])).trim();
  }
}

/**
 * Keep what a reset is about to discard, as a commit nothing else needs: for a hard reset the
 * staged and unstaged changes to tracked files, as `git stash create` records them; for a mixed
 * reset the staged files, as a commit of the index's tree. `null` when there is nothing to keep,
 * or the index holds conflicts and cannot be written as a tree.
 */
async function saveChanges(git: SimpleGit, what: "worktree" | "index") {
  if (what === "worktree") {
    return (await writeCommit(git, ["stash", "create"])) || null;
  }
  const staged = await git.raw(["diff", "--cached", "--name-only", "-z"]).catch(() => "");
  if (staged === "") {
    return null;
  }
  const tree = (await git.raw(["write-tree"]).catch(() => "")).trim();
  if (tree === "") {
    return null;
  }
  return writeCommit(git, [
    "commit-tree",
    "-p",
    "HEAD",
    "-m",
    "Branchwise: staged changes before a mixed reset",
    tree
  ]);
}

/** A name for HEAD's branch in a title, or `HEAD` when detached. */
const headName = (head: string | null) => (head === null ? "HEAD" : shortRef(head));

/** An action that moves the checked-out branch, and may stop part way in `operation`. */
function onHead(kind: SafetyActionKind, operation?: OperationKind): SafetyPlan {
  return { kind, refs: [], movesHead: true, ...(operation === undefined ? {} : { operation }) };
}

/** What `request` would change that Undo must be able to put back, or `null` for a safe action. */
function safetyPlan(request: ActionRequest): SafetyPlan | null {
  switch (request.command) {
    case "resetToCommit": {
      const mode = request.resetMode;
      if (mode === "hard") {
        return { ...onHead("hardReset"), saveChanges: "worktree" };
      }
      return mode === "soft"
        ? { ...onHead("softReset"), mode }
        : { ...onHead("mixedReset"), mode, saveChanges: "index" };
    }
    case "mergeBranch":
    case "mergeCommit":
      return onHead("merge", "merge");
    case "cherrypickCommit":
      return onHead("cherryPick", "cherry-pick");
    case "revertCommit":
      return onHead("revert", "revert");
    case "deleteBranch":
      return {
        kind: "deleteBranch",
        subject: request.branchName,
        refs: [`refs/heads/${request.branchName}`],
        deletedBranches: [request.branchName]
      };
    case "deleteTag":
      return {
        kind: "deleteTag",
        subject: request.tagName,
        refs: [`refs/tags/${request.tagName}`]
      };
    case "renameBranch":
      return {
        kind: "renameBranch",
        subject: request.oldName,
        detail: request.newName,
        refs: [`refs/heads/${request.oldName}`, `refs/heads/${request.newName}`]
      };
    case "pushBranch":
      return request.expectedRemoteHash === undefined
        ? null
        : {
            kind: "forcePush",
            subject: `${request.remote}/${request.remoteBranch}`,
            refs: [],
            undoable: false,
            push: {
              ref: `refs/remotes/${request.remote}/${request.remoteBranch}`,
              old: request.expectedRemoteHash,
              source: `refs/heads/${request.branchName}`
            }
          };
    case "repositoryAction":
      break;
    default:
      return null;
  }
  const { action } = request;
  switch (action.kind) {
    case "rebase":
      return onHead("rebase", "rebase");
    case "interactiveRebase":
      return onHead("interactiveRebase", "rebase");
    case "reword":
      return { ...onHead("reword", "rebase"), mode: "soft" };
    case "amendCommit":
      // The staged changes went into the commit; moving the branch back leaves them staged.
      return { ...onHead("amend", "rebase"), mode: "soft" };
    case "absorb":
      // The fixups hold what was staged, and the index still does; moving back leaves it staged.
      return { ...onHead("absorb"), mode: "soft" };
    case "batch":
      return action.operation === "cherry-pick"
        ? onHead("cherryPick", "cherry-pick")
        : onHead("revert", "revert");
    case "fastForward": {
      const names = action.branches.map((branch) => branch.name);
      return {
        kind: "fastForward",
        subject: names.length === 1 ? names[0]! : "",
        detail: names.length === 1 ? "" : String(names.length),
        refs: names.map((name) => `refs/heads/${name}`),
        movesHead: action.branches.some((branch) => branch.current)
      };
    }
    case "cleanup": {
      const names = action.plan.branches.map((branch) => branch.name);
      return {
        kind: "cleanup",
        subject: String(names.length),
        refs: names.map((name) => `refs/heads/${name}`),
        deletedBranches: names
      };
    }
    case "stash":
      return action.operation === "drop"
        ? {
            kind: "dropStash",
            subject: action.stash.message,
            refs: [],
            stash: { hash: action.stash.hash, message: action.stash.message }
          }
        : null;
    case "sync":
      return action.operation === "push" && action.force && action.plan.remoteHead
        ? {
            kind: "forcePush",
            subject: `${action.plan.remote}/${action.plan.remoteBranch}`,
            refs: [],
            undoable: false,
            push: {
              ref: `refs/remotes/${action.plan.remote}/${action.plan.remoteBranch}`,
              old: action.plan.remoteHead,
              source: action.plan.local
            }
          }
        : null;
    case "deleteRemoteRef":
      return action.refType === "branch"
        ? {
            kind: "deleteRemoteBranch",
            subject: `${action.remote}/${action.name}`,
            refs: [`refs/remotes/${action.remote}/${action.name}`],
            undoable: false
          }
        : null;
    default:
      return null;
  }
}

/** The milliseconds a record or backup id starts with. */
const idTime = (id: string) => Number(id.split("-")[0]);

/** A new id, after every id the journal holds. */
function newId(records: SafetyRecord[]) {
  const now = Date.now();
  const last = records.at(-1);
  const lastTime = last === undefined ? 0 : idTime(last.id);
  if (now > lastTime) {
    return `${now}-0`;
  }
  return `${lastTime}-${Number(last!.id.split("-")[1] ?? 0) + 1}`;
}

/** Replace the journal in one step, so a reader never sees half of it. */
async function writeJournal(git: SimpleGit, records: SafetyRecord[]) {
  const file = await safetyJournalFile(git);
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ version: 1, records }, null, 1) + "\n");
  await rename(temporary, file);
}

/**
 * Keep the newest `SAFETY_NET_LIMIT` records of the last `SAFETY_NET_AGE` seconds and delete the
 * backups of the rest. A backup no record names, as after a lost journal, goes once it is as old.
 */
async function pruned(git: SimpleGit, records: SafetyRecord[]) {
  const oldest = Date.now() / 1000 - SAFETY_NET_AGE;
  const kept = records.filter((record) => record.date >= oldest).slice(-SAFETY_NET_LIMIT);
  const keptIds = new Set(kept.map((record) => record.id));
  const refs = await git.raw(["for-each-ref", "--format=%(refname)", BACKUP_NAMESPACE]);
  const stale = refs
    .split("\n")
    .filter((ref) => ref.startsWith(BACKUP_NAMESPACE))
    .filter((ref) => {
      const id = ref.slice(BACKUP_NAMESPACE.length).split("/")[0]!;
      return (
        !keptIds.has(id) &&
        (records.some((record) => record.id === id) || !(idTime(id) / 1000 >= oldest))
      );
    });
  await updateRefs(
    git,
    stale.map((ref) => `delete ${ref}`)
  );
  return kept;
}

/** Delete one record and its backups. */
async function dropRecord(git: SimpleGit, records: SafetyRecord[], id: string) {
  const refs = await git.raw(["for-each-ref", "--format=%(refname)", `${BACKUP_NAMESPACE}${id}/`]);
  await updateRefs(
    git,
    refs
      .split("\n")
      .filter(Boolean)
      .map((ref) => `delete ${ref}`)
  );
  await writeJournal(
    git,
    records.filter((record) => record.id !== id)
  );
}

/**
 * Write down what the action is about to replace, and keep each old value under a backup ref,
 * before anything changes. Records still pending when no operation is in progress were finished
 * or aborted elsewhere, so they can no longer be completed.
 */
async function openRecord(git: SimpleGit, plan: SafetyPlan): Promise<SafetyRecord> {
  const head = await headRef(git);
  const refs = [...new Set([...plan.refs, ...(plan.movesHead ? [head ?? "HEAD"] : [])])];
  const [values, records, operation] = await Promise.all([
    readRefs(git, refs),
    readSafetyJournal(git),
    loadOperation(git).catch(() => null)
  ]);
  const saved = plan.saveChanges === undefined ? null : await saveChanges(git, plan.saveChanges);
  const id = newId(records);
  const changes: SafetyRefChange[] = plan.push
    ? [{ ref: plan.push.ref, old: plan.push.old, new: plan.push.old }]
    : refs.map((ref) => ({ ref, old: values.get(ref) ?? null, new: values.get(ref) ?? null }));
  const record: SafetyRecord = {
    id,
    kind: plan.kind,
    subject: plan.subject ?? headName(head),
    detail: plan.detail ?? "",
    date: Math.floor(idTime(id) / 1000),
    head,
    mode: plan.mode ?? "keep",
    changes,
    saved,
    stash: plan.stash ?? null,
    config: plan.deletedBranches ? await branchConfig(git, plan.deletedBranches) : [],
    undoable: plan.undoable ?? true,
    state: "pending",
    operation: null
  };
  await updateRefs(git, [
    ...changes.flatMap((change, index) =>
      change.old === null ? [] : [`update ${backupRef(id, `old-${index}`)} ${change.old}`]
    ),
    ...(saved === null ? [] : [`update ${backupRef(id, "saved")} ${saved}`]),
    ...(plan.stash ? [`update ${backupRef(id, "stash")} ${plan.stash.hash}`] : [])
  ]);
  if (operation === null) {
    for (const item of records) {
      if (item.state === "pending") {
        item.state = "unfinished";
      }
    }
  }
  await writeJournal(git, await pruned(git, [...records, record]));
  return record;
}

/**
 * Write down what the action changed. A record of nothing is dropped, unless it keeps discarded
 * changes or a dropped stash. With `operation`, an action that stopped part way stays pending
 * until that operation is continued or aborted.
 */
async function settleRecord(
  git: SimpleGit,
  record: SafetyRecord,
  changes: SafetyRefChange[],
  operation: OperationKind | null
): Promise<SafetyRecord | null> {
  const records = await readSafetyJournal(git);
  const index = records.findIndex((item) => item.id === record.id);
  if (index < 0) {
    return null;
  }
  if (operation !== null) {
    records[index] = { ...record, state: "pending", operation };
    await writeJournal(git, records);
    return null;
  }
  // Discarded changes are restored on top of HEAD's commit, which Undo checks like a move.
  const kept = changes.filter(
    (change) =>
      change.old !== change.new || (record.saved !== null && change.ref === (record.head ?? "HEAD"))
  );
  if (kept.length === 0 && record.saved === null && record.stash === null) {
    await dropRecord(git, records, record.id);
    return null;
  }
  const done: SafetyRecord = { ...record, changes: kept, state: "done", operation: null };
  records[index] = done;
  await writeJournal(git, records);
  return done;
}

/** Record `record`'s outcome once its action has finished, failed, or stopped part way. */
async function closeRecord(
  git: SimpleGit,
  record: SafetyRecord,
  plan: SafetyPlan,
  succeeded: boolean
) {
  if (!succeeded && plan.operation !== undefined) {
    const operation = await loadOperation(git);
    if (operation?.kind === plan.operation) {
      return settleRecord(git, record, record.changes, operation.kind);
    }
  }
  if (plan.push !== undefined) {
    const pushed = succeeded
      ? (await git.raw(["rev-parse", "--verify", "--end-of-options", plan.push.source])).trim()
      : plan.push.old;
    return settleRecord(git, record, [{ ...record.changes[0]!, new: pushed }], null);
  }
  if (record.stash !== null) {
    const dropped =
      succeeded && !(await loadStashes(git)).some((stash) => stash.hash === record.stash!.hash);
    if (!dropped) {
      await dropRecord(git, await readSafetyJournal(git), record.id);
      return null;
    }
  }
  return settleRecord(git, record, await currentValues(git, record.changes), null);
}

/** `changes` with each ref's value now as its new value. */
async function currentValues(git: SimpleGit, changes: SafetyRefChange[]) {
  const values = await readRefs(
    git,
    changes.map((change) => change.ref)
  );
  return changes.map(({ ref, old }) => ({ ref, old, new: values.get(ref) ?? null }));
}

/**
 * Once a stopped operation is continued to its end or aborted, complete the pending record of
 * the action that started it, if it is the newest one.
 */
async function settlePending(git: SimpleGit, kind: OperationKind) {
  if ((await loadOperation(git)) !== null) {
    return;
  }
  const last = (await readSafetyJournal(git)).at(-1);
  if (last?.state !== "pending" || last.operation !== kind) {
    return;
  }
  await settleRecord(git, last, await currentValues(git, last.changes), null);
}

/**
 * Run `work`, the backend side of `request`, inside the Safety Net: a destructive action is
 * recorded before it starts and refused if that fails, and the record is completed after it.
 * `git` must not be cancellable, so that a cancelled action is still written down.
 */
export async function recordedAction<T>(
  git: SimpleGit,
  request: ActionRequest,
  work: () => Promise<T>
): Promise<{ result: T; record: SafetyRecord | null }> {
  if (request.command === "repositoryAction" && request.action.kind === "recover") {
    const kind = request.action.operation.kind;
    try {
      return { result: await work(), record: null };
    } finally {
      await settlePending(git, kind).catch(() => {});
    }
  }
  const plan = safetyPlan(request);
  if (plan === null) {
    return { result: await work(), record: null };
  }
  let record: SafetyRecord;
  try {
    record = await openRecord(git, plan);
  } catch (error) {
    throw new Error(
      l10n.t(
        "Branchwise could not keep a backup of what this action replaces, so it did not run it: {0}",
        errorText(error)
      ),
      { cause: error }
    );
  }
  let result: T;
  try {
    result = await work();
  } catch (error) {
    await closeRecord(git, record, plan, false).catch(() => {});
    throw error;
  }
  // The action is done; a record that cannot be completed must not make it look failed.
  return { result, record: await closeRecord(git, record, plan, true).catch(() => null) };
}

/** A ref's name in a message: `HEAD`, a branch, a tag or a remote branch. */
const refLabel = (ref: string) => (ref === "HEAD" ? "HEAD" : shortRef(ref));

/** Move the checked-out branch, or a detached HEAD, to `target` as `mode` says. */
async function moveHead(git: SimpleGit, mode: SafetyRecord["mode"], target: string) {
  try {
    await runGit(git, ["reset", `--${mode}`, "--quiet", target, "--"]);
  } catch (error) {
    throw new Error(
      l10n.t(
        "Undo would overwrite uncommitted changes, so nothing was changed. Commit or stash them first. {0}",
        errorText(error)
      ),
      { cause: error }
    );
  }
}

/** Whether the index or the tracked files differ from HEAD; `staged` asks about the index only. */
async function hasChanges(git: SimpleGit, staged: boolean) {
  const output = await git.raw([
    "status",
    "--porcelain",
    "--untracked-files=no",
    "--ignore-submodules=none"
  ]);
  return output
    .split("\n")
    .filter(Boolean)
    .some((line) => (staged ? line[0] !== " " : true));
}

/** Refuse when a branch to restore is checked out in another worktree, whose files would not follow. */
async function requireNotCheckedOutElsewhere(git: SimpleGit, refs: string[]) {
  // A bare repository has no work tree of its own.
  const top = (await git.raw(["rev-parse", "--show-toplevel"]).catch(() => "")).trim();
  const here = top === "" ? null : normalizeRepoPath(top);
  for (const worktree of await loadWorktrees(git)) {
    if (
      !worktree.bare &&
      worktree.path !== here &&
      refs.includes(`refs/heads/${worktree.branch}`)
    ) {
      throw new Error(
        l10n.t(
          "{0} is checked out in the worktree at {1}. Undo it there, or check out another branch there first.",
          worktree.branch,
          worktree.path
        )
      );
    }
  }
}

/**
 * Put every ref of `record` back: the checked-out branch with `git reset` in the record's mode,
 * the others in one compare-and-swap transaction. Nothing changes when any of them has moved.
 */
async function restoreRefs(git: SimpleGit, record: SafetyRecord, title: string) {
  const head = await headRef(git);
  const values = await readRefs(
    git,
    record.changes.map((change) => change.ref)
  );
  for (const change of record.changes) {
    const current = values.get(change.ref) ?? null;
    if (current !== change.new || (change.ref === "HEAD" && head !== null)) {
      throw new Error(
        l10n.t(
          "{0} changed after the {1}, so Undo would discard later work. Nothing was changed.",
          refLabel(change.ref),
          title
        )
      );
    }
  }
  const checkedOut = record.changes.find((change) => change.ref === (head ?? "HEAD"));
  const others = record.changes.filter((change) => change !== checkedOut);
  await requireNotCheckedOutElsewhere(
    git,
    others.map((change) => change.ref)
  );
  if (record.saved !== null && checkedOut === undefined) {
    throw new Error(
      l10n.t(
        "Check out {0} first: Undo also brings back the uncommitted changes the reset discarded.",
        headName(record.head)
      )
    );
  }
  if (checkedOut !== undefined) {
    if (checkedOut.old === null || checkedOut.new === null) {
      throw new Error(
        l10n.t("Check out another branch first: Undo would delete {0}.", refLabel(checkedOut.ref))
      );
    }
    if (record.mode === "mixed" && (await hasChanges(git, true))) {
      throw new Error(
        l10n.t("Undo would unstage your staged changes. Commit or unstage them first.")
      );
    }
    if (record.saved !== null && record.mode === "keep" && (await hasChanges(git, false))) {
      throw new Error(
        l10n.t(
          "Commit or stash your changes first: Undo brings back the changes the reset discarded."
        )
      );
    }
    await moveHead(git, record.mode, checkedOut.old);
  }
  try {
    await updateRefs(
      git,
      others.map((change) =>
        change.new === null
          ? `create ${change.ref} ${change.old}`
          : change.old === null
            ? `delete ${change.ref} ${change.new}`
            : `update ${change.ref} ${change.old} ${change.new}`
      ),
      `branchwise: undo ${record.kind}`
    );
  } catch (error) {
    if (checkedOut !== undefined) {
      await moveHead(git, record.mode, checkedOut.new!).catch(() => {});
    }
    throw new Error(
      l10n.t("A ref changed while Undo ran, so nothing was changed: {0}", errorText(error)),
      { cause: error }
    );
  }
  // Deleting a branch also removed its upstream and other settings.
  for (const key of new Set(record.config.map(([name]) => name))) {
    // eslint-disable-next-line no-await-in-loop
    const current = await git.raw(["config", "--get-all", key]).catch(() => "");
    if (current.trim() === "") {
      for (const [name, value] of record.config) {
        if (name === key) {
          // eslint-disable-next-line no-await-in-loop
          await git.raw(["config", "--add", key, value]);
        }
      }
    }
  }
}

/** Rename the branch back, which also moves its reflog, its settings and HEAD if it is checked out. */
async function renameBack(git: SimpleGit, record: SafetyRecord, title: string) {
  const from = record.changes.find((change) => change.old !== null && change.new === null);
  const to = record.changes.find((change) => change.old === null && change.new !== null);
  if (from === undefined || to === undefined) {
    throw new Error(l10n.t("The Safety Net cannot tell how to undo this rename."));
  }
  const values = await readRefs(git, [from.ref, to.ref]);
  if (values.get(to.ref) !== to.new || values.has(from.ref)) {
    throw new Error(
      l10n.t(
        "{0} changed after the {1}, so Undo would discard later work. Nothing was changed.",
        refLabel(values.has(from.ref) ? from.ref : to.ref),
        title
      )
    );
  }
  await git.raw(["branch", "-m", "--", shortRef(to.ref), shortRef(from.ref)]);
}

/**
 * Put back what the recorded action `id` replaced. Whatever Undo replaces in turn is kept under
 * the record's backups too, so an Undo can itself be reversed from the reflog or the Safety Net.
 */
export async function undoSafetyRecord(git: SimpleGit, id: string) {
  await requireIdle(git);
  const records = await readSafetyJournal(git);
  const record = records.find((item) => item.id === id);
  if (record === undefined) {
    throw new Error(l10n.t("The Safety Net no longer keeps this action. Refresh the list."));
  }
  const title = safetyTitle(record);
  if (record.state === "undone") {
    throw new Error(l10n.t("The {0} was already undone.", title));
  }
  if (!record.undoable) {
    throw new Error(
      l10n.t(
        "Branchwise records the {0} but cannot undo it. Its previous commits stay listed in the Safety Net.",
        title
      )
    );
  }
  if (record.state !== "done") {
    throw new Error(
      l10n.t(
        "The {0} did not finish in Branchwise, so Undo cannot tell what it changed. Its previous commits stay listed in the Safety Net.",
        title
      )
    );
  }
  await updateRefs(
    git,
    record.changes.flatMap((change, index) =>
      change.new === null ? [] : [`update ${backupRef(id, `new-${index}`)} ${change.new}`]
    )
  );
  if (record.stash !== null) {
    if ((await loadStashes(git)).some((stash) => stash.hash === record.stash!.hash)) {
      throw new Error(l10n.t("This stash is already in the stash list."));
    }
    await git.raw(["stash", "store", "-m", record.stash.message, record.stash.hash]);
  } else if (record.kind === "renameBranch") {
    await renameBack(git, record, title);
  } else {
    await restoreRefs(git, record, title);
  }
  const undone = { ...record, state: "undone" as const };
  await writeJournal(
    git,
    records.map((item) => (item.id === id ? undone : item))
  );
  if (record.saved !== null) {
    try {
      if (record.mode === "mixed") {
        // The files are as the reset left them; only the staged versions come back.
        await runGit(git, ["read-tree", `${record.saved}^{tree}`]);
        await runGit(git, ["update-index", "-q", "--refresh"]).catch(() => {});
      } else {
        await runGit(git, ["stash", "apply", "--index", record.saved]);
      }
    } catch (error) {
      throw new Error(
        l10n.t(
          "The refs are back, but the discarded changes could not be applied. They are kept as commit {0}: {1}",
          record.saved,
          errorText(error)
        ),
        { cause: error }
      );
    }
  }
}
