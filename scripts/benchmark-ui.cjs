const { spawnSync } = require("node:child_process");
const { dirname, join } = require("node:path");

const cli = join(dirname(require.resolve("@vscode/test-cli")), "bin.mjs");
const result = spawnSync(
  process.execPath,
  [cli, "--grep", "benchmarks large graph interactions", "--bail"],
  {
    stdio: "inherit",
    env: { ...process.env, NGG_BENCH_UI: "1" }
  }
);
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
