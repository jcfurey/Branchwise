import { type ChildProcess, execFile, spawn } from "node:child_process";

import type { SimpleGit } from "simple-git";

import { gitProcessOf, PARSED_OUTPUT_ARGS } from "@/backend/gitClient";

type GitResult = { stdout: Buffer; stderr: string };

/**
 * Start Git in `cwd` and collect its output. On POSIX, a process that can be stopped gets its
 * own process group, so stopping it also stops the SSH or credential helper Git runs.
 */
function start(
  binary: string,
  args: string[],
  cwd: string,
  env: NodeJS.ProcessEnv,
  options: { input?: Buffer; stoppable?: boolean } = {}
) {
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
      const result = { stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
      if (code === 0) {
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

/** A blob's exact bytes, which a string result would corrupt for binary files. */
export async function readBlob(git: SimpleGit, blob: string): Promise<Buffer> {
  const binary = gitProcessOf(git)?.gitPath ?? "git";
  const { done } = start(binary, ["cat-file", "blob", blob], await topLevel(git), process.env);
  return (await done).stdout;
}
