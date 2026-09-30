const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const oxlint = path.resolve(__dirname, "..", "node_modules", ".bin", "oxlint");

/** Lint `source` with only the webview text rule, and return the reported texts by line. */
function lint(source) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ngg-webview-text-"));
  try {
    fs.writeFileSync(
      path.join(dir, ".oxlintrc.json"),
      JSON.stringify({
        jsPlugins: [path.join(__dirname, "webview-text.cjs")],
        categories: { correctness: "off" },
        rules: { "webview/no-hard-coded-text": "error" }
      })
    );
    fs.writeFileSync(path.join(dir, "view.tsx"), source);
    let output;
    try {
      output = execFileSync(oxlint, ["-c", ".oxlintrc.json", "-f", "json", "view.tsx"], {
        cwd: dir,
        encoding: "utf8",
        shell: process.platform === "win32"
      });
    } catch (error) {
      output = error.stdout;
    }
    return JSON.parse(output).diagnostics.map((diagnostic) => ({
      line: diagnostic.labels[0].span.line,
      text: /"(.*)"/.exec(diagnostic.message)[1]
    }));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("reports words in JSX text, string children, and read attributes", () => {
  const found = lint(
    [
      "export const A = () => (",
      '  <div title="Tooltip" data-kind="internal">',
      "    Loading ...",
      '    {"Retry"}',
      '    <input placeholder={"Filter"} aria-label={`Name`} />',
      "  </div>",
      ");"
    ].join("\n")
  );
  assert.deepEqual(found.map((finding) => finding.text).toSorted(), [
    "Filter",
    "Loading ...",
    "Name",
    "Retry",
    "Tooltip"
  ]);
});

test("allows localized text, data, symbols, and character references", () => {
  const found = lint(
    [
      "export const A = ({ name }: { name: string }) => (",
      // oxlint-disable-next-line no-template-curly-in-string -- TSX source under test
      "  <p title={window.l10n.close} aria-label={`${name}`}>",
      "    {window.l10n.retry} · {name} → ↑2 &lt;{name}&gt; (…) 42",
      "  </p>",
      ");"
    ].join("\n")
  );
  assert.deepEqual(found, []);
});

test("reports scripts other than Latin", () => {
  assert.deepEqual(
    lint("export const A = () => <span>正在加载</span>;").map((finding) => finding.text),
    ["正在加载"]
  );
});
