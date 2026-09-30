const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const createDiagnostics = require("./diagnostics.cjs");

test("a disconnected renderer still leaves the original failure and browser errors", async (t) => {
  const artifacts = fs.mkdtempSync(path.join(os.tmpdir(), "ngg-diagnostics-"));
  t.after(() => fs.rmSync(artifacts, { recursive: true, force: true }));
  const diagnostics = createDiagnostics({
    artifacts,
    connections: [{ type: "page", ws: { readyState: 3 } }],
    graph: () => ({ evaluate: () => Promise.reject(new Error("Renderer disappeared")) }),
    runtime: { vscode: "1.125.0" }
  });
  diagnostics.start("renderer crash");
  diagnostics.record(
    { type: "iframe" },
    {
      method: "Runtime.exceptionThrown",
      params: { exceptionDetails: { text: "Original browser error" } }
    }
  );
  await diagnostics.capture(new Error("Original test failure"), "test failure");
  const directory = path.join(
    artifacts,
    fs.readdirSync(artifacts).find((name) => name.startsWith("failure-"))
  );
  const report = JSON.parse(fs.readFileSync(path.join(directory, "failure.json"), "utf8"));
  assert.match(report.error, /Original test failure/);
  assert.deepEqual(report.captureErrors.map((error) => error.artifact).toSorted(), [
    "DOM",
    "screenshot"
  ]);
  assert.match(
    fs.readFileSync(path.join(directory, "browser.jsonl"), "utf8"),
    /Original browser error/
  );
});
