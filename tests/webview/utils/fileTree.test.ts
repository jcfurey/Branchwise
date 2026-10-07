import { afterEach, beforeAll, describe, expect, it } from "vitest";

import type { GitFileChange } from "@/backend/types";
import type { WebviewConfig } from "@/types";
import { initializeWebviewConfig, updateWebviewConfig } from "@/webview/lib/webview-config";
import { buildFileTree, type FileTreeFolder, type FileTreeNode } from "@/webview/utils/fileTree";

const config: WebviewConfig = {
  autoCenterCommitDetailsView: true,
  branchHoverPreview: true,
  commitHoverCards: true,
  conflictForecast: "localAndRemote",
  dateFormat: "Date & Time",
  dateSeparators: true,
  dragAndDrop: true,
  graphColours: [],
  graphStyle: "rounded",
  initialLoadCommits: 300,
  issueLinks: [],
  loadMoreCommits: 100,
  locale: "en",
  overviewMarkers: true,
  showChangesColumn: false,
  showCurrentBranchByDefault: false,
  showNearestBranch: true,
  singleKeyShortcuts: true
};

beforeAll(() => initializeWebviewConfig(config));

// Each case that changes the display language ends with English again.
afterEach(() => {
  updateWebviewConfig(config);
});

function useLocale(locale: string) {
  updateWebviewConfig({ ...config, locale });
}

/** A change at `path`, modified in place unless `fields` say otherwise. */
function change(path: string, fields: Partial<GitFileChange> = {}): GitFileChange {
  return { oldFilePath: path, newFilePath: path, type: "M", additions: 1, deletions: 0, ...fields };
}

/**
 * The tree as one line per node, two spaces of indent per level: `folder "NAME" (path "PATH")`
 * or `file "NAME" <- "NEW PATH" [TYPE]`, with strings written as JSON.
 */
function outline(nodes: Array<FileTreeNode>, indent = ""): Array<string> {
  return nodes.flatMap((node) =>
    node.type === "folder"
      ? [
          `${indent}folder ${JSON.stringify(node.name)} (path ${JSON.stringify(node.path)})`,
          ...outline(node.children, `${indent}  `)
        ]
      : [
          `${indent}file ${JSON.stringify(node.name)} <- ${JSON.stringify(node.file.newFilePath)} [${node.file.type}]`
        ]
  );
}

function treeOf(...paths: Array<string>) {
  return outline(buildFileTree(paths.map((path) => change(path))));
}

/** The names of the top-level nodes. */
function namesOf(...paths: Array<string>) {
  return buildFileTree(paths.map((path) => change(path))).map((node) => node.name);
}

/** Every folder in the tree, walked without recursion so very deep trees work too. */
function foldersIn(nodes: Array<FileTreeNode>): Array<FileTreeFolder> {
  const found: Array<FileTreeFolder> = [];
  const pending = [...nodes];
  for (let node = pending.pop(); node !== undefined; node = pending.pop()) {
    if (node.type === "folder") {
      found.push(node);
      pending.push(...node.children);
    }
  }
  return found;
}

/** The old path of each node in the first top-level folder, in order. */
function oldPathsInFirst(nodes: Array<FileTreeNode>) {
  const [folder] = nodes;
  return folder?.type === "folder"
    ? folder.children.map((node) => (node.type === "file" ? node.file.oldFilePath : null))
    : [];
}

function countFiles(nodes: Array<FileTreeNode>) {
  const levels = [nodes, ...foldersIn(nodes).map((folder) => folder.children)];
  return levels.reduce((total, level) => total + level.filter((n) => n.type === "file").length, 0);
}

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

