import type { SimpleGit } from "simple-git";

import { cleanPatterns, matchesRemoteBranch, patternMatcher } from "@/backend/utils/branchPatterns";

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
  /** Globs naming branches to leave out, as `branchPatterns.ts` reads them. */
  hiddenBranchPatterns?: string[];
  /**
   * The branch the user chose, spelt as in the branch list (`remotes/<remote>/<branch>` for a
   * remote one). The patterns never hide it, as they never hide the checked-out branch.
   */
  shownBranch?: string;
};

/** A wildmatch pattern that matches `text` literally. */
const literal = (text: string) => text.replace(/[\\*?[]/g, "\\$&");

/**
 * `git log` arguments for the visible remote refs. One pattern per hidden remote keeps the
 * command line short however many branches it has; Windows limits it to 32,767 characters.
 * A remote named below a hidden one, such as `team/upstream` below `team`, is added back
 * without the hidden remotes below it. `patterns` are the branch-pattern exclusions under
 * `refs/remotes/`, repeated before each ref selector since Git forgets them after one.
 */
function remoteLogArgs(
  remotes: readonly string[],
  hidden: ReadonlySet<string>,
  patterns: readonly string[]
) {
  const args = [...hidden].map((remote) => `--exclude=${literal(remote)}/*`);
  args.push(...patterns.map((pattern) => `--exclude=${pattern}`), "--remotes");
  for (const remote of new Set(remotes)) {
    if (!hidden.has(remote) && [...hidden].some((other) => remote.startsWith(other + "/"))) {
      for (const other of hidden) {
        if (other.startsWith(remote + "/")) {
          args.push(`--exclude=refs/remotes/${literal(other)}/*`);
        }
      }
      args.push(...patterns.map((pattern) => `--exclude=refs/remotes/${pattern}`));
      args.push(`--glob=refs/remotes/${literal(remote)}/*`);
    }
  }
  return args;
}

/**
 * Exclude ref tips, never their shared ancestry with visible branches or tags. `excluded` holds
 * the hidden remote-tracking branches and `hiddenBranches` the hidden local ones. Callers use
 * `branchArgs` in place of `--branches`, and `logArgs` after it in place of `--remotes`; a shown
 * branch that a pattern matches is named in `logArgs` on its own.
 */
export async function remoteVisibility(git: SimpleGit, options: RemoteVisibility) {
  const excluded = new Set<string>();
  const hiddenBranches = new Set<string>();
  const showRemotes = options.showRemoteBranches !== false;
  const hidden = new Set(showRemotes ? (options.hiddenRemotes ?? []) : []);
  const matches = patternMatcher(options.hiddenBranchPatterns ?? []);
  if (matches === null) {
    const branchArgs = ["--branches"];
    if (!showRemotes) {
      return { excluded, hiddenBranches, branchArgs, logArgs: [] as string[] };
    }
    if (hidden.size === 0) {
      return { excluded, hiddenBranches, branchArgs, logArgs: ["--remotes"] };
    }
  }
  // Patterns also need the local branches, and which one is checked out.
  const [names, refs] = await Promise.all([
    showRemotes ? git.raw(["remote"]) : "",
    matches === null
      ? git.raw(["for-each-ref", "--format=%(refname)", "refs/remotes/"])
      : git.raw([
          "for-each-ref",
          "--format=%(HEAD)%(refname)",
          "refs/heads/",
          ...(showRemotes ? ["refs/remotes/"] : [])
        ])
  ]);
  const remotes = [...names.trim().split(/\r?\n/).filter(Boolean), ...hidden];
  const local: string[] = [];
  const remote: string[] = [];
  let head: string | undefined;
  // Not trimmed: `%(HEAD)` is `*` for the checked-out branch and a space for any other.
  for (const line of refs.split(/\r?\n/).filter(Boolean)) {
    const ref = matches === null ? line : line.slice(1);
    if (ref.startsWith("refs/heads/")) {
      local.push(ref.slice("refs/heads/".length));
      if (line.startsWith("*")) {
        head = local.at(-1);
      }
    } else if (ref.startsWith("refs/remotes/")) {
      remote.push(ref.slice("refs/remotes/".length));
    }
  }
  for (const name of remote) {
    if (hidden.has(remoteForRef(name, remotes))) {
      excluded.add(name);
    }
  }
  if (matches === null) {
    return {
      excluded,
      hiddenBranches,
      branchArgs: ["--branches"],
      logArgs: remoteLogArgs(remotes, hidden, [])
    };
  }

  // Every remote a remote-tracking branch can belong to, orphaned refs' first segment included.
  const owners = new Set([...remotes, ...remote.map((name) => remoteForRef(name, remotes))]);
  const patterns = cleanPatterns(options.hiddenBranchPatterns ?? []);
  const shown: string[] = [];
  for (const name of local) {
    if (name !== head && matches(name)) {
      if (name === options.shownBranch) {
        shown.push(`refs/heads/${name}`);
      } else {
        hiddenBranches.add(name);
      }
    }
  }
  for (const name of remote) {
    if (!excluded.has(name) && matchesRemoteBranch(name, owners, matches)) {
      if (`remotes/${name}` === options.shownBranch) {
        shown.push(`refs/remotes/${name}`);
      } else {
        excluded.add(name);
      }
    }
  }
  const remotePatterns = [...owners].flatMap((owner) =>
    patterns.map((pattern) => `${literal(owner)}/${pattern}`)
  );
  return {
    excluded,
    hiddenBranches,
    branchArgs: [...patterns.map((pattern) => `--exclude=${pattern}`), "--branches"],
    logArgs: [...(showRemotes ? remoteLogArgs(remotes, hidden, remotePatterns) : []), ...shown]
  };
}
