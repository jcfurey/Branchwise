import type { SimpleGit } from "simple-git";

import type { QueryResult } from "@/backend/types";

type RemoteSettings = Pick<QueryResult<"loadRemotes">, "remotes" | "upstream" | "pushRemote">;

export async function loadRemotes(
  git: SimpleGit,
  branchName: string | null
): Promise<RemoteSettings> {
  const remotes = (await git.getRemotes()).map((remote) => remote.name).toSorted();
  if (branchName === null) {
    return {
      remotes,
      upstream: null,
      pushRemote: (await git.getConfig("remote.pushDefault")).value
    };
  }
  const [remote, merge, branchPushRemote, pushDefault] = await Promise.all([
    git.getConfig(`branch.${branchName}.remote`),
    git.getConfig(`branch.${branchName}.merge`),
    git.getConfig(`branch.${branchName}.pushRemote`),
    git.getConfig("remote.pushDefault")
  ]);
  const upstream =
    remote.value !== null && merge.value?.startsWith("refs/heads/")
      ? { remote: remote.value, branchName: merge.value.slice("refs/heads/".length) }
      : null;
  return {
    remotes,
    upstream,
    pushRemote: branchPushRemote.value ?? pushDefault.value ?? upstream?.remote ?? null
  };
}
