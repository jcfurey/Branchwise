import { randomBytes } from "node:crypto";

import type { SimpleGit } from "simple-git";
import * as vscode from "vscode";

import { readFileAt } from "@/backend/queries/tree";
import type { GitFileChange } from "@/backend/types";
import { imageType } from "@/backend/utils/image";
import { escapeAttribute } from "@/extension/html";

/**
 * Two versions of an image side by side, in a webview panel of their own. VS Code's own image
 * preview cannot show `branchwise:` documents: they come from a text content provider, which
 * hands VS Code text rather than bytes, and the preview reads images through file system
 * providers only, so `vscode.diff` would open them as a text diff of binary data.
 *
 * Images come from the repository and may be hostile. They reach the page only as `data:` URIs
 * in `<img>` elements, never inlined, so not even an SVG can run a script; the page's policy lets
 * nothing else load, and only its own script, which carries this page's nonce, runs.
 */

export const IMAGE_DIFF_VIEW_TYPE = "branchwise.imageDiff";

/** The largest image, in bytes, that is read and shown. Larger ones only report their size. */
export const IMAGE_SIZE_LIMIT = 20 * 1024 * 1024;

/** Every sentence the panel shows, in the order the l10n bundle meets them. */
const text = {
  before: () => vscode.l10n.t("Before"),
  after: () => vscode.l10n.t("After"),
  sideBySide: () => vscode.l10n.t("Side by Side"),
  swipe: () => vscode.l10n.t("Swipe"),
  onionSkin: () => vscode.l10n.t("Onion Skin"),
  position: () => vscode.l10n.t("How much of each version shows"),
  added: () => vscode.l10n.t("Added by this commit, so there is no earlier version."),
  deleted: () => vscode.l10n.t("Deleted by this commit, so there is no later version."),
  tooLarge: (size: string, limit: string) =>
    vscode.l10n.t("Too large to preview: {0}. Images up to {1} are shown.", size, limit),
  // {0} is the width and {1} the height. The page fills them in once the image has loaded.
  dimensions: () => vscode.l10n.t("{0} × {1} pixels"),
  unreadable: () => vscode.l10n.t("This image could not be shown."),
  textDiff: () => vscode.l10n.t("Open Text Diff")
};

/** One version of the image: missing on its side of the change, too large to show, or shown. */
export type ImageSide =
  | { state: "missing" }
  | { state: "tooLarge"; size: number }
  | { state: "image"; size: number; type: string; bytes: Buffer };

/** What to compare: the change as the commit details list it, and how to label the sides. */
export type ImageDiffRequest = {
  commit: string;
  oldFilePath: string;
  newFilePath: string;
  type: GitFileChange["type"];
  title: string;
  /** Names of the two revisions, such as `abc1234^` and `abc1234`. */
  labels: [before: string, after: string];
  /** Opens the change as an ordinary text diff, which an SVG offers too. */
  openTextDiff: () => Thenable<unknown>;
};

/**
 * Whether a change of the commit details opens as an image comparison: every side the change
 * has is an image by its extension. Size does not count here; an image too large to show still
 * opens the panel, which says so.
 */
export function isImageChange(change: Pick<GitFileChange, "type" | "oldFilePath" | "newFilePath">) {
  return (
    (change.type === "A" || imageType(change.oldFilePath) !== null) &&
    (change.type === "D" || imageType(change.newFilePath) !== null)
  );
}

/** `file` at `revision`, read up to `IMAGE_SIZE_LIMIT` bytes. */
export async function loadImageSide(
  git: SimpleGit,
  revision: string,
  file: string
): Promise<ImageSide> {
  const found = await readFileAt(git, revision, file, IMAGE_SIZE_LIMIT);
  if (found === null) {
    return { state: "missing" };
  }
  if (found.bytes === null) {
    return { state: "tooLarge", size: found.size };
  }
  return {
    state: "image",
    size: found.size,
    type: imageType(file) ?? "application/octet-stream",
    bytes: found.bytes
  };
}

/** A size in bytes as the display language writes it, in bytes, kilobytes or megabytes. */
export function formatSize(bytes: number, language = vscode.env.language) {
  const [value, unit] =
    bytes < 1024
      ? [bytes, "byte"]
      : bytes < 1024 * 1024
        ? [bytes / 1024, "kilobyte"]
        : [bytes / (1024 * 1024), "megabyte"];
  const options = { style: "unit", unit, maximumFractionDigits: 1 } as const;
  try {
    return new Intl.NumberFormat(language, options).format(value);
  } catch {
    // A display language Intl does not know.
    return new Intl.NumberFormat(undefined, options).format(value);
  }
}

