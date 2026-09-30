const assert = require("node:assert/strict");
const { test } = require("node:test");

const { checkDocuments, checkRelease } = require("./check-release.cjs");

const manifest = { publisher: "jcfurey", name: "branchwise", version: "0.9.5" };

test("accepts local builds and the exact release tag", () => {
  assert.equal(checkRelease(manifest), "jcfurey.branchwise@0.9.5");
  assert.equal(checkRelease(manifest, "v0.9.5"), "jcfurey.branchwise@0.9.5");
});

test("rejects the upstream publisher, the name before the rename, and a renamed extension", () => {
  assert.throws(() => checkRelease({ ...manifest, publisher: "asispts" }), /identity/);
  assert.throws(() => checkRelease({ ...manifest, name: "neo-git-graph" }), /identity/);
  assert.throws(() => checkRelease({ ...manifest, name: "another-graph" }), /identity/);
});

test("rejects missing, malformed, and prerelease versions", () => {
  for (const version of [undefined, "", "01.2.3", "1.2", "v1.2.3", "1.2.3-beta", "1.2.3+build"]) {
    assert.throws(() => checkRelease({ ...manifest, version }), /version/);
  }
});

test("rejects mismatched, unprefixed, or empty release tags", () => {
  for (const tag of ["v0.9.4", "0.9.5", "", "v0.9.5-extra"]) {
    assert.throws(() => checkRelease(manifest, tag), /must match/);
  }
});

const documents = {
  changelog: "# Changelog\n\n## [Unreleased]\n\n## [0.9.5] - 2026-09-20\n\n- Fix\n",
  guides: { "README.md": "code --install-extension ./branchwise-0.9.5.vsix --force" }
};

test("accepts documents that name the manifest version", () => {
  assert.doesNotThrow(() => checkDocuments("0.9.5", documents));
});

test("requires a dated changelog heading for the version", () => {
  for (const changelog of [
    "## [Unreleased]\n",
    "## [0.9.5]\n",
    "## [0.9.50] - 2026-09-20\n",
    "## [0x9x5] - 2026-09-20\n",
    "## [0.9.4] - 2026-09-20\n"
  ]) {
    assert.throws(() => checkDocuments("0.9.5", { ...documents, changelog }), /CHANGELOG/);
  }
});

test("requires install instructions for the same version", () => {
  for (const text of [
    "no file name",
    "./branchwise-0.9.4.vsix",
    "0.9.5.vsix and branchwise-0.9.4.vsix"
  ]) {
    assert.throws(
      () => checkDocuments("0.9.5", { ...documents, guides: { "README.md": text } }),
      /README\.md must install branchwise-0\.9\.5\.vsix/
    );
  }
});
