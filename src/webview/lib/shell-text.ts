/**
 * Strings that the HTML shell carries on `<html>`, for the moments before the page has
 * `window.l10n`: while it loads, when it cannot start, and when the extension does not answer.
 */
export function shellText(name: "loading" | "initFailed" | "rpcTimeout"): string {
  return document.documentElement.dataset[name] ?? "";
}
