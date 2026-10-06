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
import { squashGroups } from "@/backend/utils/squashGroups";
import { requireCurrentBranch, resolveCommit } from "@/backend/utils/validation";

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
  const entry = plan.entries.find(e => e.hash === argument);
  const result = require("node:child_process").spawnSync(
    "git",
    ["commit", "--amend", "--only", "--allow-empty", "--no-verify", "--cleanup=whitespace", "--file=-"],
    { input: entry.squashMessage + "\\n", stdio: ["pipe", "inherit", "inherit"], windowsHide: true }
  );
  process.exit(result.status ?? 1);
} else {
  const done = fs.readFileSync(path.join(directory, "..", "rebase-merge", "done"), "utf8").trim().split("\\n").at(-1);
  const [action, hash] = (done || "").split(" ");
  const entry = plan.entries.find(e => e.hash === hash);
  if (action === "reword" && entry) fs.writeFileSync(argument, entry.message + "\\n");
}
`;

/**
 * The todo list for `entries`. For a squash group Git asks for the message in an editor and then
 * strips every line that starts with its comment character, so a message the user edited is
 * applied another way: the group is folded with Fixup, which keeps the first commit's message
 * without asking, and an exec line then amends that commit with the edited message, trimming only
 * whitespace. The amend skips the commit hooks, as Git does for a squash. The exec line holds no
 * user text, and it asks Git for the helper directory, whose path may contain characters a todo
 * line cannot. Git puts its own directory first on `PATH` for exec lines, so the helper's `git` is
 * the one running the rebase. Groups whose message was not edited are left for Git to combine.
 */
function todoList(entries: RebaseEntry[]) {
  const edited = squashGroups(entries).filter((group) => group[0]!.squashMessage !== undefined);
  const first = new Set(edited.map((group) => group[0]!.hash));
  const folded = new Set(edited.flatMap((group) => group.slice(1).map((entry) => entry.hash)));
  const last = new Map(edited.map((group) => [group.at(-1)!.hash, group[0]!.hash]));
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
  await withRecoveryEditor(git, ["rebase", "--rebase-merges", "--no-autostash", target], binary);
}

/**
 * Run `plan`. Git strips lines that start with its comment character from reworded messages, as
 * after an editor, unless `verbatim` asks it to trim only surrounding whitespace. That suits only
 * a plan without squashes, since Git explains a squashed message in comment lines. A squash
 * group's `squashMessage` is kept as typed apart from surrounding whitespace either way.
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
  await writeFile(path.join(directory, "plan.json"), JSON.stringify(plan), { mode: 0o600 });
  await writeFile(path.join(directory, "todo"), todoList(plan.entries), { mode: 0o600 });
  await writeFile(path.join(directory, "editor.cjs"), EDITOR, { mode: 0o600 });
  try {
    await runGit(
      git,
      [
        "-c",
        "rebase.abbreviateCommands=false",
        ...(verbatim ? ["-c", "commit.cleanup=whitespace"] : []),
        "rebase",
        "--interactive",
        "--no-autostash",
        "--no-autosquash",
        "--no-update-refs",
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
