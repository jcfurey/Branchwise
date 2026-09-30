import { h } from "preact";
import { describe, expect, it } from "vitest";

import { format } from "@/webview/utils/format";

describe("format", () => {
  it("returns a template without placeholders as its only piece", () => {
    expect(format("Fetch from remote")).toEqual(["Fetch from remote"]);
  });

  it("adds no empty text after a placeholder that ends the template", () => {
    expect(format("Delete branch {0}", "hotfix/login")).toEqual(["Delete branch ", "hotfix/login"]);
  });

  it("puts an element part itself between the text around its placeholder", () => {
    const tag = h("code", null, "v2.4.0");

    const pieces = format("Push {0} now?", tag);

    expect(pieces).toEqual(["Push ", tag, " now?"]);
    expect(pieces[1]).toBe(tag);
  });

  it("alternates text and parts for placeholders in ascending order", () => {
    expect(format("Rebase {0} onto {1}.", "feature", "develop")).toEqual([
      "Rebase ",
      "feature",
      " onto ",
      "develop",
      "."
    ]);
  });

  it("follows the template's order, giving each placeholder the part it numbers", () => {
    expect(format("{1} before {0}", "alpha", "omega")).toEqual(["omega", " before ", "alpha"]);
  });

  it("leaves an undefined piece for a placeholder that has no part", () => {
    const pieces = format("Compare {0} with {1}", "HEAD~2");

    expect(pieces).toEqual(["Compare ", "HEAD~2", " with ", undefined]);
    expect(pieces).toHaveLength(4);
  });

  it("does not look for placeholders inside a part", () => {
    expect(format("{0}: {1}", "{1}", "tail")).toEqual(["{1}", ": ", "tail"]);
  });
});
