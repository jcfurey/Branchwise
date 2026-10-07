import { useEffect } from "preact/hooks";

import { openShortcutSheet } from "@/webview/components/ui/ShortcutSheet";
import { focusSearch } from "@/webview/lib/focus";
import { leaveNavigation, restoreScroll } from "@/webview/lib/navigation";
import { onPageScroll } from "@/webview/lib/page-scroll";
import { shortcutFor } from "@/webview/lib/shortcuts";
import { contextMenu, dialog, selectedRepo } from "@/webview/lib/stores";

export function NavigationEffects() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      if (restoreScroll.value === null) {
        leaveNavigation(selectedRepo.value);
      }
    };
    const scroll = () => {
      clearTimeout(timer);
      timer = setTimeout(save, 200);
    };
    const key = (event: KeyboardEvent) => {
      if (dialog.value || contextMenu.value) {
        return;
      }
      const input =
        event.target instanceof Element &&
        event.target.closest("input, textarea, select, [contenteditable]");
      if (
        ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") ||
        (!input && event.key === "/")
      ) {
        event.preventDefault();
        focusSearch();
      } else if (shortcutFor(event, "page")?.id === "shortcutSheet") {
        event.preventDefault();
        if (!event.repeat) {
          openShortcutSheet();
        }
      }
    };
    const stopScroll = onPageScroll(scroll);
    window.addEventListener("pagehide", save);
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      save();
      stopScroll();
      window.removeEventListener("pagehide", save);
      window.removeEventListener("keydown", key);
    };
  }, []);
  return null;
}
