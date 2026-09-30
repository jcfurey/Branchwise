import { describe, expect, it } from "vitest";

import { deleteTag } from "@/backend/actions/tag";
import { createGit } from "@/backend/gitClient";

import { freshRepo, git, refNames } from "@tests/backend/helpers";

// Two lightweight tags on the only commit.
const repo = freshRepo((dir) => {
  git(["tag", "v1.0"], dir);
  git(["tag", "v1.1"], dir);
});

const remove = (tagName: string) => deleteTag(createGit(repo(), "git"), { tagName });
const tags = () => refNames("refs/tags/", repo());

describe("deleteTag", () => {
  it("deletes the named tag and no other", async () => {
    await expect(remove("v1.0")).resolves.toBeUndefined();

    expect(tags()).toEqual(["v1.1"]);
  });

  it("rejects a tag that does not exist and keeps the others", async () => {
    await expect(remove("nonexistent")).rejects.toThrow();

    expect(tags()).toEqual(["v1.0", "v1.1"]);
  });
});
