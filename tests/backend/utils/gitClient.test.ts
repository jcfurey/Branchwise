import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { simpleGit } from "simple-git";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGit,
  gitClientFactory,
  gitProcessOf,
  PARSED_OUTPUT_ARGS,
  PARSED_OUTPUT_CONFIG
} from "@/backend/gitClient";

import { recordingGit } from "@tests/backend/queries/loadCommits/fixtures";
import { onWindows, run, sandbox, writeFile } from "@tests/backend/sandbox";

const box = sandbox();
const MISSING = path.join(path.parse(process.cwd()).root, "ngg-no-such-folder", "inner");

/** The Git executable on the PATH, as an absolute path. */
function installedGit() {
  return onWindows
    ? execFileSync("where", ["git"], { encoding: "utf8" }).split(/\r?\n/)[0]!.trim()
    : execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
}

/** The function `console.warn` is right now, to show that `createGit` put it back. */
// eslint-disable-next-line no-console -- These tests are about console output.
const currentWarn = () => console.warn;

/** What the client says the top level is, as Git on the command line would print it. */
const topLevel = (repo: string) => `${run(repo, "rev-parse", "--show-toplevel")}\n`;

/** A shell script at `bin/git` that runs `body`, where `$GIT` is the real Git. */
function wrapper(body: string) {
  const file = path.join(box.folder("bin"), "git");
  fs.writeFileSync(file, `#!/bin/sh\nGIT='${installedGit()}'\n${body}\n`, { mode: 0o755 });
  return file;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the settings every process starts with", () => {
  it("are exactly these, in this order", () => {
    expect(PARSED_OUTPUT_CONFIG).toEqual([
      "log.showSignature=false",
      "status.showUntrackedFiles=all",
      "color.ui=never",
      "color.branch=never",
      "color.diff=never",
      "color.status=never",
      "color.showBranch=never",
      "color.grep=never"
    ]);
    // Tests strip this prefix from recorded processes, so a change must be deliberate.
    expect(PARSED_OUTPUT_ARGS.join(" ")).toBe(
      "--no-optional-locks -c log.showSignature=false -c status.showUntrackedFiles=all " +
        "-c color.ui=never -c color.branch=never -c color.diff=never -c color.status=never " +
        "-c color.showBranch=never -c color.grep=never"
    );
    expect(PARSED_OUTPUT_ARGS).toHaveLength(17);
  });

  it.skipIf(onWindows)("precede each command", async () => {
    const repo = box.repo();
    const recorder = recordingGit(box.folder("bin"));
    await createGit(repo, recorder.gitPath).raw(["rev-parse", "HEAD"]);
    expect(recorder.runs()).toEqual(["rev-parse HEAD"]);
  });

  it("override the repository's colour and untracked-file settings", async () => {
    const repo = box.repo();
    run(repo, "config", "status.showUntrackedFiles", "no");
    run(repo, "config", "color.ui", "always");
    writeFile(repo, "untracked", "new");
    const client = createGit(repo, "git");
    expect(await client.raw(["status", "--porcelain"])).toBe("?? untracked\n");
    expect(await client.raw(["branch"])).toBe("* main\n");
  });
});

