import { useEffect } from "preact/hooks";

import { focusSearch } from "@/webview/lib/focus";
import { leaveNavigation, restoreScroll } from "@/webview/lib/navigation";
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
      }
    };
    window.addEventListener("scroll", scroll, { passive: true });
    window.addEventListener("pagehide", save);
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      save();
      window.removeEventListener("scroll", scroll);
      window.removeEventListener("pagehide", save);
      window.removeEventListener("keydown", key);
    };
  }, []);
  return null;
}