const TEXT_ENTITIES: Readonly<Record<string, string>> = { "&": "&amp;", "<": "&lt;", ">": "&gt;" };

/** Text that shows as written between tags. */
function escapeText(value: string) {
  return value.replaceAll(/[&<>]/g, (character) => TEXT_ENTITIES[character] ?? character);
}

/** One version in its frame, with its heading and facts below. */
function figure(side: ImageSide, name: "before" | "after", heading: string, revision: string) {
  let body: string;
  let facts = "";
  if (side.state === "image") {
    const source = `data:${side.type};base64,${side.bytes.toString("base64")}`;
    body = `<img src="${escapeAttribute(source)}" alt="${escapeAttribute(`${heading} (${revision})`)}">`;
    facts = `<span data-dimensions></span> · ${escapeText(formatSize(side.size))}`;
  } else if (side.state === "tooLarge") {
    body = `<p class="note">${escapeText(
      text.tooLarge(formatSize(side.size), formatSize(IMAGE_SIZE_LIMIT))
    )}</p>`;
  } else {
    body = `<p class="note">${escapeText(name === "before" ? text.added() : text.deleted())}</p>`;
  }
  return `<figure data-side="${name}" data-state="${side.state}">
      <figcaption><b>${escapeText(heading)}</b> <code>${escapeText(revision)}</code></figcaption>
      <div class="frame">${body}</div>
      <p class="facts">${facts}</p>
    </figure>`;
}

const STYLE = `
  body { margin: 0; padding: 12px 16px; color: var(--vscode-foreground);
    background: var(--vscode-editor-background); font: var(--vscode-font-size) var(--vscode-font-family); }
  .toolbar { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 12px; }
  button { cursor: pointer; border: 1px solid var(--vscode-button-border, transparent); border-radius: 2px;
    padding: 3px 10px; color: var(--vscode-button-secondaryForeground);
    background: var(--vscode-button-secondaryBackground); font: inherit; }
  button:hover { background: var(--vscode-button-secondaryHoverBackground); }
  button[aria-pressed="true"] { color: var(--vscode-button-foreground); background: var(--vscode-button-background); }
  button:focus-visible, input:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 2px; }
  input[type="range"] { width: 160px; }
  .sides { display: flex; gap: 16px; align-items: flex-start; }
  figure { flex: 1 1 0; min-width: 0; margin: 0; }
  figcaption, .facts { margin: 0 0 6px; color: var(--vscode-descriptionForeground); }
  figcaption b { color: var(--vscode-foreground); }
  .facts { margin: 6px 0 0; min-height: 1.4em; }
  .frame { display: flex; align-items: flex-start; min-height: 64px; overflow: auto;
    border: 1px solid var(--vscode-panel-border, transparent);
    background: repeating-conic-gradient(#8882 0% 25%, transparent 0% 50%) 0 0 / 16px 16px; }
  .frame img { display: block; max-width: 100%; height: auto; }
  .note { margin: 0; padding: 16px; color: var(--vscode-descriptionForeground); }
  body:not([data-mode="side"]) .sides { display: grid; }
  body:not([data-mode="side"]) figure { grid-area: 1 / 1; }
  body:not([data-mode="side"]) figcaption, body:not([data-mode="side"]) .facts { visibility: hidden; }
  body[data-mode="onion"] figure[data-side="after"] { opacity: var(--mix, 0.5); }
  body[data-mode="swipe"] figure[data-side="after"] {
    clip-path: inset(0 calc(100% - var(--mix, 0.5) * 100%) 0 0); }
  body[data-mode="side"] .position { display: none; }
`;

/**
 * The script of the page: it writes each image's size in pixels once it has loaded, switches
 * between the ways of comparing, and asks for the text diff. Its strings arrive as data
 * attributes, so nothing of them is read as code.
 */
