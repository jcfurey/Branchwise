import fs from "node:fs";

import { afterEach, beforeEach, expect, it } from "vitest";

import { createGit } from "@/backend/gitClient";
import { readGitWithInput } from "@/backend/utils/runGit";

import { makeRepo } from "@tests/backend/helpers";

let repo = "";
let failures: unknown[] = [];
const record = (error: unknown) => failures.push(error);

beforeEach(() => {
  repo = makeRepo();
  failures = [];
  process.on("uncaughtException", record);
});
afterEach(() => {
  process.off("uncaughtException", record);
  fs.rmSync(repo, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

it("survives a Git that ends without reading what it was sent", async () => {
  // Far more than a pipe holds, to a command that reads nothing: the write fails once Git has
  // gone. With nothing listening for that, Node raises it as an uncaught exception, which in
  // the extension host belongs to nobody's request.
  const unread = "x".repeat(8 * 1024 * 1024);

  expect(await readGitWithInput(createGit(repo, "git"), ["--version"], unread)).toMatch(
    /^git version /
  );
  // The failed write is reported after the process has closed.
  await new Promise((resolve) => setTimeout(resolve, 200));

  expect(failures).toEqual([]);
});
