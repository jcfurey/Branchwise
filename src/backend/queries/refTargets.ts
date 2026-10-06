import type { SimpleGit } from "simple-git";

import type { GitRef, RefTarget } from "@/backend/types";

const NAMESPACES: ReadonlyArray<readonly [prefix: string, type: GitRef["type"]]> = [
  ["refs/heads/", "head"],
  ["refs/remotes/", "remote"],
  ["refs/tags/", "tag"]
];

/**
 * Every local branch, remote branch and tag that leads to a commit, with that commit's subject,
 * for Go to. Each group comes in that order, the most recently made first. Symbolic refs such as
 * `origin/HEAD` are left out, and so are tags of anything but a commit, which have no row.
 */
export async function loadRefTargets(git: SimpleGit): Promise<RefTarget[]> {
  // An annotated tag names the tag object; the `*` fields describe the object it points to.
  const text = await git.raw([
    "for-each-ref",
    "--sort=-creatordate",
    "--format=%(refname)%00%(symref)%00%(objecttype)%00%(objectname)%00%(contents:subject)" +
      "%00%(*objecttype)%00%(*objectname)%00%(*contents:subject)",
    ...NAMESPACES.map(([prefix]) => prefix)
  ]);
  const targets: RefTarget[] = [];
  for (const [prefix, type] of NAMESPACES) {
    for (const line of text.split("\n")) {
      const [ref = "", symref, kind, hash = "", subject = "", peeledKind, peeled, peeledSubject] =
        line.split("\0");
      if (!ref.startsWith(prefix) || symref !== "") {
        continue;
      }
      const name = ref.slice(prefix.length);
      if (kind === "commit") {
        targets.push({ type, name, hash, subject });
      } else if (kind === "tag" && peeledKind === "commit") {
        targets.push({ type, name, hash: peeled!, subject: peeledSubject! });
      }
    }
  }
  return targets;
}
