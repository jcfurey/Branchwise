import { getWebviewConfig } from "@/webview/lib/webview-config";

/** The uncommitted row's dot and edge, whatever the palette and theme. */
export const UNCOMMITTED_COLOUR = "#808080";

/**
 * The configured colour for palette `index`, going round the palette again when the index passes
 * its end, and exactly as the setting spells it. `undefined` when the palette is empty: callers then
 * fall back to the theme's focus colour.
 *
 * The configuration is read on every call, so a render that calls this follows setting changes.
 * Only whole numbers from 0 up are meaningful; any other index may give `undefined`.
 */
export function branchColour(index: number): string | undefined {
  const palette = getWebviewConfig().graphColours;
  if (palette.length === 0) {
    return undefined;
  }
  return palette[index % palette.length];
}
