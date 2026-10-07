/**
 * The operating system of the window the page is shown in, from the browser's user agent. That is
 * the machine whose keyboard and file manager the user has, even when the repository is on a
 * remote one.
 */
export function pagePlatform(): "mac" | "windows" | "other" {
  const agent = navigator.userAgent;
  if (/Mac|iPhone|iPad/.test(agent)) {
    return "mac";
  }
  return /Windows/.test(agent) ? "windows" : "other";
}

/** What showing a folder in the system's file manager is called here, as VS Code calls it. */
export function revealFolderTitle(): string {
  const l10n = window.l10n;
  switch (pagePlatform()) {
    case "windows":
      return l10n.revealWorktreeWindows;
    case "mac":
      return l10n.revealWorktreeMac;
    case "other":
      return l10n.revealWorktreeOther;
  }
}
