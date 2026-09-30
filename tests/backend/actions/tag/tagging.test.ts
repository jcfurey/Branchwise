import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { addTag, pushTag } from "@/backend/actions/tag";
import { createGit } from "@/backend/gitClient";

import { recordingGit } from "@tests/backend/queries/loadCommits/fixtures";
import {
  allRefs,
  isRunning,
  onWindows,
  run,
  sandbox,
  stalledOrigin,
  withoutPromptSetting
} from "@tests/backend/sandbox";

const box = sandbox();

/** A repository with a bare remote `origin` that already has `main`. */
function withOrigin() {
  const repo = box.repo();
  const origin = box.bare();
  run(repo, "remote", "add", "origin", origin);
  run(repo, "push", "-q", "origin", "main");
  return { repo, origin, head: run(repo, "rev-parse", "HEAD") };
}

const tagsOf = (repo: string) =>
  run(repo, "for-each-ref", "--format=%(refname:strip=2)", "refs/tags/");

describe("adding tags", () => {
  it("refuses a tag named HEAD", async () => {
    const repo = box.repo();
    const before = allRefs(repo);
    await expect(
      addTag(createGit(repo, "git"), {
        tagName: "HEAD",
        commitHash: run(repo, "rev-parse", "HEAD"),
        lightweight: true,
        message: ""
      })
    ).rejects.toThrow(/Enter a valid tag name/);
    expect(allRefs(repo)).toBe(before);
  });

  it.skipIf(onWindows)("refuses HEAD without starting Git", async () => {
    const repo = box.repo();
    const recorder = recordingGit(box.folder("bin"));
    await expect(
      addTag(createGit(repo, recorder.gitPath), {
        tagName: "HEAD",
        commitHash: run(repo, "rev-parse", "HEAD"),
        lightweight: false,
        message: "annotated"
      })
    ).rejects.toThrow();
    expect(recorder.runs()).toEqual([]);
  });

  it("accepts names that merely contain HEAD", async () => {
    const repo = box.repo();
    const head = run(repo, "rev-parse", "HEAD");
    for (const tagName of ["HEAD-1", "release/HEAD"]) {
      // eslint-disable-next-line no-await-in-loop
      await addTag(createGit(repo, "git"), {
        tagName,
        commitHash: head,
        lightweight: true,
        message: ""
      });
    }
    expect(tagsOf(repo).split("\n").toSorted()).toEqual(["HEAD-1", "release/HEAD"]);
  });

  it("ignores the message of a lightweight tag", async () => {
    const repo = box.repo();
    await expect(
      addTag(createGit(repo, "git"), {
        tagName: "lw",
        commitHash: run(repo, "rev-parse", "HEAD"),
        lightweight: true,
        message: "ignored"
      })
    ).resolves.toBeUndefined();
    expect(run(repo, "cat-file", "-t", "refs/tags/lw")).toBe("commit");
  });

  it("creates an annotated tag with an empty message", async () => {
    const repo = box.repo();
    await addTag(createGit(repo, "git"), {
      tagName: "a0",
      commitHash: run(repo, "rev-parse", "HEAD"),
      lightweight: false,
      message: ""
    });
    expect(run(repo, "cat-file", "-t", "refs/tags/a0")).toBe("tag");
    expect(run(repo, "for-each-ref", "--format=%(contents)", "refs/tags/a0")).toBe("");
  });
});

describe("pushing tags", () => {
  it("names an unknown remote before an invalid tag", async () => {
    const { repo } = withOrigin();
    run(repo, "tag", "v1");
    await expect(
      pushTag(createGit(repo, "git"), { tagName: "bad name", remote: "nope" })
    ).rejects.toThrow("Remote 'nope' is not configured for this repository.");
  });

  it("does not replace a remote tag that points elsewhere", async () => {
    const { repo, origin, head } = withOrigin();
    run(repo, "tag", "v1");
    await pushTag(createGit(repo, "git"), { tagName: "v1", remote: "origin" });
    run(repo, "commit", "-q", "--allow-empty", "-m", "later");
    run(repo, "tag", "-f", "v1");
    await expect(
      pushTag(createGit(repo, "git"), { tagName: "v1", remote: "origin" })
    ).rejects.toThrow();
    expect(run(origin, "rev-parse", "refs/tags/v1")).toBe(head);
  });

  it("pushes an annotated tag as a tag object", async () => {
    const { repo, origin } = withOrigin();
    run(repo, "tag", "-a", "-m", "annotated", "a1");
    await expect(
      pushTag(createGit(repo, "git"), { tagName: "a1", remote: "origin" })
    ).resolves.toBeUndefined();
    expect(run(origin, "for-each-ref", "--format=%(objecttype)", "refs/tags/a1")).toBe("tag");
  });

  it("pushes from a client opened in a subfolder", async () => {
    const { repo, origin } = withOrigin();
    run(repo, "tag", "v1");
    const sub = path.join(repo, "sub");
    fs.mkdirSync(sub);
    await pushTag(createGit(sub, "git"), { tagName: "v1", remote: "origin" });
    expect(tagsOf(origin)).toBe("v1");
  });

  it.skipIf(onWindows)(
    "stops a stalled push without prompting",
    async () => {
      const repo = box.repo();
      const origin = stalledOrigin(repo);
      run(repo, "tag", "t1");
      const controller = new AbortController();

      await withoutPromptSetting(async () => {
        const push = pushTag(createGit(repo, "git", controller.signal), {
          tagName: "t1",
          remote: "origin"
        }).then(
          () => "resolved",
          () => "rejected"
        );
        const ssh = await origin.connected();
        expect(ssh.prompt).toBe("0");
        const abortedAt = Date.now();
        controller.abort();
        expect(await push).toBe("rejected");
        expect(Date.now() - abortedAt).toBeLessThan(5000);
        await vi.waitFor(() => expect(isRunning(ssh.pid)).toBe(false));
      });
    },
    20_000
  );
});
