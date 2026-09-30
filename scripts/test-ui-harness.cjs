/* eslint-disable no-console -- This script reports verification results to the terminal. */
const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const cli = path.join(path.dirname(require.resolve("@vscode/test-cli")), "bin.mjs");
const artifacts = path.resolve(process.env.NGG_ARTIFACTS || "test-results");
fs.mkdirSync(artifacts, { recursive: true });
const root = fs.mkdtempSync(path.join(artifacts, "ui-harness-"));
const read = (file) => JSON.parse(fs.readFileSync(file, "utf8"));

function run(label, { fault = false, minimum = false } = {}) {
  const directory = path.join(root, label);
  fs.mkdirSync(directory);
  const log = path.join(directory, "runner.log");
  const fd = fs.openSync(log, "w");
  console.log(`Running ${label}; output: ${log}`);
  let result;
  try {
    result = spawnSync(
      process.execPath,
      [cli, "--grep", "checks VS Code compatibility and graph controls", "--bail"],
      {
        cwd: path.resolve(__dirname, ".."),
        stdio: ["ignore", fd, fd],
        timeout: 300000,
        env: {
          ...process.env,
          NGG_ARTIFACTS: directory,
          NGG_VSCODE_VERSION: minimum ? "minimum" : "stable",
          NGG_VSCODE_PATH: minimum
            ? process.env.NGG_MINIMUM_VSCODE_PATH || ""
            : process.env.NGG_VSCODE_PATH || "",
          NGG_DIAGNOSTIC_FAULT: fault ? "1" : "0"
        }
      }
    );
  } finally {
    fs.closeSync(fd);
  }
  if (result.error || result.signal || result.status !== (fault ? 1 : 0)) {
    process.stderr.write(fs.readFileSync(log, "utf8"));
    throw result.error || new Error(`${label} exited ${result.status ?? result.signal}`);
  }
  const runtime = read(path.join(directory, "run.json"));
  if (!fault) {
    const smoke = read(path.join(directory, "compatibility-smoke.json"));
    assert.equal(smoke.passed, true, "The selected scenario must actually complete");
    assert.equal(smoke.vscode, runtime.vscode);
  }
  return { directory, runtime };
}

function logFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    return entry.isDirectory() ? logFiles(file) : entry.name.endsWith(".log") ? [file] : [];
  });
}

function verifyFailure({ directory, runtime }) {
  const failures = fs.readdirSync(directory).filter((name) => name.startsWith("failure-"));
  assert.equal(failures.length, 1, "Expected one failure capture before scenario cleanup");
  const failure = path.join(directory, failures[0]);
  const report = read(path.join(failure, "failure.json"));
  assert.match(report.error, /Timed out: NGG intentional diagnostic failure/);
  assert.equal(report.phase, "poll timeout");
  assert.deepEqual(report.captureErrors, []);
  assert.equal(report.vscode, runtime.vscode);
  assert.match(
    fs.readFileSync(path.join(failure, "webview.txt"), "utf8"),
    /NGG visible diagnostic marker/
  );
  assert.match(fs.readFileSync(path.join(failure, "webview.html"), "utf8"), /data-branchwise/);
  const screenshot = fs.readFileSync(path.join(failure, "workbench.png"));
  assert.equal(screenshot.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
  assert.ok(screenshot.length > 10000, "Expected a populated workbench screenshot");
  const events = fs
    .readFileSync(path.join(failure, "browser.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map(JSON.parse);
  assert.ok(
    events.some(
      (event) =>
        event.method === "Runtime.consoleAPICalled" &&
        JSON.stringify(event.params).includes("NGG console diagnostic marker")
    )
  );
  assert.ok(
    events.some(
      (event) =>
        event.method === "Runtime.exceptionThrown" &&
        JSON.stringify(event.params).includes("NGG uncaught diagnostic marker")
    )
  );
  const logs = logFiles(runtime.logs);
  assert.ok(
    logs.some((file) => file.endsWith("exthost.log")),
    "Extension host log must be retained"
  );
  assert.ok(
    logs.some((file) => fs.readFileSync(file, "utf8").includes("NGG extension diagnostic marker")),
    "Extension output channel errors must be retained"
  );
  assert.ok(
    logs.some((file) => fs.readFileSync(file, "utf8").includes("Extension activated")),
    "The extension's own output must be retained"
  );
  console.log(`Verified screenshot, DOM, browser errors, and extension logs: ${failure}`);
}

const failed = run("injected-failure", { fault: true });
verifyFailure(failed);
const stable = run("stable-recovery");
assert.equal(stable.runtime.vscode, failed.runtime.vscode, "Recovery must use the same VS Code");
const sameVersion = stable.runtime.vscode === stable.runtime.minimum;
const minimum = sameVersion ? stable : run("minimum", { minimum: true });
assert.equal(
  minimum.runtime.vscode,
  stable.runtime.minimum,
  "The declared minimum must actually run"
);
const report = {
  diagnostics: "passed",
  stable: stable.runtime,
  minimum: minimum.runtime,
  minimumRun: sameVersion ? "same version as stable; reused smoke result" : "separate smoke run"
};
fs.writeFileSync(path.join(root, "compatibility.json"), JSON.stringify(report, null, 2) + "\n");
console.log(
  `UI diagnostics verified; VS Code ${stable.runtime.vscode} and minimum ${minimum.runtime.vscode} passed. Report: ${root}`
);
