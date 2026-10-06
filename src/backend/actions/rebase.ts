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
import type { RebasePlan } from "@/backend/types";
import { runGit } from "@/backend/utils/runGit";
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
const [directory, mode, filename] = process.argv.slice(2);
const plan = JSON.parse(fs.readFileSync(path.join(directory, "plan.json"), "utf8"));
if (mode === "sequence") {
  fs.writeFileSync(filename, plan.entries.map(e => e.action + " " + e.hash).join("\\n") + "\\n");
} else {
  const done = fs.readFileSync(path.join(directory, "..", "rebase-merge", "done"), "utf8").trim().split("\\n").at(-1);
  const [action, hash] = (done || "").split(" ");
  const entry = plan.entries.find(e => e.hash === hash);
  if (action === "reword" && entry) fs.writeFileSync(filename, entry.message + "\\n");
}
`;

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
 * a plan without squashes, since Git explains a squashed message in comment lines.
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
  if (!(await git.status()).isClean()) {
    throw new Error(l10n.t("Commit or stash your changes before rebasing."));
  }
  const directory = await helperDirectory(git);
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "plan.json"), JSON.stringify(plan), { mode: 0o600 });
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
