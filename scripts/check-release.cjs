const { readFileSync } = require("node:fs");
const path = require("node:path");

/** Prevent packaging under another identity or publishing a tag for a different version. */
function checkRelease(manifest, tag) {
  if (manifest.publisher !== "jcfurey" || manifest.name !== "branchwise") {
    throw new Error("Expected extension identity jcfurey.branchwise");
  }
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(manifest.version)) {
    throw new Error("Expected a stable major.minor.patch extension version");
  }
  if (tag !== undefined && tag !== `v${manifest.version}`) {
    throw new Error(`Release tag ${tag} must match v${manifest.version}`);
  }
  return `${manifest.publisher}.${manifest.name}@${manifest.version}`;
}

/**
 * The version is written by hand into the changelog and the packaging guide, so check that each
 * names the manifest's version: a dated changelog heading, and the VSIX file name.
 */
function checkDocuments(version, documents) {
  const escaped = version.replaceAll(".", "\\.");
  if (!new RegExp(`^## \\[${escaped}\\] - \\d{4}-\\d{2}-\\d{2}$`, "m").test(documents.changelog)) {
    throw new Error(`CHANGELOG.md needs a dated "## [${version}] - YYYY-MM-DD" heading`);
  }
  for (const [name, text] of Object.entries(documents.guides)) {
    const named = [...text.matchAll(/branchwise-(\d+\.\d+\.\d+)\.vsix/g)].map((m) => m[1]);
    if (named.length === 0 || named.some((other) => other !== version)) {
      throw new Error(`${name} must install branchwise-${version}.vsix`);
    }
  }
}

module.exports = { checkRelease, checkDocuments };

if (require.main === module) {
  try {
    const root = path.join(__dirname, "..");
    const manifest = JSON.parse(
      readFileSync(process.argv[3] || path.join(root, "package.json"), "utf8")
    );
    const identity = checkRelease(manifest, process.argv[2]);
    // A packaged manifest is checked on its own; the repository's documents go with its manifest.
    if (process.argv[3] === undefined) {
      const read = (file) => readFileSync(path.join(root, file), "utf8");
      checkDocuments(manifest.version, {
        changelog: read("CHANGELOG.md"),
        guides: { "docs/packaging.md": read("docs/packaging.md") }
      });
    }
    process.stdout.write(identity + "\n");
  } catch (error) {
    process.stderr.write(error.message + "\n");
    process.exitCode = 1;
  }
}
