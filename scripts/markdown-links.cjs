const { execFileSync } = require("node:child_process");
const path = require("node:path");

/**
 * vsce rewrites relative links in the README and changelog to the repository, so only other
 * packaged Markdown, such as the guide that Learn more opens, needs its targets packaged too.
 */
const REWRITTEN = new Set(["readme.md", "changelog.md"]);

/** Relative link targets in Markdown text, without anchors or queries. */
function relativeTargets(text) {
  return [...text.matchAll(/\]\(\s*(?:<([^>]*)>|([^)\s]+))(?:\s+"[^"]*")?\s*\)/g)]
    .map((match) => match[1] ?? match[2] ?? "")
    .filter((target) => !/^(?:[a-z][a-z0-9+.-]*:|#|\/)/i.test(target))
    .map((target) => decodeURI(target.replace(/[#?].*$/, "")))
    .filter(Boolean);
}

/**
 * Links in packaged Markdown whose targets are not packaged. `files` lists packaged paths with
 * forward slashes; `read` returns a packaged file's text.
 */
function brokenLinks(files, read) {
  const packaged = new Set(files);
  return files
    .filter((file) => file.endsWith(".md") && !REWRITTEN.has(file.toLowerCase()))
    .flatMap((file) =>
      relativeTargets(read(file))
        .map((target) => path.posix.normalize(path.posix.join(path.posix.dirname(file), target)))
        .filter((target) => !packaged.has(target))
        .map((target) => ({ file, target }))
    );
}

module.exports = { brokenLinks, relativeTargets };

if (require.main === module) {
  const root = path.join(__dirname, "..");
  const vsce = require.resolve("@vscode/vsce/vsce");
  const files = execFileSync(process.execPath, [vsce, "ls", "--no-dependencies"], {
    cwd: root,
    encoding: "utf8"
  })
    .split(/\r?\n/)
    .filter(Boolean);
  const broken = brokenLinks(files, (file) =>
    require("node:fs").readFileSync(path.join(root, file), "utf8")
  );
  for (const { file, target } of broken) {
    process.stderr.write(`${file} links to ${target}, which the package does not include\n`);
  }
  process.exitCode = broken.length === 0 ? 0 : 1;
}
