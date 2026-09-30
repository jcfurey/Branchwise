const assert = require("node:assert/strict");
const { test } = require("node:test");

const { brokenLinks, relativeTargets } = require("./markdown-links.cjs");

test("finds relative targets and ignores URLs, anchors, and absolute paths", () => {
  assert.deepEqual(
    relativeTargets(
      "[a](guide.md) [b](../x/y.md#part) [c](https://example.com) [d](#top) [e](mailto:x@y) " +
        '[f](/root.md) [g](<with space.md>) [h](img.png "title") [i](command:branchwise.view)'
    ),
    ["guide.md", "../x/y.md", "with space.md", "img.png"]
  );
});

test("reports links from packaged Markdown to files outside the package", () => {
  const text = {
    "docs/guide.md": "[perf](performance.md) [self](guide.md) [up](../walkthroughs/a.md)",
    "walkthroughs/a.md": "[guide](../docs/guide.md) [missing](b.md)",
    "README.md": "[not packaged](docs/performance.md)"
  };
  assert.deepEqual(
    brokenLinks(Object.keys(text), (file) => text[file]),
    [
      { file: "docs/guide.md", target: "docs/performance.md" },
      { file: "walkthroughs/a.md", target: "walkthroughs/b.md" }
    ]
  );
});
