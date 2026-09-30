import type { ComponentChildren } from "preact";

import { Button } from "@/webview/components/ui/Button";
import { INPUT_CLASS } from "@/webview/components/ui/Input";
import { Loading } from "@/webview/components/ui/Loading";
import { copyToClipboard } from "@/webview/lib/copy";

export function TextField({
  label,
  value,
  change,
  type = "text",
  children
}: {
  label: string;
  value: string;
  change: (value: string) => void;
  type?: "text" | "date";
  children?: ComponentChildren;
}) {
  return (
    <label class="grid min-w-0 gap-1 text-left text-ui">
      <span class="text-muted">{label}</span>
      <input
        class={INPUT_CLASS}
        type={type}
        value={value}
        onInput={(event) => change(event.currentTarget.value)}
      />
      {children}
    </label>
  );
}

export function QueryStatus({ loading, error }: { loading: boolean; error: string | null }) {
  if (loading) {
    return (
      <div class="p-4" role="status">
        <Loading />
      </div>
    );
  }
  if (!error) {
    return null;
  }
  return (
    <div class="space-y-2 rounded border border-line p-3">
      <p role="alert" class="break-words whitespace-pre-wrap select-text">
        {error}
      </p>
      <Button onClick={() => copyToClipboard(window.l10n.errorDetails, error)}>
        {window.l10n.copyError}
      </Button>
    </div>
  );
}

export function PageControls({
  offset,
  count,
  more,
  change
}: {
  offset: number;
  count: number;
  more: boolean;
  change: (offset: number) => void;
}) {
  return (
    <div class="flex items-center justify-between gap-3 py-3 text-ui">
      <span class="text-muted">{count === 0 ? "0" : `${offset + 1}–${offset + count}`}</span>
      <div class="flex gap-2">
        <Button disabled={offset === 0} onClick={() => change(Math.max(0, offset - 100))}>
          {window.l10n.previousPage}
        </Button>
        <Button disabled={!more} onClick={() => change(offset + 100)}>
          {window.l10n.nextPage}
        </Button>
      </div>
    </div>
  );
}