describe("createGit", () => {
  it("returns Git's output untrimmed", async () => {
    const repo = box.repo();
    expect(await createGit(repo, "git").raw(["rev-parse", "--abbrev-ref", "HEAD"])).toBe("main\n");
  });

  it("throws at once for a folder that does not exist", () => {
    expect(() => createGit(MISSING, "git")).toThrow(/does not exist/);
    expect(() => gitClientFactory(MISSING, "git")).toThrow(/does not exist/);
  });

  it.skipIf(onWindows)(
    "accepts an executable path with spaces and parentheses silently",
    async () => {
      const repo = box.repo();
      const portable = path.join(box.folder("portable git"), "Git (portable)", "git");
      fs.mkdirSync(path.dirname(portable));
      fs.symlinkSync(installedGit(), portable);
      const warn = vi.spyOn(console, "warn");
      const original = currentWarn();

      const client = createGit(repo, portable);
      expect(currentWarn()).toBe(original);
      expect((await client.raw(["rev-parse", "HEAD"])).trim()).toBe(run(repo, "rev-parse", "HEAD"));

      expect(() => createGit(MISSING, portable)).toThrow(/does not exist/);
      expect(currentWarn()).toBe(original);
      expect(warn).not.toHaveBeenCalled();
    }
  );

  it.skipIf(onWindows)("runs at most six processes at once", async () => {
    const repo = box.repo();
    const log = path.join(box.folder("log"), "events");
    const slow = wrapper(
      `echo start >> '${log}'\nsleep 0.5\n"$GIT" "$@"\nstatus=$?\necho end >> '${log}'\nexit $status`
    );
    const client = createGit(repo, slow);
    await Promise.all(Array.from({ length: 14 }, () => client.raw(["rev-parse", "HEAD"])));

    let running = 0;
    let most = 0;
    for (const event of fs.readFileSync(log, "utf8").split("\n").filter(Boolean)) {
      running += event === "start" ? 1 : -1;
      most = Math.max(most, running);
    }
    expect(running).toBe(0);
    expect(most).toBe(6);
  });

  it("refuses commands once its signal is aborted", async () => {
    const repo = box.repo();
    const controller = new AbortController();
    const client = createGit(repo, "git", controller.signal);
    controller.abort();
    await expect(client.raw(["rev-parse", "HEAD"])).rejects.toThrow(/Abort already signaled/);
  });

  it.skipIf(onWindows)("stops a running command when its signal is aborted", async () => {
    const repo = box.repo();
    const controller = new AbortController();
    // Git itself never runs: the stand-in only waits, as a slow command would.
    const client = createGit(repo, wrapper("exec sleep 5"), controller.signal);
    const pending = client.raw(["rev-parse", "HEAD"]);
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow(/Abort signal received/);
  });
});

describe("gitProcessOf", () => {
  it("reports the executable and signal a client was made with", () => {
    const repo = box.repo();
    const plain = gitProcessOf(createGit(repo, "git"));
    expect(plain).toEqual({ gitPath: "git" });
    expect(plain !== undefined && "abort" in plain).toBe(false);

    const signal = new AbortController().signal;
    const cancellable = gitProcessOf(createGit(repo, "/usr/bin/git", signal));
    expect(cancellable?.gitPath).toBe("/usr/bin/git");
    expect(cancellable?.abort).toBe(signal);
  });

  it("knows nothing of clients made elsewhere", () => {
    expect(gitProcessOf(simpleGit(box.repo()))).toBeUndefined();
  });
});

describe("gitClientFactory", () => {
  it("keeps one client until the folder or executable changes", async () => {
    const first = box.repo();
    const second = box.repo();
    const signal = new AbortController().signal;
    const factory = gitClientFactory(first, "git", signal);
    const original = factory.getInstance();
    expect(factory.getInstance()).toBe(original);

    factory.setRepo(second);
    const moved = factory.getInstance();
    expect(moved).not.toBe(original);
    expect(await moved.raw(["rev-parse", "--show-toplevel"])).toBe(topLevel(second));
    expect(gitProcessOf(moved)?.abort).toBe(signal);
    expect(await original.raw(["rev-parse", "--show-toplevel"])).toBe(topLevel(first));

    const executable = installedGit();
    factory.setGitPath(executable);
    const rebuilt = factory.getInstance();
    expect(rebuilt).not.toBe(moved);
    expect(gitProcessOf(rebuilt)).toEqual({ gitPath: executable, abort: signal });
    expect(await rebuilt.raw(["rev-parse", "--show-toplevel"])).toBe(topLevel(second));
  });

  it("keeps the current client when a replacement cannot be made", () => {
    const factory = gitClientFactory(box.repo(), "git");
    const current = factory.getInstance();
    expect(() => factory.setRepo(MISSING)).toThrow(/does not exist/);
    expect(factory.getInstance()).toBe(current);
  });
});
