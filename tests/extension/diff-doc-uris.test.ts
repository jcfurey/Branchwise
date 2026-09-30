import { sep } from "node:path";

import { describe, expect, test, vi } from "vitest";

import {
  decodeDiffDocUri,
  encodeDiffBlobUri,
  encodeDiffDocUri
} from "@/old-extension/diffDocProvider";

// Only the parts of vscode.Uri that building a URI touches. Its string form does not matter here.
vi.mock("vscode", () => {
  type Parts = { scheme: string; path: string; query: string };
  const make = (parts: Parts) => ({
    ...parts,
    with: (change: Partial<Parts>) => make({ ...parts, ...change }),
    toString: () => JSON.stringify(parts)
  });
  return { Uri: { from: make } };
});

const commitA = "a".repeat(40);
const commitB = "b".repeat(40);
const zeros = "0".repeat(40);

/** A stand-in for a URI VS Code revived, which carries only a path and a query. */
function revived(query: string, path = "/p") {
  return { path, query } as unknown as import("vscode").Uri;
}

describe("building document URIs", () => {
  test("keeps the file path and puts the revision and repository in the query", () => {
    const uri = encodeDiffDocUri("/tmp/r", "d/f.txt", commitA + "^");
    expect(uri.scheme).toBe("branchwise");
    expect(uri.path).toBe("d/f.txt");
    expect(uri.query).toBe(`commit=${commitA}%5E&repo=%2Ftmp%2Fr`);
  });

  test("escapes reserved characters in the repository but leaves the path to the URI", () => {
    const uri = encodeDiffDocUri(
      "/tmp/repo #?% with spaces 中文",
      "folder/odd #?\tname.txt",
      commitB
    );
    expect(uri.path).toBe("folder/odd #?\tname.txt");
    expect(uri.query).toBe(
      `commit=${commitB}&repo=%2Ftmp%2Frepo%20%23%3F%25%20with%20spaces%20%E4%B8%AD%E6%96%87`
    );
  });

  test("leaves symbolic names for the provider to refuse", () => {
    expect(encodeDiffDocUri("/tmp/r/../repo/", "top.txt", "HEAD").query).toBe(
      "commit=HEAD&repo=%2Ftmp%2Fr%2F..%2Frepo%2F"
    );
  });

  test("adds no leading slash, and rewrites backslashes only where they separate folders", () => {
    expect(encodeDiffDocUri("/tmp/r", "dir/file.txt", commitA).path).toBe("dir/file.txt");
    expect(encodeDiffDocUri("/tmp/r", "d\\f.txt", commitA).path).toBe(
      sep === "\\" ? "d/f.txt" : "d\\f.txt"
    );
  });
});

describe("building object URIs", () => {
  test("marks the query as naming an object", () => {
    const uri = encodeDiffBlobUri("/tmp/r", "x/y.ts", "c".repeat(40));
    expect(uri.scheme).toBe("branchwise");
    expect(uri.path).toBe("x/y.ts");
    expect(uri.query).toBe(`commit=${"c".repeat(40)}&repo=%2Ftmp%2Fr&blob=1`);
  });

  test("names the empty object when there is no content", () => {
    expect(encodeDiffBlobUri("/tmp/r", "d/f.txt", null).query).toBe(
      `commit=${zeros}&repo=%2Ftmp%2Fr&blob=1`
    );
  });
});

describe("reading URIs back", () => {
  test("returns exactly what a document URI was built from", () => {
    const repo = "C:/odd repo/100% #1?";
    const file = 'sp ace/"quoted"\nline %41.txt';
    const decoded = decodeDiffDocUri(encodeDiffDocUri(repo, file, commitB + "^"));
    expect(decoded).toStrictEqual({ filePath: file, commit: commitB + "^", repo });
    expect(Object.keys(decoded)).toEqual(["filePath", "commit", "repo"]);
  });

  test("reports the object marker only for object URIs", () => {
    expect(decodeDiffDocUri(encodeDiffBlobUri("/r", "a.txt", null))).toStrictEqual({
      filePath: "a.txt",
      commit: zeros,
      repo: "/r",
      blob: true
    });
  });

  test.each<[string, Record<string, unknown>]>([
    ["", {}],
    ["commit", {}],
    ["commit=", { commit: "" }],
    ["commit=a&commit=b", { commit: "b" }],
    ["commit=a&commit=%E0%A4%A", { commit: "a" }],
    ["commit=%E0%A4%A&commit=a", { commit: "a" }],
    ["blob=1", { blob: true }],
    ["blob=%31", { blob: true }],
    ["blob=true", {}],
    ["blob=0", {}],
    ["blob=1&blob=0", {}],
    ["blob=0&blob=1", { blob: true }],
    ["com%6Dit=abc", {}],
    ["COMMIT=a", {}],
    ["commit=a+b%20c", { commit: "a+b c" }],
    ["commit=a=b", { commit: "a=b" }],
    ["repo=%2Fx&repo=%2Fy", { repo: "/y" }],
    ["&&commit=z&", { commit: "z" }],
    ["=orphan&commit=z", { commit: "z" }],
    ["__proto__=x&commit=y", { commit: "y" }],
    ["toString=x&constructor=y", {}],
    ["commit=%00", { commit: "\u0000" }]
  ])("reads the query %j", (query, expected) => {
    const decoded = decodeDiffDocUri(revived(query));
    expect(decoded).toStrictEqual({
      filePath: "/p",
      commit: undefined,
      repo: undefined,
      ...expected
    });
    // Missing arguments are still own keys, in a fixed order; the marker is absent, never false.
    expect(Object.keys(decoded)).toEqual(
      ["filePath", "commit", "repo", "blob"].slice(0, "blob" in expected ? 4 : 3)
    );
  });

  test("leaves object prototypes alone", () => {
    decodeDiffDocUri(revived("__proto__=%7B%22polluted%22%3A1%7D&constructor=x&prototype=y"));
    expect(Object.getPrototypeOf(decodeDiffDocUri(revived("")))).toBe(Object.prototype);
    expect(({} as Record<string, unknown>)["polluted"]).toBeUndefined();
  });

  test.each(["%", "=%", "commit=%ZZ&repo=%", "&=&==&", "blob=%E0%A4%A", "a".repeat(10_000)])(
    "never throws for the query %j",
    (query) => {
      expect(() => decodeDiffDocUri(revived(query))).not.toThrow();
    }
  );
});