describe("tree shape", () => {
  it("returns an empty list for a commit without changes", () => {
    expect(buildFileTree([])).toEqual([]);
  });

  it("puts a top-level file at the top level, holding the change itself", () => {
    const readme = change("README.md");
    const nodes = buildFileTree([readme]);
    expect(nodes).toEqual([{ type: "file", name: "README.md", file: readme }]);
    expect(nodes[0]?.type === "file" && nodes[0].file).toBe(readme);
  });

  it("gives every folder of a path its own node, even one that holds a single folder", () => {
    const deep = change("a/b/c/d.txt");
    const nodes = buildFileTree([deep]);
    expect(nodes).toEqual([
      {
        type: "folder",
        name: "a",
        path: "a",
        children: [
          {
            type: "folder",
            name: "b",
            path: "a/b",
            children: [
              {
                type: "folder",
                name: "c",
                path: "a/b/c",
                children: [
                  {
                    type: "file",
                    name: "d.txt",
                    file: {
                      oldFilePath: "a/b/c/d.txt",
                      newFilePath: "a/b/c/d.txt",
                      type: "M",
                      additions: 1,
                      deletions: 0
                    }
                  }
                ]
              }
            ]
          }
        ]
      }
    ]);
    const innermost = foldersIn(nodes).find((folder) => folder.path === "a/b/c");
    expect(innermost?.children[0]?.type === "file" && innermost.children[0].file).toBe(deep);
  });

  it("shares one folder between the changes beneath it", () => {
    expect(treeOf("src/a.ts", "src/b/c.ts")).toEqual([
      'folder "src" (path "src")',
      '  folder "b" (path "src/b")',
      '    file "c.ts" <- "src/b/c.ts" [M]',
      '  file "a.ts" <- "src/a.ts" [M]'
    ]);
  });

  it("builds a typical commit", () => {
    expect(
      treeOf(
        "src/webview/utils/fileTree.ts",
        "README.md",
        "src/extension.ts",
        "src/webview/main.tsx",
        "docs/a.md"
      )
    ).toEqual([
      'folder "docs" (path "docs")',
      '  file "a.md" <- "docs/a.md" [M]',
      'folder "src" (path "src")',
      '  folder "webview" (path "src/webview")',
      '    folder "utils" (path "src/webview/utils")',
      '      file "fileTree.ts" <- "src/webview/utils/fileTree.ts" [M]',
      '    file "main.tsx" <- "src/webview/main.tsx" [M]',
      '  file "extension.ts" <- "src/extension.ts" [M]',
      'file "README.md" <- "README.md" [M]'
    ]);
  });

  it("names folders by their segments joined with slashes", () => {
    const nodes = buildFileTree([change("src/webview/utils/fileTree.ts")]);
    const folders = foldersIn(nodes);
    expect(folders.map((folder) => folder.path)).toEqual([
      "src",
      "src/webview",
      "src/webview/utils"
    ]);
    for (const folder of folders) {
      for (const node of folder.children) {
        if (node.type === "file") {
          expect(`${folder.path}/${node.name}`).toBe(node.file.newFilePath);
        }
      }
    }
  });

  it("tells folders apart by case", () => {
    expect(treeOf("A/x", "a/y")).toEqual([
      'folder "a" (path "a")',
      '  file "y" <- "a/y" [M]',
      'folder "A" (path "A")',
      '  file "x" <- "A/x" [M]'
    ]);
  });

  it("keeps a file and a folder of the same name apart, in either order", () => {
    const removed = change("a", { type: "D" });
    const added = change("a/b", { type: "A" });
    const expected = ['folder "a" (path "a")', '  file "b" <- "a/b" [A]', 'file "a" <- "a" [D]'];
    expect(outline(buildFileTree([removed, added]))).toEqual(expected);
    expect(outline(buildFileTree([added, removed]))).toEqual(expected);
  });

  it("gives every change exactly one node", () => {
    const paths = ["", "/", "//", "a/", "a//", "/a", "a", "a/b", "./a", "a/./b"];
    const nodes = buildFileTree(paths.map((path) => change(path)));
    expect(outline(nodes)).toEqual([
      'folder "." (path ".")',
      '  file "a" <- "./a" [M]',
      'folder "a" (path "a")',
      '  folder "." (path "a/.")',
      '    file "b" <- "a/./b" [M]',
      '  file "b" <- "a/b" [M]',
      'file "" <- "" [M]',
      'file "" <- "/" [M]',
      'file "" <- "//" [M]',
      'file "a" <- "a/" [M]',
      'file "a" <- "a//" [M]',
      'file "a" <- "/a" [M]',
      'file "a" <- "a" [M]'
    ]);
    expect(countFiles(nodes)).toBe(paths.length);
  });
});

