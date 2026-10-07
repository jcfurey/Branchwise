import { GraphSkeleton } from "@/webview/components/ui/Loading";

/**
 * The whole window while the page starts: the rows of a graph still to come. It needs no
 * `window.l10n`, which comes later.
 */
export function LoadingPage() {
  return (
    <main class="min-h-screen">
      <GraphSkeleton />
    </main>
  );
}