const SCRIPT = `
  const api = acquireVsCodeApi();
  const template = document.body.dataset.dimensions;
  for (const image of document.querySelectorAll("img")) {
    const facts = image.closest("figure").querySelector("[data-dimensions]");
    const show = () => {
      facts.textContent = template.replace("{0}", String(image.naturalWidth)).replace("{1}", String(image.naturalHeight));
    };
    if (image.complete && image.naturalWidth > 0) {
      show();
    } else {
      image.addEventListener("load", show);
    }
    image.addEventListener("error", () => {
      const note = document.createElement("p");
      note.className = "note";
      note.textContent = document.body.dataset.unreadable;
      image.replaceWith(note);
    });
  }
  const modes = [...document.querySelectorAll("[data-mode]")];
  for (const button of modes) {
    button.addEventListener("click", () => {
      document.body.dataset.mode = button.dataset.mode;
      for (const other of modes) {
        other.setAttribute("aria-pressed", String(other === button));
      }
    });
  }
  const position = document.querySelector(".position");
  position?.addEventListener("input", () => {
    document.body.style.setProperty("--mix", String(Number(position.value) / 100));
  });
  document.querySelector("[data-text-diff]")?.addEventListener("click", () => {
    api.postMessage({ command: "textDiff" });
  });
`;

/** The page comparing `before` with `after`. Exported for its tests. */
export function imageDiffHtml(options: {
  before: ImageSide;
  after: ImageSide;
  labels: [before: string, after: string];
  nonce: string;
  /** Offer the text diff, as for an SVG, whose source is text. */
  textDiff: boolean;
}) {
  const { before, after, labels, nonce } = options;
  const policy = [
    "default-src 'none'",
    "img-src data:",
    `style-src 'nonce-${nonce}'`,
    `script-src 'nonce-${nonce}'`
  ]
    .map((directive) => `${directive};`)
    .join(" ");
  const both = before.state === "image" && after.state === "image";
  const modes = both
    ? [
        ["side", text.sideBySide()],
        ["swipe", text.swipe()],
        ["onion", text.onionSkin()]
      ]
        .map(
          ([mode, label]) =>
            `<button type="button" data-mode="${mode}" aria-pressed="${mode === "side"}">${escapeText(label!)}</button>`
        )
        .join("")
    : "";
  const position = both
    ? `<input class="position" type="range" min="0" max="100" value="50" aria-label="${escapeAttribute(text.position())}">`
    : "";
  const textDiff = options.textDiff
    ? `<button type="button" data-text-diff>${escapeText(text.textDiff())}</button>`
    : "";
  const toolbar =
    modes || textDiff ? `<div class="toolbar">${modes}${position}${textDiff}</div>` : "";
  return `<!DOCTYPE html>
<html lang="${escapeAttribute(vscode.env.language)}">
  <head>
    <meta charset="UTF-8">
    <meta http-equiv="Content-Security-Policy" content="${policy}">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style nonce="${nonce}">${STYLE}</style>
  </head>
  <body data-mode="side" data-image-diff data-dimensions="${escapeAttribute(text.dimensions())}" data-unreadable="${escapeAttribute(text.unreadable())}">
    ${toolbar}
    <div class="sides">
    ${figure(before, "before", text.before(), labels[0])}
    ${figure(after, "after", text.after(), labels[1])}
    </div>
    <script nonce="${nonce}">${SCRIPT}</script>
  </body>
</html>
`;
}

/**
 * Open a commit's change of an image as a comparison of its two versions: the old path at the
 * commit's first parent beside the new path at the commit, as the text diff would compare them.
 */
export async function openImageDiff(git: SimpleGit, request: ImageDiffRequest): Promise<void> {
  const { commit, oldFilePath, newFilePath, type } = request;
  const missing: ImageSide = { state: "missing" };
  const [before, after] = await Promise.all([
    type === "A" ? missing : loadImageSide(git, `${commit}^`, oldFilePath),
    type === "D" ? missing : loadImageSide(git, commit, newFilePath)
  ]);
  const panel = vscode.window.createWebviewPanel(
    IMAGE_DIFF_VIEW_TYPE,
    request.title,
    { viewColumn: vscode.ViewColumn.Active, preserveFocus: false },
    { enableScripts: true, enableCommandUris: false, localResourceRoots: [] }
  );
  panel.webview.html = imageDiffHtml({
    before,
    after,
    labels: request.labels,
    // 24 random bytes give 192 bits in 32 base64url characters, with no padding.
    nonce: randomBytes(24).toString("base64url"),
    textDiff: [oldFilePath, newFilePath].some((file) => imageType(file) === "image/svg+xml")
  });
  const listener = panel.webview.onDidReceiveMessage((message: unknown) => {
    if ((message as { command?: unknown } | null)?.command === "textDiff") {
      void Promise.resolve(request.openTextDiff()).catch(() => {});
    }
  });
  panel.onDidDispose(() => listener.dispose());
}