describe("change types", () => {
  it("places a rename at its new path only", () => {
    const moved = change("b/x.ts", { oldFilePath: "a/x.ts", type: "R" });
    const nodes = buildFileTree([moved]);
    expect(outline(nodes)).toEqual(['folder "b" (path "b")', '  file "x.ts" <- "b/x.ts" [R]']);
    const [folder] = foldersIn(nodes);
    expect(folder?.children[0]?.type === "file" && folder.children[0].file.oldFilePath).toBe(
      "a/x.ts"
    );
  });

  it("places a deletion at the path it was deleted from", () => {
    expect(outline(buildFileTree([change("gone/file.txt", { type: "D" })]))).toEqual([
      'folder "gone" (path "gone")',
      '  file "file.txt" <- "gone/file.txt" [D]'
    ]);
  });

  it("keeps every change of a repeated path, in input order", () => {
    const changes = ["1", "2", "3"].map((oldFilePath) => change("d/x", { oldFilePath }));
    expect(oldPathsInFirst(buildFileTree(changes))).toEqual(["1", "2", "3"]);
    expect(oldPathsInFirst(buildFileTree(changes.toReversed()))).toEqual(["3", "2", "1"]);
  });
});

describe("ordering", () => {
  const mixed = ["b.txt", "a/x", "A.txt", "a.txt", "B/y", "_z/q"];

  it("puts folders before files at every level, each ordered by name", () => {
    expect(treeOf(...mixed)).toEqual([
      'folder "_z" (path "_z")',
      '  file "q" <- "_z/q" [M]',
      'folder "a" (path "a")',
      '  file "x" <- "a/x" [M]',
      'folder "B" (path "B")',
      '  file "y" <- "B/y" [M]',
      'file "a.txt" <- "a.txt" [M]',
      'file "A.txt" <- "A.txt" [M]',
      'file "b.txt" <- "b.txt" [M]'
    ]);
  });

  it("orders the same whatever order the changes come in", () => {
    const changes = mixed.map((path) => change(path));
    expect(buildFileTree(changes.toReversed())).toEqual(buildFileTree(changes));
  });

  it("orders by letter before case, lower case first, in English", () => {
    expect(namesOf("B", "b", "A", "a")).toEqual(["a", "A", "b", "B"]);
  });

  it("orders digits as numbers", () => {
    expect(namesOf("f10.txt", "f2.txt", "f1.txt")).toEqual(["f1.txt", "f2.txt", "f10.txt"]);
    expect(namesOf("v10/x", "v9/x", "v1/x")).toEqual(["v1", "v9", "v10"]);
  });

  it("keeps names the collator counts as equal in input order", () => {
    // Read as numbers, 02 and 2 are the same.
    expect(namesOf("file2.txt", "file02.txt")).toEqual(["file2.txt", "file02.txt"]);
    expect(namesOf("file02.txt", "file2.txt")).toEqual(["file02.txt", "file2.txt"]);
  });

  it("keeps composed and decomposed accents as two folders, in input order", () => {
    const composed = "é";
    const decomposed = "é";
    expect(treeOf(`${composed}/1`, `${decomposed}/2`)).toEqual([
      `folder "${composed}" (path "${composed}")`,
      '  file "1" <- "é/1" [M]',
      `folder "${decomposed}" (path "${decomposed}")`,
      '  file "2" <- "é/2" [M]'
    ]);
    expect(namesOf(`${decomposed}/2`, `${composed}/1`)).toEqual([decomposed, composed]);
  });
});

