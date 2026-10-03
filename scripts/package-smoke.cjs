const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const vscode = require("vscode");

const { brokenLinks } = require("./markdown-links.cjs");

exports.run = async () => {
  const extension = vscode.extensions.getExtension(process.env.NGG_EXTENSION_ID);
  assert.ok(extension, "The packaged extension must be installed");
  assert.equal(extension.packageJSON.version, process.env.NGG_EXTENSION_VERSION);
  assert.equal(path.dirname(extension.extensionPath), process.env.NGG_EXTENSIONS_DIR);
  const files = [
    "out/extension.js",
    "out/web.min.js",
    "out/web.min.css",
    "readme.md",
    "LICENSE.txt",
    "THIRD-PARTY-NOTICES.txt",
    "changelog.md",
    "package.nls.json",
    "package.nls.zh-cn.json",
    "package.nls.zh-tw.json",
    "l10n/bundle.l10n.json",
    "l10n/bundle.l10n.zh-cn.json",
    "l10n/bundle.l10n.zh-tw.json",
    "docs/git-actions.md",
    "resources/icon.png",
    ...extension.packageJSON.contributes.walkthroughs.flatMap((walkthrough) =>
      walkthrough.steps.map((step) => step.media.markdown)
    )
  ];
  for (const file of files) {
    assert.ok(
      fs.statSync(path.join(extension.extensionPath, file)).size > 0,
      `Missing packaged asset: ${file}`
    );
  }
  const packaged = fs
    .readdirSync(extension.extensionPath, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(extension.extensionPath, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join("/")
    );
  assert.deepEqual(
    brokenLinks(packaged, (file) =>
      fs.readFileSync(path.join(extension.extensionPath, file), "utf8")
    ),
    [],
    "Packaged Markdown links to files the package does not include"
  );
  for (const excluded of ["node_modules", "src", "tests", "scripts", "docs/testing.md"]) {
    assert.ok(
      !fs.existsSync(path.join(extension.extensionPath, excluded)),
      `Unexpected packaged directory: ${excluded}`
    );
  }
  await extension.activate();
  assert.ok(extension.isActive);
  await vscode.commands.executeCommand("branchwise.view");
  const deadline = Date.now() + 10000;
  const opened = () =>
    vscode.window.tabGroups.all
      .flatMap((group) => group.tabs)
      .some((tab) => tab.label === "Branchwise");
  while (!opened() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50)); // eslint-disable-line no-await-in-loop
  }
  assert.ok(opened(), "The installed VSIX must open its graph");
  await vscode.commands.executeCommand("branchwise.openDocumentation");
  await vscode.commands.executeCommand("branchwise.openWalkthrough");
};
