import { type ChildProcess, execFile, spawn } from "node:child_process";

import type { SimpleGit } from "simple-git";

import { gitProcessOf, PARSED_OUTPUT_ARGS } from "@/backend/gitClient";

type GitResult = { stdout: Buffer; stderr: string; code: number };

/**
 * Start Git in `cwd` and collect its output. On POSIX, a process that can be stopped gets its
 * own process group, so stopping it also stops the SSH or credential helper Git runs.
 */
function start(
  binary: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  options: { input?: Uint8Array; stoppable?: boolean; codes?: number[] } = {}
) {
  const codes = options.codes ?? [0];
  const child = spawn(binary, [...PARSED_OUTPUT_ARGS, ...args], {
    cwd,
    env: { ...env, GIT_TERMINAL_PROMPT: "0" },
    windowsHide: true,
    detached: options.stoppable === true && process.platform !== "win32"
  });
  const done = new Promise<GitResult>((resolve, reject) => {
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      const result = {
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString(),
        code: code ?? -1
      };
      if (code !== null && codes.includes(code)) {
        resolve(result);
      } else {
        const message = [result.stdout.toString(), result.stderr].filter(Boolean).join("\n");
        reject(new Error(message || `git ${args[0] ?? ""} exited with ${code}`));
      }
    });
  });
  child.stdin.end(options.input);
  return { child, done };
}

/**
 * Stop a Git process and every process it started. On Windows, `git.exe` in `Git\cmd` is a
 * launcher for the real Git, so killing only the launcher would leave Git running.
 */
function killTree(child: ChildProcess) {
  if (child.pid === undefined || child.exitCode !== null) {
    return;
  }
  if (process.platform === "win32") {
    execFile("taskkill", ["/pid", String(child.pid), "/T", "/F"], { windowsHide: true }, () => {});
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
}

async function topLevel(git: SimpleGit) {
  return (await git.raw(["rev-parse", "--show-toplevel"])).replace(/\n$/, "");
}

/**
 * Where read-only commands run: the work tree's top level or, since a bare repository has no work
 * tree to run in, the Git directory itself. A caller that runs many commands asks once.
 */
export async function readDirectory(git: SimpleGit) {
  return topLevel(git).catch(async () =>
    (await git.raw(["rev-parse", "--absolute-git-dir"])).replace(/\n$/, "")
  );
}

/**
 * Run Git with exact exit-code handling, for commands with editors or stdout-only failures, and
 * for network commands. Git never prompts on a terminal, which nobody can answer here; it fails
 * instead. Cancelling the client's abort signal stops the process and those it started.
 */
export async function runGit(
  git: SimpleGit,
  args: string[],
  binary = gitProcessOf(git)?.gitPath ?? "git",
  env: NodeJS.ProcessEnv = process.env
) {
  const cwd = await topLevel(git);
  const signal = gitProcessOf(git)?.abort;
  signal?.throwIfAborted();
  const { child, done } = start(binary, args, cwd, env, { stoppable: signal !== undefined });
  const { promise: stopped, reject } = Promise.withResolvers<never>();
  const stop = () => {
    killTree(child);
    reject(signal?.reason ?? new Error("Aborted"));
  };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    return (await Promise.race([done, stopped])).stdout.toString();
  } finally {
    // A stopped process still settles later.
    done.catch(() => {});
    signal?.removeEventListener("abort", stop);
  }
}

/** Store `content` byte for byte as a Git blob, without filters, and return its object ID. */
export async function writeBlob(git: SimpleGit, content: Buffer) {
  const binary = gitProcessOf(git)?.gitPath ?? "git";
  const { done } = start(
    binary,
    ["hash-object", "-w", "--no-filters", "--stdin"],
    await topLevel(git),
    process.env,
    { input: content }
  );
  return (await done).stdout.toString().trim();
}

/**
 * Run a Git command that takes its revisions or instructions on standard input (`--stdin`), such
 * as `rev-list` or `update-ref`. Any number of them fits there, where the command line is limited
 * to 32,767 characters on Windows. Bytes go in unchanged, such as a file's text in its own encoding.
 */
export async function readGitWithInput(git: SimpleGit, args: string[], input: string | Uint8Array) {
  const binary = gitProcessOf(git)?.gitPath ?? "git";
  const cwd = await readDirectory(git);
  const bytes = typeof input === "string" ? Buffer.from(input) : input;
  const { done } = start(binary, args, cwd, process.env, { input: bytes });
  return (await done).stdout.toString();
}

/**
 * `readGitWithInput` for output that must be read byte for byte, such as `cat-file --batch`.
 * It runs in `cwd` when the caller knows a folder of the repository already.
 */
export async function readBytesWithInput(
  git: SimpleGit,
  args: string[],
  input: string,
  cwd?: string
) {
  const binary = gitProcessOf(git)?.gitPath ?? "git";
  const { done } = start(binary, args, cwd ?? (await readDirectory(git)), process.env, {
    input: Buffer.from(input)
  });
  return (await done).stdout;
}

