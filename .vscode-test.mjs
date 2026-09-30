// Configuration of `vscode-test` (@vscode/test-cli), which runs the tests under tests-ext/ inside
// VS Code, with this folder as the extension under development. The set-up below runs whenever the
// runner loads this file, so every run gets its own workspace, profile and debugging port.
import { execFileSync } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { defineConfig } from "@vscode/test-cli";

const root = import.meta.dirname;
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));

// The oldest supported VS Code, which NGG_VSCODE_VERSION=minimum selects.
const engine = manifest.engines?.vscode;
const minimum = /^\^(\d+\.\d+\.\d+)$/.exec(engine ?? "")?.[1];
if (minimum === undefined) {
  throw new Error(
    `engines.vscode in package.json is ${JSON.stringify(engine)}, but .vscode-test.mjs reads ` +
      "the minimum VS Code version only from the form ^X.Y.Z. Update that rule for the new form."
  );
}
const requested = process.env.NGG_VSCODE_VERSION || "stable";
const version = requested === "minimum" ? minimum : requested;
const artifacts = path.resolve(process.env.NGG_ARTIFACTS || "test-results");
const gitConfig = path.join(root, "tests", "fixtures", "gitconfig");

// A fresh folder for this run. On macOS it goes in /tmp: the system's temporary folder there is
// nested so deeply that the IPC socket paths VS Code creates inside the profile would pass the
// 103-byte limit.
const temporary = process.platform === "darwin" ? "/tmp" : os.tmpdir();
const run = fs.realpathSync(fs.mkdtempSync(path.join(temporary, "ngg-extension-tests-")));
process.on("exit", () => {
  try {
    // A few retries for files that VS Code has not quite let go of.
    fs.rmSync(run, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {
    // Left for the system to clean up with the rest of its temporary files.
  }
});

// The window's only folder: an empty repository on branch main, with no commits.
const workspace = path.join(run, "workspace");
fs.mkdirSync(workspace);
execFileSync("git", ["init", "--quiet", "--initial-branch=main", workspace], {
  env: { ...process.env, GIT_CONFIG_GLOBAL: gitConfig, GIT_CONFIG_NOSYSTEM: "1" }
});

// VS Code writes its logs straight into the artefacts, so they survive even a failed start.
const logs = path.join(artifacts, "vscode-logs", path.basename(run));
fs.mkdirSync(logs, { recursive: true });

// A setting saved under the extension's name before the rename, which activation copies to the
// new name; tests-ext/extension.test.ts checks the copy. It holds the setting's default, so no
// other test sees a difference.
const userData = path.join(run, "user-data");
fs.mkdirSync(path.join(userData, "User"), { recursive: true });
fs.writeFileSync(
  path.join(userData, "User", "settings.json"),
  `${JSON.stringify({ "neo-git-graph.showUncommittedChanges": true }, null, 2)}\n`
);

// A free port for the Chrome DevTools Protocol, through which the UI tests drive the window.
const server = net.createServer().listen(0, "127.0.0.1");
await once(server, "listening");
const { port } = server.address();
server.close();
await once(server, "close");

export default defineConfig({
  files: ["tests-ext/out/**/*.test.js", "tests-ext/ui/**/*.test.cjs"],
  workspaceFolder: workspace,
  version,
  // An installed VS Code instead of a downloaded one; an empty value counts as unset.
  useInstallation: { fromPath: process.env.NGG_VSCODE_PATH || undefined },
  env: {
    GIT_CONFIG_GLOBAL: gitConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    NGG_CDP_PORT: String(port),
    NGG_ARTIFACTS: artifacts,
    NGG_VSCODE_LOGS: logs,
    NGG_MINIMUM_VSCODE_VERSION: minimum,
    NGG_EXPECTED_VSCODE_VERSION: version,
    NGG_EXTENSION_ID: `${manifest.publisher}.${manifest.name}`
  },
  launchArgs: [
    // Reliable rendering under Xvfb, headless Linux and CI virtual machines.
    "--disable-gpu",
    // Tab, focus and screenshot checks see only what the tests open.
    "--skip-welcome",
    "--skip-release-notes",
    // The manifest does not support untrusted workspaces, and nobody is there to trust this one.
    "--disable-workspace-trust",
    // The tests assert English text.
    "--locale=en",
    `--user-data-dir=${userData}`,
    // No installed extension loads.
    `--extensions-dir=${path.join(run, "extensions")}`,
    `--logsPath=${logs}`,
    `--remote-debugging-port=${port}`,
    ...(process.env.NGG_HEADLESS === "1" ? ["--ozone-platform=headless"] : [])
  ],
  // VS Code starts slowly on CI, and the UI steps wait for the window.
  mocha: { timeout: 30_000 }
});
