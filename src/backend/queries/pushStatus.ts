import type { SimpleGit } from "simple-git";

import { readGitWithInput } from "@/backend/utils/runGit";

/** Commits listed of each kind at most, newest first. */
export const PUSH_STATUS_LIMIT = 1000;

/**
 * Which commits are only local and which are only on a remote. `unpushed` are the commits of
 * local branches that no remote-tracking branch reaches; `unpulled` are the commits of the
 * branches local branches track that no local branch reaches. A repository without
 * remote-tracking branches reports neither, as nothing in it was ever pushed or fetched.
 */
export async function loadPushStatus(
  git: SimpleGit
): Promise<{ unpushed: string[]; unpulled: string[] }> {
  const [remotes, upstreams] = await Promise.all([
    git.raw(["for-each-ref", "--format=%(refname)", "refs/remotes"]),
    git.raw(["for-each-ref", "--format=%(upstream)", "refs/heads"])
  ]);
  const remoteRefs = new Set(lines(remotes));
  if (remoteRefs.size === 0) {
    return { unpushed: [], unpulled: [] };
  }
  // A tracked branch that is gone would fail the whole read.
  const tracked = [...new Set(lines(upstreams))].filter((ref) => remoteRefs.has(ref));
  const limit = `--max-count=${PUSH_STATUS_LIMIT}`;
  const [unpushed, unpulled] = await Promise.all([
    git.raw(["rev-list", limit, "--branches", "--not", "--remotes", "--"]),
    tracked.length === 0
      ? ""
      : // Revisions read before `--not` stay positive.
        readGitWithInput(
          git,
          ["rev-list", limit, "--stdin", "--not", "--branches"],
          tracked.join("\n") + "\n"
        )
  ]);
  return { unpushed: lines(unpushed), unpulled: lines(unpulled) };
}

function lines(output: string) {
  return output.split("\n").filter(Boolean);
}
