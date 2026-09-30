import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, vi } from "vitest";

import { makeRepo } from "@tests/backend/helpers";

/** Shell-script executables stand in for Git in some tests; Windows cannot run them. */
export const onWindows = process.platform === "win32";

/** Git's output in `cwd` without its final newline. Throws when Git fails. */
export function run(cwd: string, ...args: string[]) {
  return execFileSync("git", args, { cwd, stdio: "pipe", encoding: "utf8" }).replace(/\n$/, "");
}

/** Whether Git exits with status zero. */
export function succeeds(cwd: string, ...args: string[]) {
  return spawnSync("git", args, { cwd, stdio: "ignore" }).status === 0;
}

/**
 * Temporary folders and repositories for the running test, removed once it ends, so that each
 * test starts from its own state.
 */
export function sandbox() {
  const made: string[] = [];
  afterEach(() => {
    for (const dir of made.splice(0).toReversed()) {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  });
  const folder = (label = "box") => {
    const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), `ngg-${label}-`)));
    made.push(dir);
    return dir;
  };
  return {
    folder,
    /** A repository on `main` whose only commit adds `f` containing "x". */
    repo() {
      const dir = makeRepo();
      made.push(dir);
      return dir;
    },
    bare() {
      const dir = folder("bare");
      run(dir, "init", "-q", "--bare");
      return dir;
    },
    clone(source: string) {
      const dir = folder("clone");
      run(dir, "clone", "-q", source, ".");
      return dir;
    }
  };
}

export function readFile(repo: string, file: string) {
  return fs.readFileSync(path.join(repo, file), "utf8");
}

export function writeFile(repo: string, file: string, text: string) {
  fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
  fs.writeFileSync(path.join(repo, file), text);
}

/** Write `file`, commit it on the checked-out branch, and return the new commit. */
export function commitFile(repo: string, file: string, text: string, message = `edit ${file}`) {
  writeFile(repo, file, text);
  run(repo, "add", "--", file);
  run(repo, "commit", "-q", "-m", message);
  return run(repo, "rev-parse", "HEAD");
}

/** Whether the repository's Git directory holds `name`, such as `MERGE_HEAD`. */
export function hasGitFile(repo: string, name: string) {
  return fs.existsSync(path.resolve(repo, run(repo, "rev-parse", "--git-path", name)));
}

/** Every ref with its object, one per line, for before-and-after comparisons. */
export function allRefs(repo: string) {
  return run(repo, "for-each-ref", "--format=%(objectname) %(refname)");
}

/**
 * Give `repo` a remote `origin` whose SSH connection hangs. The SSH command first records Git's
 * `GIT_TERMINAL_PROMPT` and its own process ID. Call `connected()` to wait for them.
 */
export function stalledOrigin(repo: string) {
  const marker = path.join(repo, ".git", "stalled-ssh");
  const target = marker.split(path.sep).join("/");
  run(repo, "remote", "add", "origin", "ssh://git@stalled.invalid/project.git");
  // Git appends the host and command as arguments; they become the ignored $1 and $2.
  run(
    repo,
    "config",
    "core.sshCommand",
    `sh -c 'printf "%s %s" "$GIT_TERMINAL_PROMPT" "$$" > "${target}"; exec sleep 30' stalled-ssh`
  );
  return {
    async connected() {
      const text = await vi.waitFor(
        () => {
          const recorded = fs.existsSync(marker) ? fs.readFileSync(marker, "utf8") : "";
          if (!/^\S* \d+$/.test(recorded)) {
            throw new Error("The SSH command has not started yet");
          }
          return recorded;
        },
        { timeout: 10_000, interval: 50 }
      );
      const [prompt = "", pid = ""] = text.split(" ");
      return { prompt, pid: Number(pid) };
    }
  };
}

/** Whether a process is still running, as opposed to finished, even if not yet reaped. */
export function isRunning(pid: number) {
  const status = spawnSync("ps", ["-o", "stat=", "-p", String(pid)], { encoding: "utf8" });
  const state = status.stdout.trim();
  return status.status === 0 && state !== "" && !state.startsWith("Z");
}

/**
 * Run `body` with `GIT_TERMINAL_PROMPT` unset, so that only the code under test can set it, and
 * restore the caller's value afterwards.
 */
export async function withoutPromptSetting<T>(body: () => Promise<T>) {
  const inherited = process.env["GIT_TERMINAL_PROMPT"];
  delete process.env["GIT_TERMINAL_PROMPT"];
  try {
    return await body();
  } finally {
    if (inherited !== undefined) {
      process.env["GIT_TERMINAL_PROMPT"] = inherited;
    }
  }
}
