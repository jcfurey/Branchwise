/** The media type of each file extension shown as a picture rather than as text, SVG included. */
const IMAGE_TYPES: Readonly<Record<string, string>> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  ico: "image/x-icon",
  svg: "image/svg+xml"
};

/**
 * The media type of the image `path` names by its extension, in any case, or null for a path
 * that is not an image's. Only the last segment counts, so a folder named `x.png` does not.
 */
export function imageType(path: string): string | null {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  if (dot <= 0) {
    return null;
  }
  const extension = name.slice(dot + 1).toLowerCase();
  return Object.hasOwn(IMAGE_TYPES, extension) ? IMAGE_TYPES[extension]! : null;
}
