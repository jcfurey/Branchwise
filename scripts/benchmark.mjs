/* eslint-disable no-await-in-loop -- Sequential measurements avoid contention between cases. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";

import { build } from "esbuild";

import fixtureTools from "./benchmark-fixture.cjs";

const { createBenchmarkRepository, summarize } = fixtureTools;
const total = Number(process.env.NGG_BENCH_COMMITS || 50000);
const children = Number(process.env.NGG_BENCH_SUBMODULES || 40);
assert.ok(Number.isSafeInteger(total) && total >= 1000 && total <= 500000);
assert.ok(Number.isSafeInteger(children) && children > 0 && children <= 200);
const fixture = mkdtempSync(join(tmpdir(), "ngg-benchmark-"));
const artifacts = resolve("test-results");
mkdirSync(artifacts, { recursive: true });
const bundle = join(artifacts, "benchmark-query.cjs");
const git = (args, cwd = fixture, input) =>
  execFileSync("git", args, {
    cwd,
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024
  })
    .toString()
    .trim();

try {
  await build({
    stdin: {
      contents: `export {loadHistory} from "./src/backend/queries/history";
export {loadWorkspace} from "./src/backend/queries/workspace";
export {loadCommits} from "./src/backend/queries/loadCommits";
export {loadBranchFocus} from "./src/backend/queries/branchFocus";
export {gitClientFactory} from "./src/backend/gitClient";
export {computeGraphLayout} from "./src/webview/graph/layout";`,
      resolveDir: process.cwd(),
      loader: "ts"
    },
    bundle: true,
    platform: "node",
    format: "cjs",
    outfile: bundle,
    logLevel: "silent"
  });
  const {
    loadHistory,
    loadWorkspace,
    loadCommits,
    loadBranchFocus,
    gitClientFactory,
    computeGraphLayout
  } = createRequire(import.meta.url)(bundle);
  const topology = createBenchmarkRepository(fixture, total);
  const head = git(["rev-parse", "HEAD"]);
  const modules = [];
  for (let index = 0; index < children; index++) {
    const name = `module-${index}`;
    git(["clone", "--shared", "--quiet", fixture, join(fixture, name)]);
    git(["update-index", "--add", "--cacheinfo", "160000", head, name]);
    modules.push(`[submodule "${name}"]\n\tpath = ${name}\n\turl = ${fixture}\n`);
  }
  writeFileSync(join(fixture, ".gitmodules"), modules.join(""));
  git(["add", ".gitmodules"]);
  git([
    "-c",
    "user.name=Benchmark",
    "-c",
    "user.email=benchmark@example.test",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-m",
    "add benchmark submodules"
  ]);
  const client = gitClientFactory(fixture, "git").getInstance();
  const filter = {
    text: "",
    author: "",
    since: "",
    until: "",
    path: "",
    revision: "",
    follow: false
  };
  const timings = {};
  async function measure(name, run) {
    const samples = [];
    for (let index = 0; index < 3; index++) {
      const started = performance.now();
      // Deliberately measure sequential samples to avoid contention between cases.
      // eslint-disable-next-line no-await-in-loop
      await run();
      samples.push(Math.round((performance.now() - started) * 10) / 10);
    }
    timings[name] = summarize(samples);
  }
  await measure("historyPage", async () =>
    assert.equal((await loadHistory(client, filter, 0)).entries.length, 100)
  );
  await measure("oldCommitSearch", async () =>
    assert.equal(
      (await loadHistory(client, { ...filter, text: "historical benchmark needle" }, 0)).entries
        .length,
      1
    )
  );
  await measure("workspaceSubmodules", async () =>
    assert.equal((await loadWorkspace([fixture], "git")).length, children + 1)
  );
  const graphInput = {
    branchName: "",
    maxCommits: 300,
    showRemoteBranches: true,
    hiddenRemotes: [],
    hard: true,
    dateType: "Author Date",
    showUncommittedChanges: false
  };
  for (const count of [300, 1000, 3000]) {
    await measure(`graphLoad${count}`, async () => {
      assert.equal(
        (await loadCommits(client, { ...graphInput, maxCommits: count })).commits.length,
        Math.min(count, topology.commits + 1)
      );
    });
  }
  await measure("hideOrigin3000", async () => {
    const page = await loadCommits(client, {
      ...graphInput,
      maxCommits: 3000,
      hiddenRemotes: ["origin"]
    });
    assert.equal(page.commits.length, Math.min(3000, topology.commits + 1 - 80));
    assert.ok(page.commits.every((commit) => !commit.message.startsWith("origin lane")));
    assert.ok(page.commits.some((commit) => commit.message.startsWith("upstream lane")));
  });
  const focusHashes = (await loadCommits(client, { ...graphInput, maxCommits: 3000 })).commits.map(
    (commit) => commit.hash
  );
  const wanted = new Set(focusHashes);
  for (const branch of ["main", "bench/topic", "remotes/origin/lane-0"]) {
    await measure(`focus:${branch}`, async () => {
      const focus = await loadBranchFocus(client, branch, focusHashes);
      assert.ok(focus.direct.length > 0 && focus.merged.length > 0);
      assert.ok([...focus.direct, ...focus.merged].every((hash) => wanted.has(hash)));
    });
  }
  const commits = Array.from({ length: 10000 }, (_, index) => ({
    hash: String(index),
    parentHashes:
      index < 9999
        ? [String(index + 1), ...(index % 20 === 0 && index < 9970 ? [String(index + 20)] : [])]
        : [],
    refs: [],
    author: "Benchmark",
    email: "benchmark@example.test",
    date: 0,
    message: "commit"
  }));
  await measure("graphLayout10000", () => computeGraphLayout(commits, "0"));
  await measure("cancelHistoryQuery", async () => {
    const controller = new AbortController();
    const task = gitClientFactory(fixture, "git", controller.signal)
      .getInstance()
      .raw(["log", "--all", "--format=%H%B"]);
    const timer = setTimeout(() => controller.abort(), 5);
    try {
      await assert.rejects(task);
    } finally {
      clearTimeout(timer);
    }
  });
  const report = {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    git: git(["--version"]),
    ...topology,
    commits: topology.commits + 1,
    submodules: children,
    graphCommits: commits.length,
    timings
  };
  writeFileSync(join(artifacts, "benchmark.json"), JSON.stringify(report, null, 2) + "\n");
  process.stdout.write(JSON.stringify(report, null, 2) + "\n");
} finally {
  rmSync(fixture, { recursive: true, force: true });
  rmSync(bundle, { force: true });
}
