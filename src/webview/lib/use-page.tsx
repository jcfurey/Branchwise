import { useState } from "preact/hooks";

/** Rows a long list renders before **Show more**. */
export const PAGE_SIZE = 200;

/** The first pages of `items`, and a Show more button while more remain. */
export function usePage<T>(items: T[]) {
  const [limit, setLimit] = useState(PAGE_SIZE);
  const more = items.length - limit;
  return {
    shown: more > 0 ? items.slice(0, limit) : items,
    more:
      more > 0 ? (
        <button
          type="button"
          class="w-full cursor-pointer px-3 py-1 text-left text-xs text-muted hover:text-fg hover:underline focus:outline-1 focus:outline-focus"
          onClick={() => setLimit(limit + PAGE_SIZE)}
        >
          {window.l10n.showMoreRefs
            .replace("{0}", String(Math.min(more, PAGE_SIZE)))
            .replace("{1}", String(more))}
        </button>
      ) : null
  };
}
