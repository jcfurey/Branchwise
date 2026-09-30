import { Loading } from "@/webview/components/ui/Loading";

/** The whole window while the page starts. It needs no `window.l10n`, which comes later. */
export function LoadingPage() {
  return (
    <main class="flex min-h-screen items-center justify-center px-6 py-16">
      <Loading variant="page" />
    </main>
  );
}
