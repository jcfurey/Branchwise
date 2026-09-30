import type { SimpleGit } from "simple-git";

/** Remote names can contain slashes; prefer the longest configured name. */
export function remoteForRef(name: string, remotes: readonly string[]): string {
  return (
    remotes
      .filter((remote) => name.startsWith(remote + "/"))
      .toSorted((a, b) => b.length - a.length)[0] ??
    name.split("/")[0] ??
    name
  );
}

export type RemoteVisibility = {
  showRemoteBranches?: boolean;
  hiddenRemotes?: string[];
};

/** A wildmatch pattern that matches `text` literally. */
const literal = (text: string) => text.replace(/[\\*?[]/g, "\\$&");

/**
 * `git log` arguments for the visible remote refs. One pattern per hidden remote keeps the
 * command line short however many branches it has; Windows limits it to 32,767 characters.
 * A remote named below a hidden one, such as `team/upstream` below `team`, is added back
 * without the hidden remotes below it.
 */
function remoteLogArgs(remotes: readonly string[], hidden: ReadonlySet<string>) {
  const args = [...hidden].map((remote) => `--exclude=${literal(remote)}/*`);
  args.push("--remotes");
  for (const remote of new Set(remotes)) {
    if (!hidden.has(remote) && [...hidden].some((other) => remote.startsWith(other + "/"))) {
      for (const other of hidden) {
        if (other.startsWith(remote + "/")) {
          args.push(`--exclude=refs/remotes/${literal(other)}/*`);
        }
      }
      args.push(`--glob=refs/remotes/${literal(remote)}/*`);
    }
  }
  return args;
}

/** Exclude ref tips, never their shared ancestry with visible branches or tags. */
export async function remoteVisibility(git: SimpleGit, options: RemoteVisibility) {
  const excluded = new Set<string>();
  if (options.showRemoteBranches === false) {
    return { excluded, logArgs: [] as string[] };
  }
  const hidden = new Set(options.hiddenRemotes ?? []);
  if (hidden.size === 0) {
    return { excluded, logArgs: ["--remotes"] };
  }
  const [names, refs] = await Promise.all([
    git.raw(["remote"]),
    git.raw(["for-each-ref", "--format=%(refname)", "refs/remotes/"])
  ]);
  const remotes = [...names.trim().split(/\r?\n/).filter(Boolean), ...hidden];
  for (const ref of refs.trim().split(/\r?\n/).filter(Boolean)) {
    const name = ref.slice("refs/remotes/".length);
    if (hidden.has(remoteForRef(name, remotes))) {
      excluded.add(name);
    }
  }
  return { excluded, logArgs: remoteLogArgs(remotes, hidden) };
}
