const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");

const { notices, packageFolder, repositoryUrl } = require("./third-party-notices.cjs");

test("finds the package folder of a bundled file, scoped or not", () => {
  assert.equal(
    packageFolder("node_modules/.pnpm/preact@10.0.0/node_modules/preact/dist/preact.module.js"),
    "node_modules/.pnpm/preact@10.0.0/node_modules/preact"
  );
  assert.equal(
    packageFolder(
      "node_modules/.pnpm/@preact+signals@2.0.0/node_modules/@preact/signals/dist/a.js"
    ),
    "node_modules/.pnpm/@preact+signals@2.0.0/node_modules/@preact/signals"
  );
  assert.equal(packageFolder("src/webview/main.tsx"), null);
});

test("writes each repository as a web address", () => {
  const url = (repository) => repositoryUrl({ repository });
  assert.equal(url("git+https://github.com/a/b.git"), "https://github.com/a/b");
  assert.equal(url({ type: "git", url: "git://github.com/a/b.git" }), "https://github.com/a/b");
  assert.equal(url("git@github.com:a/b"), "https://github.com/a/b");
  assert.equal(url("github:a/b"), "https://github.com/a/b");
  assert.equal(url("a/b"), "https://github.com/a/b");
  assert.equal(repositoryUrl({ homepage: "https://example.test" }), "https://example.test");
});

test("lists every bundled package with its license text, and the committed file matches", async () => {
  const text = await notices();
  for (const name of ["simple-git", "preact", "@preact/signals", "@vscode/l10n", "tailwindcss"]) {
    assert.match(text, new RegExp(`^${name.replace("/", "\\/")}\\nLicense: MIT\\n`, "m"));
  }
  assert.match(text, /Copyright \(c\) Microsoft Corporation\./);
  assert.ok(text.endsWith("\n"));
  const committed = fs
    .readFileSync(path.join(__dirname, "..", "THIRD-PARTY-NOTICES.txt"), "utf8")
    .replaceAll("\r\n", "\n");
  assert.equal(committed, text, "Run `pnpm run notices` and commit THIRD-PARTY-NOTICES.txt");
});
