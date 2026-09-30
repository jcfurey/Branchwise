import { simpleGit } from "simple-git";
import type { SimpleGit } from "simple-git";

/**
 * Settings pinned for every backend Git process, whatever the user configured, because the
 * parsers expect them: UTF-8 logs, no signature checks, no colour codes, and every untracked file.
 */
export const PARSED_OUTPUT_CONFIG: string[] = [
  "log.showSignature=false",
  "i18n.logOutputEncoding=UTF-8",
  "status.showUntrackedFiles=all",
  "color.ui=never",
  "color.branch=never",
  "color.diff=never",
  "color.status=never",
  "color.showBranch=never",
  "color.grep=never"
];

/**
 * The arguments every backend Git process starts with. Reads must not refresh the index as a side
 * effect, so optional locks are off.
 */
export const PARSED_OUTPUT_ARGS: string[] = [
  "--no-optional-locks",
  ...PARSED_OUTPUT_CONFIG.flatMap((setting) => ["-c", setting])
];

type GitProcess = { gitPath: string; abort?: AbortSignal };

// Clients are made per request, so the table must not keep them alive.
const processes = new WeakMap<SimpleGit, GitProcess>();

/**
 * The executable and abort signal a client was made with, so that processes started outside
 * simple-git can match it. Undefined for clients that `createGit` did not make.
 */
export function gitProcessOf(git: SimpleGit): GitProcess | undefined {
  return processes.get(git);
}

/**
 * simple-git refuses executable paths with spaces or parentheses unless told to accept them, and
 * then warns about them on the console. Such paths are legitimate here, and nobody reads the
 * warning, so it is dropped while the client is constructed.
 */
function withoutConsoleWarnings<T>(create: () => T): T {
  // eslint-disable-next-line no-console
  const warn = console.warn;
  // eslint-disable-next-line no-console
  console.warn = () => {};
  try {
    return create();
  } finally {
    // eslint-disable-next-line no-console
    console.warn = warn;
  }
}

/**
 * A client for the folder `repoPath`, starting each process with `PARSED_OUTPUT_ARGS`. Throws
 * at once when the folder does not exist. `abort` cancels everything the client runs.
 */
export function createGit(repoPath: string, gitPath: string, abort?: AbortSignal): SimpleGit {
  const git = withoutConsoleWarnings(() =>
    simpleGit({
      baseDir: repoPath,
      // simple-git adds its `-c` settings to the command, then puts this second entry first.
      binary: [gitPath, "--no-optional-locks"],
      config: [...PARSED_OUTPUT_CONFIG],
      maxConcurrentProcesses: 6,
      unsafe: { allowUnsafeCustomBinary: true },
      ...(abort ? { abort } : {})
    })
  );
  processes.set(git, abort ? { gitPath, abort } : { gitPath });
  return git;
}

/** Holds a client and replaces it when the folder or the executable changes. */
export function gitClientFactory(
  repoPath: string,
  gitPath: string,
  abort?: AbortSignal
): {
  getInstance: () => SimpleGit;
  setRepo(newRepoPath: string): void;
  setGitPath(newGitPath: string): void;
} {
  let folder = repoPath;
  let executable = gitPath;
  let client = createGit(folder, executable, abort);
  return {
    getInstance: () => client,
    setRepo(newRepoPath) {
      folder = newRepoPath;
      client = createGit(folder, executable, abort);
    },
    setGitPath(newGitPath) {
      executable = newGitPath;
      client = createGit(folder, executable, abort);
    }
  };
}
