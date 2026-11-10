import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { loadBisect } from "@/backend/queries/bisect";
import {
  gitDirectory,
  loadOperation,
  loadRebasePlan,
  readOptional
} from "@/backend/queries/repository";
import type { RebaseEntry, RebasePlan } from "@/backend/types";
import { runGit } from "@/backend/utils/runGit";
import { combinedMessage, squashGroups } from "@/backend/utils/squashGroups";
import { requireCurrentBranch, resolveCommit } from "@/backend/utils/validation";

/**
 * Keeps a rebase to the checked-out branch. With `rebase.updateRefs` set, Git 2.38 and later
 * also move every other branch that points into the rebased commits, which nobody asked for
 * here and the Safety Net does not record. The setting is turned off for the one command
 * instead of passing `--no-update-refs`, an option older Git refuses as unknown.
 */
const ONLY_THIS_BRANCH = ["-c", "rebase.updateRefs=false"];

export async function requireIdle(git: SimpleGit) {
  if ((await loadOperation(git)) !== null) {
    throw new Error(l10n.t("Finish or abort the operation already in progress first."));
  }
  if ((await loadBisect(git)) !== null) {
    throw new Error(l10n.t("Reset the bisect session before starting another Git operation."));
  }
}

// Git invokes editors through a shell, including Git for Windows' sh. User text
// stays in JSON and never becomes shell code or a rebase exec instruction.
function shellQuote(value: string) {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

const EDITOR = `const fs = require("node:fs");
const path = require("node:path");
const [directory, mode, argument] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(path.join(directory, "plan.json"), "utf8"));
if (mode === "sequence") {
  fs.copyFileSync(path.join(directory, "todo"), argument);
} else if (mode === "amend") {
  const result = require("node:child_process").spawnSync(
    "git",
    ["commit", "--amend", "--only", "--allow-empty", "--no-verify", "--cleanup=whitespace", "--file=-"],
    { input: plan.amend[argument] + "\\n", stdio: ["pipe", "inherit", "inherit"], windowsHide: true }
  );
  process.exit(result.status ?? 1);
} else {
  const done = fs.readFileSync(path.join(directory, "..", "rebase-merge", "done"), "utf8").trim().split("\\n").at(-1);
  const [action, hash] = (done || "").split(" ");
  const entry = plan.entries.find(e => e.hash === hash);
  if (action === "reword" && entry) fs.writeFileSync(argument, entry.message + "\\n");
}
`;

/** The characters Git chooses a comment character from when `core.commentChar` is `auto`. */
const AUTOMATIC_COMMENT_CHARACTERS = [..."#;@!$%^&|:"];

/**
 * What starts a comment line where Git cleans up a message that came from an editor. With
 * `auto`, Git takes the first of its candidates that no line of the message it offers starts
 * with, which is the commit's old message and says nothing about the new one, so every
 * candidate counts.
 */
async function commentPrefixes(git: SimpleGit) {
  const setting = async (key: string) =>
    (await git.raw(["config", "--get", key]).catch(() => "")).replace(/\r?\n$/, "");
  const configured = (await setting("core.commentString")) || (await setting("core.commentChar"));
  return configured === "auto" ? AUTOMATIC_COMMENT_CHARACTERS : [configured || "#"];
}

/** Whether Git would take a line of `message` for a comment and drop it. */
function hasCommentLine(message: string, prefixes: string[]) {
  return message.split("\n").some((line) => prefixes.some((prefix) => line.startsWith(prefix)));
}

/**
 * Each retained Pick or Reword of a plan with the Squash and Fixup entries that fold into it.
 * Drop entries leave the todo list, so a commit folds into the retained commit before it even
 * with a Drop in between.
 */
function foldedRuns(entries: RebaseEntry[]) {
  const runs: RebaseEntry[][] = [];
  let current: RebaseEntry[] | undefined;
  for (const entry of entries) {
    if (entry.action === "pick" || entry.action === "reword") {
      current = [entry];
      runs.push(current);
    } else if (entry.action !== "drop") {
      current?.push(entry);
    }
  }
  return runs;
}

/**
 * The messages of `entries` that Git is not left to write, by the commit each run of the plan
 * starts with. Git takes a reworded or squashed message from an editor and then drops every
 * line that starts like a comment: `#123 Fix the parser` would vanish, and a message of nothing
 * else stops the rebase. So these are set by amending the finished commit instead:
 *
 * - a squashed message the user edited, always;
 * - a squashed message left as offered, when one of its lines starts like a comment;
 * - a reworded message outside a squash, when one of its lines does.
 *
 * `prefixes` is what starts a comment line, or `null` when Git is told to trim only whitespace
 * and so drops nothing.
 */
function amendedMessages(entries: RebaseEntry[], prefixes: string[] | null) {
  const messages = new Map<string, string>();
  for (const run of foldedRuns(entries)) {
    const first = run[0]!;
    const fragile = (message: string) => prefixes !== null && hasCommentLine(message, prefixes);
    if (run.some((entry) => entry.action === "squash")) {
      const offered = combinedMessage(run);
      if (first.squashMessage !== undefined || fragile(offered)) {
        messages.set(first.hash, first.squashMessage ?? offered);
      }
    } else if (first.action === "reword" && fragile(first.message)) {
      messages.set(first.hash, first.message);
    }
  }
  return messages;
}

/**
 * The todo list for `entries`, where `amended` are the messages from `amendedMessages`. A run
 * with such a message is folded with Fixup, which keeps the first commit's message without
 * asking, and an exec line after its last commit then amends the result with the message,
 * trimming only whitespace. The amend skips the commit hooks, as Git does for a squash. The exec
 * line holds no user text, and it asks Git for the helper directory, whose path may contain
 * characters a todo line cannot. Git puts its own directory first on `PATH` for exec lines, so
 * the helper's `git` is the one running the rebase. The exec line also stays in the todo list
 * while a rebase is stopped for a conflict, so the message is set however the rebase is
 * continued. Every other message is left for Git to write.
 */
function todoList(entries: RebaseEntry[], amended: ReadonlyMap<string, string>) {
  const runs = foldedRuns(entries).filter((run) => amended.has(run[0]!.hash));
  const first = new Set(runs.map((run) => run[0]!.hash));
  const folded = new Set(runs.flatMap((run) => run.slice(1).map((entry) => entry.hash)));
  const last = new Map(runs.map((run) => [run.at(-1)!.hash, run[0]!.hash]));
  const amend = `d="$(git rev-parse --git-path branchwise-rebase)" && ELECTRON_RUN_AS_NODE=1 ${shellQuote(process.execPath)} "$d/editor.cjs" "$d" amend`;
  return entries
    .map((entry) => {
      const action = first.has(entry.hash)
        ? "pick"
        : folded.has(entry.hash)
          ? "fixup"
          : entry.action;
      const target = last.get(entry.hash);
      return (
        `${action} ${entry.hash}\n` + (target === undefined ? "" : `exec ${amend} ${target}\n`)
      );
    })
    .join("");
}

async function helperDirectory(git: SimpleGit) {
  return path.join(await gitDirectory(git), "branchwise-rebase");
}

function editorEnvironment(directory: string) {
  const command = `${shellQuote(process.execPath)} ${shellQuote(path.join(directory, "editor.cjs"))} ${shellQuote(directory)}`;
  return {
    ...process.env,
    ELECTRON_RUN_AS_NODE: "1",
    GIT_SEQUENCE_EDITOR: `${command} sequence`,
    GIT_EDITOR: `${command} message`
  };
}

export async function finishRebaseHelpers(git: SimpleGit) {
  if ((await loadOperation(git))?.kind !== "rebase") {
    await rm(await helperDirectory(git), { recursive: true, force: true });
  }
}

export async function withRecoveryEditor(git: SimpleGit, args: string[], binary: string) {
  const directory = await helperDirectory(git);
  const original = await readOptional(
    path.join(await gitDirectory(git), "rebase-merge", "orig-head")
  );
  const saved = await readOptional(path.join(directory, "plan.json"));
  const matches =
    saved !== null &&
    original !== null &&
    (JSON.parse(saved) as RebasePlan).head === original.trim();
  try {
    await runGit(
      git,
      args,
      binary,
      matches ? editorEnvironment(directory) : { ...process.env, GIT_EDITOR: "true" }
    );
  } finally {
    await finishRebaseHelpers(git);
  }
}

export async function rebaseBranch(
  git: SimpleGit,
  branch: string,
  onto: string,
  expectedHead: string,
  binary: string
) {
  await requireIdle(git);
  await requireCurrentBranch(git, branch, expectedHead);
  const target = await resolveCommit(git, onto);
  await withRecoveryEditor(
    git,
    [...ONLY_THIS_BRANCH, "rebase", "--rebase-merges", "--no-autostash", target],
    binary
  );
}

/**
 * Run `plan`. Every message the plan sets is kept as typed apart from surrounding whitespace,
 * lines that start like a comment included. `verbatim` has Git itself trim only whitespace from
 * the messages it takes from an editor, so that a Reword runs the commit hooks as Git's own
 * does; that suits only a plan without squashes, since Git explains a squashed message in
 * comment lines. Otherwise a message Git would drop lines from is set by amending the commit,
 * as `amendedMessages` describes, without the hooks.
 */
export async function interactiveRebase(
  git: SimpleGit,
  plan: RebasePlan,
  binary: string,
  verbatim = false
) {
  await requireIdle(git);
  await requireCurrentBranch(git, plan.branch, plan.head);
  const original = await loadRebasePlan(git, plan.base);
  const expected = new Set(original.entries.map((entry) => entry.hash));
  if (
    plan.entries.length !== expected.size ||
    new Set(plan.entries.map((entry) => entry.hash)).size !== expected.size ||
    plan.entries.some(
      (entry) =>
        !expected.has(entry.hash) ||
        !["pick", "reword", "squash", "fixup", "drop"].includes(entry.action)
    )
  ) {
    throw new Error(l10n.t("The rebase plan no longer matches the branch. Reload the plan."));
  }
  const retained = plan.entries.filter((entry) => entry.action !== "drop");
  if (
    retained.length === 0 ||
    retained[0]?.action === "squash" ||
    retained[0]?.action === "fixup"
  ) {
    throw new Error(
      l10n.t("Keep at least one commit. The first retained commit cannot be squashed.")
    );
  }
  if (
    plan.entries.some(
      (entry) =>
        entry.action === "reword" && (!entry.message.trim() || entry.message.includes("\0"))
    )
  ) {
    throw new Error(l10n.t("Each reworded commit needs a nonempty message."));
  }
  if (
    squashGroups(plan.entries).some(([entry]) => {
      const message = entry!.squashMessage;
      return message !== undefined && (!message.trim() || message.includes("\0"));
    })
  ) {
    throw new Error(l10n.t("Each combined commit needs a nonempty message."));
  }
  if (!(await git.status()).isClean()) {
    throw new Error(l10n.t("Commit or stash your changes before rebasing."));
  }
  const directory = await helperDirectory(git);
  await mkdir(directory, { recursive: true });
  const amended = amendedMessages(plan.entries, verbatim ? null : await commentPrefixes(git));
  await writeFile(
    path.join(directory, "plan.json"),
    JSON.stringify({ ...plan, amend: Object.fromEntries(amended) }),
    { mode: 0o600 }
  );
  await writeFile(path.join(directory, "todo"), todoList(plan.entries, amended), { mode: 0o600 });
  await writeFile(path.join(directory, "editor.cjs"), EDITOR, { mode: 0o600 });
  try {
    await runGit(
      git,
      [
        ...ONLY_THIS_BRANCH,
        "-c",
        "rebase.abbreviateCommands=false",
        ...(verbatim ? ["-c", "commit.cleanup=whitespace"] : []),
        "rebase",
        "--interactive",
        "--no-autostash",
        "--no-autosquash",
        "--keep-empty",
        plan.base
      ],
      binary,
      editorEnvironment(directory)
    );
  } finally {
    await finishRebaseHelpers(git);
  }
}