describe("display language", () => {
  const nordic = ["ö.txt", "z.txt", "o.txt", "å.txt", "a.txt"];

  it("orders names the way the display language does", () => {
    expect(namesOf(...nordic)).toEqual(["a.txt", "å.txt", "o.txt", "ö.txt", "z.txt"]);
    useLocale("sv");
    expect(namesOf(...nordic)).toEqual(["a.txt", "o.txt", "z.txt", "å.txt", "ö.txt"]);
    useLocale("de");
    expect(namesOf(...nordic)).toEqual(["a.txt", "å.txt", "o.txt", "ö.txt", "z.txt"]);
  });

  it("orders digits as numbers in any display language", () => {
    useLocale("sv");
    expect(namesOf("f10", "f9")).toEqual(["f9", "f10"]);
  });

  it.each(["en_US", "", "not a locale!!", "i-klingon", "en-"])(
    "orders names for %j in the runtime's default language, digits as numbers",
    (locale) => {
      const names = [...nordic, "f10", "f9", "B", "b"];
      useLocale(new Intl.Collator().resolvedOptions().locale);
      const expected = namesOf(...names);
      useLocale(locale);
      expect(namesOf(...names)).toEqual(expected);
      expect(namesOf("f10", "f9")).toEqual(["f9", "f10"]);
    }
  );

  describe("collator reuse", () => {
    const original = Intl.Collator;
    let built = 0;

    // `vi.spyOn` on Intl constructors breaks `new` under Vitest 4, so a proxy counts them.
    function countCollators() {
      built = 0;
      const counted = new Proxy(original, {
        construct(target, args, newTarget) {
          built += 1;
          return Reflect.construct(target, args, newTarget);
        }
      });
      Object.defineProperty(Intl, "Collator", {
        value: counted,
        configurable: true,
        writable: true
      });
    }

    afterEach(() => {
      Object.defineProperty(Intl, "Collator", {
        value: original,
        configurable: true,
        writable: true
      });
    });

    // Each case uses a tag no other case uses, since the collators outlive a case.
    it("builds the collator of a display language once", () => {
      countCollators();
      useLocale("fr-CA");
      namesOf("b", "a");
      expect(built).toBe(1);
      for (let call = 0; call < 100; call += 1) {
        namesOf("b", "a");
      }
      expect(built).toBe(1);
    });

    it("does not try a display language Intl rejects again", () => {
      countCollators();
      useLocale("fr_CA");
      namesOf("b", "a");
      const first = built;
      for (let call = 0; call < 100; call += 1) {
        namesOf("b", "a");
      }
      expect(built).toBe(first);
    });
  });
});

describe("empty segments", () => {
  it("skips leading slashes", () => {
    expect(treeOf("/a/b.txt", "a/c.txt")).toEqual([
      'folder "a" (path "a")',
      '  file "b.txt" <- "/a/b.txt" [M]',
      '  file "c.txt" <- "a/c.txt" [M]'
    ]);
    expect(treeOf("/a", "//b/c", "b/d")).toEqual([
      'folder "b" (path "b")',
      '  file "c" <- "//b/c" [M]',
      '  file "d" <- "b/d" [M]',
      'file "a" <- "/a" [M]'
    ]);
  });

  it("skips repeated slashes instead of making folders named with nothing", () => {
    expect(treeOf("a//b", "a/c", "a///d")).toEqual([
      'folder "a" (path "a")',
      '  file "b" <- "a//b" [M]',
      '  file "c" <- "a/c" [M]',
      '  file "d" <- "a///d" [M]'
    ]);
  });

  it("names a file by its last segment when the path ends in a slash", () => {
    expect(treeOf("a/")).toEqual(['file "a" <- "a/" [M]']);
    expect(treeOf("a/b/", "a/c")).toEqual([
      'folder "a" (path "a")',
      '  file "b" <- "a/b/" [M]',
      '  file "c" <- "a/c" [M]'
    ]);
  });

  it("puts a path with no segment at the top level as a file named with nothing", () => {
    expect(treeOf("", "/", "///")).toEqual([
      'file "" <- "" [M]',
      'file "" <- "/" [M]',
      'file "" <- "///" [M]'
    ]);
  });

  it("joins only the segments it uses into a folder's path", () => {
    expect(treeOf("//x//y///z.txt", "x/y/w.txt")).toEqual([
      'folder "x" (path "x")',
      '  folder "y" (path "x/y")',
      '    file "w.txt" <- "x/y/w.txt" [M]',
      '    file "z.txt" <- "//x//y///z.txt" [M]'
    ]);
  });
});

