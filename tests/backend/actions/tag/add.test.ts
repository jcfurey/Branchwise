import { describe, expect, it } from "vitest";

import { addTag } from "@/backend/actions/tag";
import { createGit } from "@/backend/gitClient";

import { freshRepo, git, gitOutput, refNames } from "@tests/backend/helpers";

const repo = freshRepo();

const read = (args: string[]) => gitOutput(args, repo());
const objectType = (rev: string) => read(["cat-file", "-t", rev]);
const commitOf = (rev: string) => read(["rev-parse", `${rev}^{commit}`]);
const addEmptyCommit = () => git(["commit", "--allow-empty", "-q", "-m", "later"], repo());

function tag(tagName: string, commitHash: string, message = "") {
  return addTag(createGit(repo(), "git"), {
    tagName,
    commitHash,
    lightweight: message === "",
    message
  });
}

describe("addTag", () => {
  it("makes a lightweight tag a plain ref to the commit", async () => {
    const tip = read(["rev-parse", "HEAD"]);

    await expect(tag("v1.0-lw", tip)).resolves.toBeUndefined();

    expect(objectType("refs/tags/v1.0-lw")).toBe("commit");
    expect(read(["rev-parse", "refs/tags/v1.0-lw"])).toBe(tip);
  });

  it("makes an annotated tag a tag object carrying the message", async () => {
    const tip = read(["rev-parse", "HEAD"]);

    await expect(tag("v1.0", tip, "Release v1.0")).resolves.toBeUndefined();

    expect(objectType("refs/tags/v1.0")).toBe("tag");
    expect(commitOf("refs/tags/v1.0")).toBe(tip);
    expect(read(["for-each-ref", "--format=%(contents:subject)", "refs/tags/v1.0"])).toBe(
      "Release v1.0"
    );
  });

  it.each([
    ["a lightweight", ""],
    ["an annotated", "An older release"]
  ])("puts %s tag on the given commit, not on HEAD", async (_, message) => {
    const older = read(["rev-parse", "HEAD"]);
    addEmptyCommit();

    await expect(tag("older", older, message)).resolves.toBeUndefined();

    expect(commitOf("refs/tags/older")).toBe(older);
    expect(read(["rev-parse", "HEAD"])).not.toBe(older);
  });

  it("does not replace a tag that already exists", async () => {
    addEmptyCommit();
    git(["tag", "existing", "HEAD^"], repo());
    const taggedBefore = read(["rev-parse", "refs/tags/existing"]);

    await expect(tag("existing", read(["rev-parse", "HEAD"]))).rejects.toThrow();

    expect(read(["rev-parse", "refs/tags/existing"])).toBe(taggedBefore);
  });

  it("rejects a commit that does not exist and creates no tag", async () => {
    await expect(tag("v2.0", "deadbeef".repeat(5))).rejects.toThrow();

    expect(refNames("refs/tags/", repo())).toEqual([]);
  });
});
