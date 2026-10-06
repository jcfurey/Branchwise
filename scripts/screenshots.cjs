// Regenerates the README's screenshots in docs/images/ (see docs/testing.md).
const { spawnSync } = require("node:child_process");
const { dirname, join } = require("node:path");

const cli = join(dirname(require.resolve("@vscode/test-cli")), "bin.mjs");
const result = spawnSync(
  process.execPath,
  [cli, "--grep", "captures the README screenshots", "--bail"],
  {
    stdio: "inherit",
    env: { ...process.env, NGG_SCREENSHOTS: "1" }
  }
);
if (result.error) {
  throw result.error;
}
process.exitCode = result.status ?? 1;
