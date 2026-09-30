import type { ComponentChildren } from "preact";
import { useErrorBoundary } from "preact/hooks";

import { Button } from "@/webview/components/ui/Button";
import { format } from "@/webview/utils/format";

/**
 * Keep one failing part of the view, such as a commit the renderer cannot display, from
 * blanking the whole webview. The error and a retry replace only `children`.
 */
export function ErrorBoundary({ children }: { children: ComponentChildren }) {
  const [error, reset] = useErrorBoundary((caught: unknown) => {
    // eslint-disable-next-line no-console
    console.error(caught);
  });
  if (error === undefined) {
    return <>{children}</>;
  }
  return (
    <div role="alert" class="p-4">
      <p class="select-text">
        {format(window.l10n.viewFailed, error instanceof Error ? error.message : String(error))}
      </p>
      <Button onClick={reset}>{window.l10n.retryView}</Button>
    </div>
  );
}
