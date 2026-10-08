import { beforeEach, describe, expect, it, vi } from "vitest";

import { readFileAt } from "@/backend/queries/tree";
import {
  formatSize,
  IMAGE_DIFF_VIEW_TYPE,
  IMAGE_SIZE_LIMIT,
  imageDiffHtml,
  isImageChange
} from "@/extension/image-diff";

import { legacyPage } from "@tests/extension/legacy-page";

const editor = vi.hoisted(() => {
  const panel = {
    webview: { html: "", onDidReceiveMessage: vi.fn() },
    onDidDispose: vi.fn()
  };
  return { executeCommand: vi.fn(), createWebviewPanel: vi.fn(() => panel), panel };
});

vi.mock("vscode", () => ({
  l10n: {
    t: (message: string, ...values: string[]) =>
      values.reduce((sentence, value, index) => sentence.replace(`{${index}}`, value), message)
  },
  env: { language: "en" },
  workspace: { textDocuments: [] },
  window: { createWebviewPanel: editor.createWebviewPanel },
  commands: { executeCommand: editor.executeCommand },
  ViewColumn: { Active: -1 },
  Uri: { from: (parts: object) => parts }
}));
vi.mock("@/backend/gitClient", () => ({
  gitClientFactory: (repo: string) => ({ getInstance: () => ({ client: repo }) })
}));
vi.mock("@/backend/queries/tree", () => ({ readFileAt: vi.fn() }));
vi.mock("@/extension/watchers/git-repo.watcher", () => ({
  selectWatchedRepo: vi.fn(),
  muteGitRepoWatcher: vi.fn(),
  unmuteGitRepoWatcher: vi.fn()
}));

const HASH = "0123456789abcdef0123456789abcdef01234567";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 0xff]);
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');

/** Ask for the diff of one changed file, as the commit details do. */
async function viewDiff(newFilePath: string, type = "M", oldFilePath = newFilePath) {
  const page = legacyPage();
  await page.send({
    command: "viewDiff",
    repo: "/repo",
    commitHash: HASH,
    oldFilePath,
    newFilePath,
    type
  });
  return page;
}

/** The two image data URIs of the page, in order. */
const images = (html: string) => [...html.matchAll(/<img src="([^"]*)"/g)].map((match) => match[1]);

beforeEach(() => {
  vi.clearAllMocks();
  editor.panel.webview.html = "";
});

describe("choosing the image comparison", () => {
  it("compares an image's two versions in a panel instead of a text diff", async () => {
    vi.mocked(readFileAt).mockResolvedValue({ size: PNG.length, bytes: PNG });
    const page = await viewDiff("art/logo.png");

    expect(editor.executeCommand).not.toHaveBeenCalled();
    expect(readFileAt).toHaveBeenCalledWith(
      { client: "/repo" },
      `${HASH}^`,
      "art/logo.png",
      IMAGE_SIZE_LIMIT
    );
    expect(readFileAt).toHaveBeenCalledWith(
      { client: "/repo" },
      HASH,
      "art/logo.png",
      IMAGE_SIZE_LIMIT
    );
    expect(editor.createWebviewPanel).toHaveBeenCalledExactlyOnceWith(
      IMAGE_DIFF_VIEW_TYPE,
      "logo.png (01234567^ ↔ 01234567)",
      { viewColumn: -1, preserveFocus: false },
      { enableScripts: true, enableCommandUris: false, localResourceRoots: [] }
    );
    const source = `data:image/png;base64,${PNG.toString("base64")}`;
    expect(images(editor.panel.webview.html)).toEqual([source, source]);
    expect(page.received).toEqual([{ command: "viewDiff", success: true }]);
  });

  it.each(["a.PNG", "b.jpg", "c.jpeg", "d.gif", "e.webp", "f.bmp", "g.ico", "h.svg"])(
    "knows %s for an image by its extension",
    (file) => {
      expect(isImageChange({ type: "M", oldFilePath: file, newFilePath: file })).toBe(true);
    }
  );

  it("keeps the text diff for other files, and for a change between an image and another file", async () => {
    await Promise.all(
      [
        ["notes.txt", "notes.txt"],
        ["logo.png", "logo.txt"],
        ["png", "png"],
        [".png", ".png"],
        ["dir.png/readme", "dir.png/readme"]
      ].map(([file, from]) => viewDiff(file!, file === from ? "M" : "R", from))
    );

    expect(editor.createWebviewPanel).not.toHaveBeenCalled();
    expect(readFileAt).not.toHaveBeenCalled();
    expect(editor.executeCommand).toHaveBeenCalledTimes(5);
    expect(editor.executeCommand).toHaveBeenCalledWith(
      "vscode.diff",
      expect.objectContaining({ scheme: "branchwise", path: "notes.txt" }),
      expect.objectContaining({ scheme: "branchwise", path: "notes.txt" }),
      "notes.txt (01234567^ ↔ 01234567)",
      { preview: true }
    );
  });

  it("shows an added or a deleted image on its one side, and says why the other is empty", async () => {
    vi.mocked(readFileAt).mockResolvedValue({ size: PNG.length, bytes: PNG });
    await viewDiff("new.png", "A");
    expect(readFileAt).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      HASH,
      "new.png",
      IMAGE_SIZE_LIMIT
    );
    expect(images(editor.panel.webview.html)).toHaveLength(1);
    expect(editor.panel.webview.html).toContain(
      "Added by this commit, so there is no earlier version."
    );
    // Without two images there is nothing to swipe between.
    expect(editor.panel.webview.html).not.toContain('<button type="button" data-mode=');

    vi.mocked(readFileAt).mockClear();
    await viewDiff("old.png", "D");
    expect(readFileAt).toHaveBeenCalledExactlyOnceWith(
      expect.anything(),
      `${HASH}^`,
      "old.png",
      IMAGE_SIZE_LIMIT
    );
    expect(editor.panel.webview.html).toContain(
      "Deleted by this commit, so there is no later version."
    );
  });

  it("says an image above the size limit is too large, and does not embed it", async () => {
    vi.mocked(readFileAt)
      .mockResolvedValueOnce({ size: 25 * 1024 * 1024, bytes: null })
      .mockResolvedValueOnce({ size: PNG.length, bytes: PNG });
    await viewDiff("huge.png");

    expect(images(editor.panel.webview.html)).toHaveLength(1);
    expect(editor.panel.webview.html).toContain(
      "Too large to preview: 25 MB. Images up to 20 MB are shown."
    );
  });

  it("reports a failure to read the image as a diff that did not open", async () => {
    vi.mocked(readFileAt).mockRejectedValue(new Error("bad object"));
    const page = await viewDiff("pic.png");

    expect(editor.createWebviewPanel).not.toHaveBeenCalled();
    expect(page.received).toEqual([{ command: "viewDiff", success: false }]);
  });

  it("offers an SVG's text diff from the panel", async () => {
    vi.mocked(readFileAt).mockResolvedValue({ size: SVG.length, bytes: SVG });
    await viewDiff("icon.svg");
    expect(editor.panel.webview.html).toContain("data-text-diff");

    const [listener] = editor.panel.webview.onDidReceiveMessage.mock.calls.at(-1)!;
    (listener as (message: unknown) => void)({ command: "textDiff" });
    (listener as (message: unknown) => void)({ command: "somethingElse" });
    expect(editor.executeCommand).toHaveBeenCalledExactlyOnceWith(
      "vscode.diff",
      expect.objectContaining({ path: "icon.svg" }),
      expect.objectContaining({ path: "icon.svg" }),
      "icon.svg (01234567^ ↔ 01234567)",
      { preview: true }
    );
  });
});