/**
 * Run a read-only Git command in `cwd` that starts a program of the user's choosing, such as gpg
 * or ssh-keygen checking a signature, which may wait forever on a passphrase, a missing agent or
 * a key server. After `timeout` milliseconds the command and everything it started are stopped,
 * and the answer is `null`. Cancelling the client's abort signal stops them too, and rejects.
 * Git's own messages are in English, so that callers can recognise them.
 */
export async function readGitWithTimeout(
  git: SimpleGit,
  args: string[],
  cwd: string,
  timeout: number
): Promise<{ stdout: string; stderr: string } | null> {
  const { gitPath = "git", abort: signal } = gitProcessOf(git) ?? {};
  signal?.throwIfAborted();
  const env = { ...process.env, LC_ALL: "C", LANGUAGE: "" };
  const { child, done } = start(gitPath, args, cwd, env, { stoppable: true });
  const { promise: stopped, resolve, reject } = Promise.withResolvers<null>();
  const timer = setTimeout(() => {
    killTree(child);
    resolve(null);
  }, timeout);
  const stop = () => {
    killTree(child);
    reject(signal?.reason ?? new Error("Aborted"));
  };
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const result = await Promise.race([done, stopped]);
    return result && { stdout: result.stdout.toString(), stderr: result.stderr };
  } finally {
    clearTimeout(timer);
    // A stopped process still settles later.
    done.catch(() => {});
    signal?.removeEventListener("abort", stop);
  }
}

/**
 * Run a read-only Git command whose exit code is part of its answer, such as `merge-tree`, which
 * exits with 1 for a merge with conflicts. Any code outside `codes` rejects, as other failures do.
 * `options.cwd` comes from `readDirectory`; `options.env` replaces the whole environment.
 */
export async function readGitCode(
  git: SimpleGit,
  args: string[],
  codes: number[],
  options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}
) {
  const binary = gitProcessOf(git)?.gitPath ?? "git";
  const cwd = options.cwd ?? (await readDirectory(git));
  const { done } = start(binary, args, cwd, options.env ?? process.env, { codes });
  const { stdout, code } = await done;
  return { stdout: stdout.toString(), code };
}

/** Git's exact output bytes, such as a patch of a file in any encoding, which a string would corrupt. */
export async function readGitBytes(git: SimpleGit, args: string[]): Promise<Buffer> {
  const binary = gitProcessOf(git)?.gitPath ?? "git";
  const { done } = start(binary, args, await topLevel(git), process.env);
  return (await done).stdout;
}

/**
 * The first `limit` NUL-terminated records a read-only Git command prints, as bytes, and whether
 * it printed more. Git is stopped as soon as one record too many arrives, so a command that would
 * print millions of them, such as `ls-tree -r` of a huge tree, costs no more than the records
 * kept. Cancelling the client's abort signal stops Git as well, and rejects.
 */
export async function readGitRecords(
  git: SimpleGit,
  args: string[],
  limit: number
): Promise<{ records: Buffer[]; more: boolean }> {
  const { gitPath = "git", abort: signal } = gitProcessOf(git) ?? {};
  signal?.throwIfAborted();
  const cwd = await readDirectory(git);
  const { child, done } = start(gitPath, args, cwd, process.env, { stoppable: true });
  const records: Buffer[] = [];
  let partial: Buffer[] = [];
  const { promise: cut, resolve, reject } = Promise.withResolvers<boolean>();
  const stop = () => {
    killTree(child);
    reject(signal?.reason ?? new Error("Aborted"));
  };
  child.stdout.on("data", (chunk: Buffer) => {
    let from = 0;
    for (let end = chunk.indexOf(0); end !== -1; end = chunk.indexOf(0, from)) {
      if (records.length === limit) {
        killTree(child);
        resolve(true);
        return;
      }
      records.push(Buffer.concat([...partial, chunk.subarray(from, end)]));
      partial = [];
      from = end + 1;
    }
    if (from < chunk.length) {
      partial.push(chunk.subarray(from));
    }
  });
  signal?.addEventListener("abort", stop, { once: true });
  try {
    const more = await Promise.race([done.then(() => false), cut]);
    return { records, more };
  } finally {
    // A stopped process still settles later, as a failure.
    done.catch(() => {});
    signal?.removeEventListener("abort", stop);
  }
}

/** A blob's exact bytes, which a string result would corrupt for binary files. */
export async function readBlob(git: SimpleGit, blob: string): Promise<Buffer> {
  return readGitBytes(git, ["cat-file", "blob", blob]);
}

/**
 * Run Git with `input` on standard input and `env` as its environment, as when a patch is applied
 * to a private index that `GIT_INDEX_FILE` names.
 */
export async function runGitWithInput(
  git: SimpleGit,
  args: string[],
  input: Buffer,
  env: NodeJS.ProcessEnv
) {
  const binary = gitProcessOf(git)?.gitPath ?? "git";
  const { done } = start(binary, args, await topLevel(git), env, { input });
  return (await done).stdout.toString();
}
