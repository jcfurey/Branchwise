import { createHash } from "node:crypto";
import path from "node:path";

import type { SimpleGit } from "simple-git";

import { gitDirectory, readOptional } from "@/backend/queries/repository";
import type { BisectState } from "@/backend/types";
import { resolveCommit } from "@/backend/utils/validation";

/** Git 2.55 quotes custom/default terms; older Git logs leave them unquoted. */
export function bisectResult(log: string | null | undefined, badTerm: string) {
  const line = log
    ?.split("\n")
    .findLast(
      (entry) =>
        entry.startsWith(`# first '${badTerm}' commit: [`) ||
        entry.startsWith(`# first ${badTerm} commit: [`)
    );
  return line?.match(/\[([a-f0-9]{40,64})\]/)?.[1] ?? null;
}

export async function loadBisect(git: SimpleGit): Promise<BisectState | null> {
  const directory = await gitDirectory(git);
  const [original, log, termsFile] = await Promise.all(
    ["BISECT_START", "BISECT_LOG", "BISECT_TERMS"].map((file) =>
      readOptional(path.join(directory, file))
    )
  );
  if (original === null || original === undefined) {
    return null;
  }
  const [badTerm = "bad", goodTerm = "good"] = (termsFile?.trim() || "bad\ngood").split("\n");
  const head = await resolveCommit(git, "HEAD");
  const refs = (
    await git.raw(["for-each-ref", "--format=%(refname:lstrip=2)%00%(objectname)", "refs/bisect/"])
  )
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => line.split("\0"));
  const good = refs.filter(([name]) => name?.startsWith(goodTerm + "-")).map(([, hash]) => hash!);
  const bad = refs.find(([name]) => name === badTerm)?.[1] ?? "";
  const skipped = refs.filter(([name]) => name?.startsWith("skip-")).map(([, hash]) => hash!);
  const remaining = bad
    ? Number((await git.raw(["rev-list", "--count", bad, "--not", ...good, "--"])).trim())
    : 0;
  const unskipped =
    bad && skipped.length
      ? Number(
          (await git.raw(["rev-list", "--count", bad, "--not", ...good, ...skipped, "--"])).trim()
        )
      : remaining;
  // Skipped commits can be ancestors of the bad commit; excluding their ancestry
  // is insufficient to identify ambiguity. Git records the definitive result.
  const result = bisectResult(log, badTerm);
  const firstBad = result === bad ? result : null;
  const ambiguous =
    firstBad === null &&
    remaining > 1 &&
    unskipped <= 1 &&
    (log?.includes("# only skipped commits left to test") ?? false);
  return {
    id: createHash("sha256")
      .update(JSON.stringify([original, log, termsFile, head, refs]))
      .digest("hex"),
    original: original.trim(),
    head,
    subject: (await git.raw(["show", "-s", "--format=%s", firstBad ?? head])).trimEnd(),
    good,
    bad,
    skipped,
    remaining,
    firstBad,
    ambiguous,
    terms: { good: goodTerm, bad: badTerm }
  };
}