describe("the comparison page", () => {
  const page = (overrides: Partial<Parameters<typeof imageDiffHtml>[0]> = {}) =>
    imageDiffHtml({
      before: { state: "image", size: SVG.length, type: "image/svg+xml", bytes: SVG },
      after: { state: "image", size: PNG.length, type: "image/png", bytes: PNG },
      labels: ['a"b^', "<i>c</i>"],
      nonce: "NONCE",
      textDiff: false,
      ...overrides
    });

  it("lets nothing load or run but the images and its own nonce'd style and script", () => {
    const html = page();
    expect(html).toContain(
      `content="default-src 'none'; img-src data:; style-src 'nonce-NONCE'; script-src 'nonce-NONCE';"`
    );
    const scripts = [...html.matchAll(/<script([^>]*)>/g)].map((match) => match[1]);
    expect(scripts).toEqual([' nonce="NONCE"']);
    expect([...html.matchAll(/<style([^>]*)>/g)].map((match) => match[1])).toEqual([
      ' nonce="NONCE"'
    ]);
    expect(html).not.toMatch(/ style="/);
  });

  it("shows an SVG as an image from a data URI, never as markup of the page", () => {
    const html = page();
    expect(images(html)[0]).toBe(`data:image/svg+xml;base64,${SVG.toString("base64")}`);
    expect(html).not.toContain("<svg");
    expect(html).not.toContain("alert(1)");
  });

  it("escapes the revision labels", () => {
    const html = page();
    expect(html).toContain('<code>a"b^</code>');
    expect(html).toContain('alt="Before (a&quot;b^)"');
    expect(html).toContain("<code>&lt;i&gt;c&lt;/i&gt;</code>");
    expect(html).not.toContain("<i>c</i>");
  });

  it("offers side by side, swipe and onion skin when both versions show", () => {
    const html = page();
    expect([...html.matchAll(/<button type="button" data-mode="(\w+)"/g)].map((m) => m[1])).toEqual(
      ["side", "swipe", "onion"]
    );
    expect(html).toContain('<input class="position" type="range"');
    expect(page({ after: { state: "tooLarge", size: IMAGE_SIZE_LIMIT + 1 } })).not.toContain(
      '<input class="position"'
    );
  });

  it("writes sizes in the display language", () => {
    expect(formatSize(512, "en")).toBe("512 byte");
    expect(formatSize(1536, "en")).toBe("1.5 kB");
    expect(formatSize(20 * 1024 * 1024, "en")).toBe("20 MB");
    expect(formatSize(1536, "not a language")).toMatch(/1[.,]5/);
  });
});
