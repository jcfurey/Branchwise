import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import * as l10n from "@vscode/l10n";
import type { SimpleGit } from "simple-git";

import { requireIdle } from "@/backend/actions/rebase";
import {
  analyzeSplit,
  type SplitSource,
  type SplitSourceHunk
} from "@/backend/queries/splitCommit";
import type { SplitAssignment, SplitPlan } from "@/backend/types";
import { readGitBytes, readGitCode, runGit, runGitWithInput } from "@/backend/utils/runGit";
import { requireCurrentBranch } from "@/backend/utils/validation";

const NEWLINE = Buffer.from("\n");

/** What a commit object says about itself, as a copy of it needs. */
type CommitObject = {
  tree: string;
  author: { name: string; email: string; date: string };
  /** The encoding its message is in, from its `encoding` header. */
  encoding: string;
  message: Buffer;
};

/** The parts of a plan that say what the split does, without what may change around it. */
function intent(plan: SplitPlan) {
  const { branch, head, target, files } = plan;
  return JSON.stringify([branch, head, target, files]);
}

/** Read a commit object byte for byte, so that its message and author survive any encoding. */
async function readCommit(git: SimpleGit, hash: string): Promise<CommitObject> {
  const raw = await readGitBytes(git, ["cat-file", "commit", hash]);
  const end = raw.indexOf("\n\n");
  const header = (end === -1 ? raw : raw.subarray(0, end)).toString("utf8").split("\n");
  const field = (name: string) =>
    header.find((line) => line.startsWith(name + " "))?.slice(name.length + 1);
  const author = /^(.*?) ?<(.*)> (\d+) ([+-]\d{4})$/.exec(field("author") ?? "");
  if (author === null) {
    throw new Error(l10n.t("The author of commit {0} cannot be read.", hash));
  }
  return {
    tree: field("tree")!,
    // Git takes `@<seconds> <zone>` as that exact time, in that zone.
    author: { name: author[1]!, email: author[2]!, date: `@${author[3]} ${author[4]}` },
    encoding: field("encoding") ?? "UTF-8",
    message: end === -1 ? Buffer.alloc(0) : raw.subarray(end + 2)
  };
}

/**
 * The parts the user chose, checked against the commit: at least two, each with a message and
 * at least one change, and every file or hunk in exactly one. Returns the part of each hunk of
 * every file, or of the whole file.
 */
function checkParts(sources: SplitSource[], messages: string[], assignment: SplitAssignment) {
  if (messages.length < 2) {
    throw new Error(l10n.t("Split the commit into at least two parts."));
  }
  const inRange = (part: unknown) =>
    Number.isInteger(part) && (part as number) >= 0 && (part as number) < messages.length;
  if (
    assignment.length !== sources.length ||
    assignment.some((choice, index) =>
      Array.isArray(choice)
        ? choice.length !== sources[index]!.hunks?.length || !choice.every(inRange)
        : !inRange(choice)
    )
  ) {
    throw new Error(l10n.t("The parts no longer match the commit. Open Split Commit again."));
  }
  const used = new Set(assignment.flat());
  if (messages.some((_, part) => !used.has(part))) {
    throw new Error(l10n.t("Each part needs at least one change."));
  }
  // A file whose hunks all go to one part goes whole, as its blob, with nothing to patch.
  return assignment.map((choice) => {
    if (!Array.isArray(choice)) {
      return choice;
    }
    return choice.some((part) => part !== choice[0]) ? choice : choice[0]!;
  });
}

/**
 * A patch of `source`'s hunks in `chosen`, against its version that already has those in
 * `applied`. Each hunk keeps its lines; only its line numbers move, by what the hunks before it
 * in that version add or remove.
 */
