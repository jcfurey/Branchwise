const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");

function git(args, cwd, input) {
  return execFileSync("git", args, {
    cwd,
    input,
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 128 * 1024 * 1024
  })
    .toString()
    .trim();
}

/** Deterministic history: a long main line, merged topics, and independent remote lanes. */
function createBenchmarkRepository(directory, mainCommits = 50000) {
  assert.ok(Number.isSafeInteger(mainCommits) && mainCommits >= 1000 && mainCommits <= 500000);
  git(["init", "-b", "main"], directory);
  const stream = [];
  let mark = 0;
  function commit(ref, message, parents = []) {
    const id = ++mark;
    stream.push(
      `commit ${ref}\nmark :${id}\ncommitter Benchmark <benchmark@example.test> ${1700000000 + id} +0000\ndata ${Buffer.byteLength(message)}\n${message}\n${parents.map((parent, index) => `${index ? "merge" : "from"} :${parent}\n`).join("")}\n`
    );
    return id;
  }
  let main;
  let topic;
  for (let index = 0; index < mainCommits; index++) {
    if (index > 0 && index % 50 === 0) {
      topic = commit("refs/heads/bench/topic", "merged topic", [main]);
      topic = commit("refs/heads/bench/topic", "merged topic follow-up", [topic]);
      main = commit("refs/heads/main", "main before merge", [main]);
      main = commit("refs/heads/main", "merge topic", [main, topic]);
    } else {
      main = commit(
        "refs/heads/main",
        index === 0 ? "historical benchmark needle" : `main ${index}`,
        main ? [main] : []
      );
    }
  }
  for (const remote of ["origin", "upstream"]) {
    for (let lane = 0; lane < 8; lane++) {
      let parent = main;
      for (let index = 0; index < 10; index++) {
        parent = commit(
          `refs/remotes/${remote}/lane-${lane}`,
          `${remote} lane ${lane} commit ${index}`,
          [parent]
        );
      }
    }
  }
  git(["-c", "gc.auto=0", "fast-import", "--quiet"], directory, stream.join(""));
  git(["reset", "--hard", "HEAD"], directory);
  for (const remote of ["origin", "upstream"]) {
    git(["remote", "add", remote, "."], directory);
  }
  assert.equal(Number(git(["rev-list", "--all", "--count"], directory)), mark);
  return {
    commits: mark,
    baseCommits: mainCommits,
    remoteLanes: 16,
    merges: Math.floor((mainCommits - 1) / 50)
  };
}

function summarize(samples) {
  const sorted = samples.toSorted((a, b) => a - b);
  const median =
    (sorted[Math.floor((sorted.length - 1) / 2)] + sorted[Math.floor(sorted.length / 2)]) / 2;
  return {
    samplesMs: samples.map((value) => Math.round(value * 10) / 10),
    medianMs: Math.round(median * 10) / 10,
    p95Ms: Math.round(sorted[Math.ceil(sorted.length * 0.95) - 1] * 10) / 10
  };
}

module.exports = { createBenchmarkRepository, git, summarize };