describe("unusual names", () => {
  it("treats dots and backslashes as ordinary characters", () => {
    expect(treeOf("x/../z", "a\\b.txt")).toEqual([
      'folder "x" (path "x")',
      '  folder ".." (path "x/..")',
      '    file "z" <- "x/../z" [M]',
      'file "a\\\\b.txt" <- "a\\\\b.txt" [M]'
    ]);
  });

  it("keeps whitespace and text in other scripts as it is", () => {
    expect(treeOf(" a/ b ", "line\nbreak/f", "目录/新.txt")).toEqual([
      'folder " a" (path " a")',
      '  file " b " <- " a/ b " [M]',
      'folder "line\\nbreak" (path "line\\nbreak")',
      '  file "f" <- "line\\nbreak/f" [M]',
      'folder "目录" (path "目录")',
      '  file "新.txt" <- "目录/新.txt" [M]'
    ]);
  });
});

describe("purity", () => {
  const input = () => ["z.txt", "a/b.txt", "a/a.txt", "m/n/o.txt"].map((path) => change(path));

  it("leaves a frozen input as it was", () => {
    const frozen = deepFreeze(input());
    const before = structuredClone(frozen);
    expect(() => buildFileTree(frozen)).not.toThrow();
    expect(frozen).toEqual(before);
  });

  it("builds new nodes on every call", () => {
    const changes = input();
    const first = buildFileTree(changes);
    const second = buildFileTree(changes);
    expect(second).toEqual(first);
    expect(second).not.toBe(first);

    // Both trees are equal, so their folders and nodes line up one for one.
    const everyNode = (nodes: Array<FileTreeNode>) => [
      ...nodes,
      ...foldersIn(nodes).flatMap((folder) => folder.children)
    ];
    const secondNodes = everyNode(second);
    everyNode(first).forEach((node, index) => expect(secondNodes[index]).not.toBe(node));
    const secondFolders = foldersIn(second);
    foldersIn(first).forEach((folder, index) =>
      expect(secondFolders[index]?.children).not.toBe(folder.children)
    );
  });
});

describe("size", () => {
  it("builds ten thousand changes in folders up to six deep quickly, each level ordered", () => {
    const changes = Array.from({ length: 10_000 }, (_, index) => {
      const folders = Array.from(
        { length: index % 6 },
        (_folder, depth) => `dir${(index >> depth) % 8}`
      );
      return change([...folders, `file${index}.ts`].join("/"));
    });

    const started = performance.now();
    const nodes = buildFileTree(changes);
    expect(performance.now() - started).toBeLessThan(1000);

    expect(countFiles(nodes)).toBe(10_000);
    const { compare } = new Intl.Collator("en", { numeric: true });
    for (const level of [nodes, ...foldersIn(nodes).map((folder) => folder.children)]) {
      expect(level.length).toBeGreaterThan(0);
      const folderCount = level.filter((node) => node.type === "folder").length;
      expect(level.slice(0, folderCount).every((node) => node.type === "folder")).toBe(true);
      for (const group of [level.slice(0, folderCount), level.slice(folderCount)]) {
        for (let index = 1; index < group.length; index += 1) {
          expect(compare(group[index - 1]!.name, group[index]!.name)).toBeLessThanOrEqual(0);
        }
      }
    }
  });

  it("builds a path 2,048 folders deep", () => {
    const folders = Array.from({ length: 2048 }, (_, depth) => `d${depth}`).join("/");
    const leaf = change(`${folders}/leaf.txt`);

    let level = buildFileTree([leaf]);
    let innermost: FileTreeFolder | undefined;
    let depth = 0;
    for (let node = level[0]; node?.type === "folder"; node = level[0]) {
      expect(level).toHaveLength(1);
      innermost = node;
      level = node.children;
      depth += 1;
    }

    expect(depth).toBe(2048);
    expect(innermost?.path).toBe(folders);
    expect(level).toEqual([{ type: "file", name: "leaf.txt", file: leaf }]);
  });
});