function patchOf(source: SplitSource, chosen: Set<SplitSourceHunk>, applied: Set<SplitSourceHunk>) {
  // The `index` line names the blobs before and after the whole commit, not this part.
  const lines = source.header!.filter((line) => !line.toString("latin1").startsWith("index "));
  let shiftOld = 0;
  let shiftNew = 0;
  for (const hunk of source.hunks!) {
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

/** The `update-index --index-info` records that make a file what the commit made it. */
function wholeRecords({ entry }: SplitSource, zero: string) {
  // Mode 0 removes a path; the ID beside it only has to be well formed.
  const records = entry.status === "R" ? [`0 ${zero}\t${entry.from}\0`] : [];
  records.push(
    entry.dstMode === "000000"
      ? `0 ${zero}\t${entry.path}\0`
      : `${entry.dstMode} ${entry.dstBlob}\t${entry.path}\0`
  );
  return records;
}

/**
 * Break the target commit into one commit per part, in order, each with its own message and the
 * target's author and date. The parts are built in a private index from the target's parent, so
 * the work tree and the real index are never touched, and the last part must rebuild the target's
 * tree exactly. The commits after the target are then made again on the last part with their own
 * trees, messages and authors: their trees do not change, so neither does HEAD's, and nothing
 * needs a rebase or a clean working tree. Only when all of that holds, and the branch is still
 * where the dialog found it, does the branch move; otherwise nothing changes.
 */
export async function splitCommit(
  git: SimpleGit,
  expected: SplitPlan,
  messages: string[],
  assignment: SplitAssignment,
  binary: string
) {
  await requireIdle(git);
  await requireCurrentBranch(git, expected.branch, expected.head);
  const { plan, parent: base, tree: original, sources } = await analyzeSplit(git, expected.target);
  if (intent(plan) !== intent(expected)) {
    throw new Error(l10n.t("The parts no longer match the commit. Open Split Commit again."));
  }
  const choices = checkParts(sources, messages, assignment);
  const cleaned: Buffer[] = [];
  for (const message of messages) {
    // Kept as typed apart from surrounding whitespace, as Edit Message keeps a message.
    const text = message.includes("\0")
      ? ""
      : // eslint-disable-next-line no-await-in-loop
        await runGitWithInput(git, ["stripspace"], Buffer.from(message), process.env);
    if (!text.trim()) {
      throw new Error(l10n.t("Each part needs a message."));
    }
    cleaned.push(Buffer.from(text));
  }
  const sign = (
    await readGitCode(git, ["config", "--type=bool", "--get", "commit.gpgSign"], [0, 1])
  ).stdout.trim();
  /** Commit `tree` on `parent` as `source` was committed: its author, date and encoding. */
  const commit = async (
    tree: string,
    parent: string | null,
    source: CommitObject,
    message: Buffer
  ) => {
    const output = await runGitWithInput(
      git,
      [
        "-c",
        `i18n.commitEncoding=${source.encoding}`,
        "commit-tree",
        // Plumbing does not sign by itself; signing follows the setting a commit would.
        ...(sign === "true" ? ["-S"] : []),
        tree,
        ...(parent === null ? [] : ["-p", parent])
      ],
      message,
      {
        ...process.env,
        GIT_AUTHOR_NAME: source.author.name,
        GIT_AUTHOR_EMAIL: source.author.email,
        GIT_AUTHOR_DATE: source.author.date
      }
    );
    return output.trim();
  };

  const target = await readCommit(git, plan.target);
  const later = (await git.raw(["rev-list", "--reverse", plan.head, `^${plan.target}`, "--"]))
    .split("\n")
    .filter(Boolean);
  const directory = await mkdtemp(path.join(os.tmpdir(), "branchwise-split-"));
  const env = { ...process.env, GIT_INDEX_FILE: path.join(directory, "index") };
  try {
    await runGit(git, base === null ? ["read-tree", "--empty"] : ["read-tree", base], binary, env);
    const zero = "0".repeat(plan.target.length);
    const applied = new Set<SplitSourceHunk>();
    let tip = base;
    let built = "";
    for (let part = 0; part < messages.length; part++) {
      const records: string[] = [];
      const patches: Buffer[] = [];
      const chosen = new Set<SplitSourceHunk>();
      sources.forEach((source, index) => {
        const choice = choices[index]!;
        if (!Array.isArray(choice)) {
          if (choice === part) {
            records.push(...wholeRecords(source, zero));
          }
          return;
        }
        const hunks = source.hunks!.filter((_, at) => choice[at] === part);
        if (hunks.length > 0) {
          patches.push(...patchOf(source, new Set(hunks), applied));
          hunks.forEach((hunk) => chosen.add(hunk));
        }
      });
      if (records.length > 0) {
        // Each part is built on the one before it.
        // eslint-disable-next-line no-await-in-loop
        await runGitWithInput(
          git,
          ["update-index", "-z", "--index-info"],
          Buffer.from(records.join("")),
          env
        );
      }
      if (patches.length > 0) {
        // eslint-disable-next-line no-await-in-loop
        await runGitWithInput(
          git,
          [
            "-c",
            "apply.ignoreWhitespace=no",
            "apply",
            "--cached",
            "--unidiff-zero",
            "--whitespace=nowarn",
            "-"
          ],
          Buffer.concat(patches),
          env
        );
      }
      chosen.forEach((hunk) => applied.add(hunk));
      // eslint-disable-next-line no-await-in-loop
      built = (await runGit(git, ["write-tree"], binary, env)).trim();
      // eslint-disable-next-line no-await-in-loop
      tip = await commit(built, tip, { ...target, encoding: "UTF-8" }, cleaned[part]!);
    }
    if (built !== original) {
      throw new Error(
        l10n.t("The parts would not add up to the original commit, so nothing was changed.")
      );
    }
    for (const hash of later) {
      // The later commits keep their trees, so each is made again as it was, on the new tip.
      // eslint-disable-next-line no-await-in-loop
      const source = await readCommit(git, hash);
      // eslint-disable-next-line no-await-in-loop
      tip = await commit(source.tree, tip, source, source.message);
    }
    await requireCurrentBranch(git, plan.branch, plan.head);
    // Only if the branch is still where the plan began, so a commit made meanwhile is never lost.
    await runGit(
      git,
      [
        "update-ref",
        "-m",
        `split: ${plan.target.slice(0, 12)} into ${messages.length} commits`,
        `refs/heads/${plan.branch}`,
        tip!,
        plan.head
      ],
      binary
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
