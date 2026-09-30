const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  downloadAndUnzipVSCode,
  resolveCliPathFromVSCodeExecutablePath,
  runTests
} = require("@vscode/test-electron");
const { createVSIX } = require("@vscode/vsce");

const { checkRelease } = require("./check-release.cjs");

async function main() {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "package.json"), "utf8"));
  const expected = checkRelease(manifest);
  const vsix = path.resolve(process.argv[2] || `${manifest.name}-${manifest.version}.vsix`);
  assert.ok(fs.existsSync(vsix), `Build the VSIX first: ${vsix}`);
  const executable = process.env.NGG_VSCODE_PATH || (await downloadAndUnzipVSCode("stable"));
  const temp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-package-")));
  try {
    const extensions = path.join(temp, "extensions");
    const profile = ["--extensions-dir", extensions, "--user-data-dir", path.join(temp, "user")];
    const cli = resolveCliPathFromVSCodeExecutablePath(executable);
    // Use Node directly on Windows to avoid shell quoting of .cmd paths and VSIX arguments.
    const command = process.platform === "win32" ? process.execPath : cli;
    const cliArgs =
      process.platform === "win32"
        ? [path.resolve(path.dirname(cli), "../resources/app/out/cli.js")]
        : [];
    const runCLI = (args) =>
      execFileSync(command, [...cliArgs, ...profile, ...args], {
        encoding: "utf8",
        env: { ...process.env, VSCODE_IPC_HOOK_CLI: "" },
        timeout: 120000
      }).trim();

    // Install a minimal older build first, so a publisher/name mistake creates a detectable duplicate.
    const previous = path.join(temp, "previous");
    fs.mkdirSync(previous);
    fs.writeFileSync(
      path.join(previous, "package.json"),
      JSON.stringify({
        name: manifest.name,
        publisher: manifest.publisher,
        version: "0.0.0",
        displayName: manifest.displayName,
        description: "Package upgrade test fixture",
        engines: manifest.engines,
        repository: manifest.repository,
        license: manifest.license
      })
    );
    fs.copyFileSync(path.join(__dirname, "..", "LICENSE"), path.join(previous, "LICENSE"));
    fs.writeFileSync(path.join(previous, "README.md"), "# Package upgrade test fixture\n");
    const oldVSIX = path.join(temp, "previous.vsix");
    await createVSIX({ cwd: previous, dependencies: false, packagePath: oldVSIX });
    runCLI(["--install-extension", oldVSIX]);
    assert.equal(
      runCLI(["--list-extensions", "--show-versions"]),
      `${manifest.publisher}.${manifest.name}@0.0.0`
    );
    runCLI(["--install-extension", vsix, "--force"]);
    assert.equal(
      runCLI(["--list-extensions", "--show-versions"]),
      expected,
      "Installation must upgrade the existing installation without adding another extension"
    );

    const workspace = path.join(temp, "workspace");
    fs.mkdirSync(workspace);
    execFileSync("git", ["init", "-b", "main", workspace], { stdio: "pipe" });
    const harness = path.join(temp, "harness");
    fs.mkdirSync(harness);
    fs.writeFileSync(
      path.join(harness, "package.json"),
      JSON.stringify({
        name: "package-smoke-harness",
        publisher: "test",
        version: "0.0.0",
        engines: manifest.engines
      })
    );
    await runTests({
      vscodeExecutablePath: executable,
      extensionDevelopmentPath: harness,
      extensionTestsPath: path.join(__dirname, "package-smoke.cjs"),
      extensionTestsEnv: {
        NGG_EXTENSION_ID: `${manifest.publisher}.${manifest.name}`,
        NGG_EXTENSION_VERSION: manifest.version,
        NGG_EXTENSIONS_DIR: extensions
      },
      launchArgs: [
        workspace,
        ...profile,
        "--disable-gpu",
        "--locale=en",
        ...(process.env.NGG_HEADLESS === "1" ? ["--ozone-platform=headless"] : [])
      ]
    });
    process.stdout.write(`Verified upgrade and activation of ${expected}\n`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  process.stderr.write((error.stack || String(error)) + "\n");
  process.exitCode = 1;
});
