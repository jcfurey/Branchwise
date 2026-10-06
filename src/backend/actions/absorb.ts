import { copyFile, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { requireIdle } from "@/backend/actions/rebase";
import { analyzeAbsorb, type StagedFile, type StagedHunk } from "@/backend/queries/absorb";
import type { AbsorbPlan } from "@/backend/types";
import { runGit, runGitWithInput } from "@/backend/utils/runGit";
import { requireCurrentBranch } from "@/backend/utils/validation";

const NEWLINE = Buffer.from("\n");

/** The parts of a plan that say what the absorb does, without what may change around it. */
function intent(plan: AbsorbPlan) {
  const { branch, head, staged, targets, left, base } = plan;
  return JSON.stringify([branch, head, staged, targets, left, base]);
}

/**
 * A patch of `file`'s hunks in `chosen`, against its version that already has those in
 * `applied`. Each hunk keeps its lines; only its line numbers move, by what the hunks before it
 * in that version add or remove.
 */
function patchOf(file: StagedFile, chosen: Set<StagedHunk>, applied: Set<StagedHunk>) {
  const lines = file.header.filter((line) => !line.toString("latin1").startsWith("index "));
  let shiftOld = 0;
  let shiftNew = 0;
  for (const hunk of file.hunks) {
    const delta = hunk.newLines - hunk.oldLines;
    if (chosen.has(hunk)) {
      // A side without lines names the line before the change, as in any unified diff.
      const before = hunk.oldLines > 0 ? hunk.oldStart - 1 : hunk.oldStart;
      const oldStart = before + shiftOld + (hunk.oldLines > 0 ? 1 : 0);
      const newStart = before + shiftNew + (hunk.newLines > 0 ? 1 : 0);
      lines.push(
        Buffer.from(`@@ -${oldStart},${hunk.oldLines} +${newStart},${hunk.newLines} @@`),
        ...hunk.body
      );
      shiftNew += delta;
    } else if (applied.has(hunk)) {
      shiftOld += delta;
      shiftNew += delta;
    }
  }
  return lines.flatMap((line) => [line, NEWLINE]);
}

/** One patch of the chosen hunks of every file that has any. */
function patchAll(files: StagedFile[], chosen: Set<StagedHunk>, applied: Set<StagedHunk>) {
  return Buffer.concat(
    files
      .filter((file) => file.hunks.some((hunk) => chosen.has(hunk)))
      .flatMap((file) => patchOf(file, chosen, applied))
  );
}

/**
 * Commit each group of staged hunks as `fixup! <subject>` of the commit that last changed their
 * lines, oldest target first, and leave the rest staged. The commits are built in a private
 * index from HEAD, so the work tree and the real index are never touched: once HEAD moves to the
 * last fixup, what the index holds beyond it is exactly the hunks left over. Before HEAD moves,
 * the fixups plus the left-over changes must rebuild the staged tree exactly; if anything differs
 * or moved meanwhile, the absorb stops with nothing changed.
 */
export async function absorbStaged(git: SimpleGit, expected: AbsorbPlan, binary: string) {
  await requireIdle(git);
  await requireCurrentBranch(git, expected.branch, expected.head);
  const { plan, files, whole } = await analyzeAbsorb(git);
  if (intent(plan) !== intent(expected)) {
    throw new Error(l10n.t("The staged changes changed. Review them again."));
  }
  if (plan.targets.length === 0) {
    throw new Error(l10n.t("None of the staged changes can be absorbed."));
  }
  const top = (await git.raw(["rev-parse", "--show-toplevel"])).replace(/\n$/, "");
  const realIndex = path.resolve(
    top,
    (await git.raw(["rev-parse", "--git-path", "index"])).replace(/\n$/, "")
  );
  const directory = await mkdtemp(path.join(os.tmpdir(), "branchwise-absorb-"));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(directory, "index") };
  /** The tree the real index holds, read from a copy so that not even its cache changes. */
  const stagedTree = async () => {
    const copy = path.join(directory, "staged");
    await copyFile(realIndex, copy);
    return (
      await runGit(git, ["write-tree"], binary, { ...process.env, GIT_INDEX_FILE: copy })
    ).trim();
  };
  try {
    const staged = await stagedTree();
    await runGit(git, ["read-tree", plan.head], binary, env);
    const apply = (patch: Buffer) =>
      runGitWithInput(
        git,
        ["apply", "--cached", "--unidiff-zero", "--whitespace=nowarn", "-"],
        patch,
        env
      );
    const applied = new Set<StagedHunk>();
    /** Commit the target's hunks on top of `parent`, in the private index. */
    const fixup = async (target: AbsorbPlan["targets"][number], parent: string) => {
      const chosen = new Set(
        files.flatMap((file) => file.hunks.filter((hunk) => hunk.target === target.hash))
      );
      await apply(patchAll(files, chosen, applied));
      const tree = (await runGit(git, ["write-tree"], binary, env)).trim();
      const message = Buffer.from(`fixup! ${target.subject}\n`);
      const commit = await runGitWithInput(
        git,
        ["commit-tree", tree, "-p", parent],
        message,
        process.env
      );
      for (const hunk of chosen) {
        applied.add(hunk);
      }
      return commit.trim();
    };
    let parent = plan.head;
    for (const target of plan.targets) {
      // Each fixup is built on the one before it.
      // eslint-disable-next-line no-await-in-loop
      parent = await fixup(target, parent);
    }

    // The left-over hunks and whole files on top of the last fixup must give the staged tree.
    const rest = new Set(
      files.flatMap((file) => file.hunks.filter((hunk) => hunk.target === null))
    );
    if (rest.size > 0) {
      await apply(patchAll(files, rest, applied));
    }
    if (whole.length > 0) {
      // Mode 0 removes a path; the ID beside it only has to be well formed.
      const zero = "0".repeat(plan.head.length);
      const records: string[] = [];
      for (const entry of whole) {
        if (entry.status === "R") {
          records.push(`0 ${zero}\t${entry.from}\0`);
        }
        records.push(
          entry.dstMode === "000000"
            ? `0 ${zero}\t${entry.path}\0`
            : `${entry.dstMode} ${entry.dstBlob}\t${entry.path}\0`
        );
      }
      await runGitWithInput(
        git,
        ["update-index", "-z", "--index-info"],
        Buffer.from(records.join("")),
        env
      );
    }
    const rebuilt = (await runGit(git, ["write-tree"], binary, env)).trim();
    if (rebuilt !== staged) {
      throw new Error(
        l10n.t(
          "The fixup commits and the changes left staged would not add up to the staged changes, so nothing was changed."
        )
      );
    }
    await requireCurrentBranch(git, plan.branch, plan.head);
    if ((await stagedTree()) !== staged) {
      throw new Error(l10n.t("The staged changes changed. Review them again."));
    }
    // Only if HEAD is still where the plan began, so a commit made meanwhile is never lost.
    await runGit(
      git,
      ["update-ref", "-m", "absorb: fixup commits for staged changes", "HEAD", parent, plan.head],
      binary
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
