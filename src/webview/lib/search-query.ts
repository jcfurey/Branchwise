import type { HistoryFilter } from "@/backend/types";

/**
 * The fields a search can set with `name:value` in its text, by the name typed. `diff:` is
 * another name for `changes:`.
 */
const FIELDS = {
  author: "author",
  committer: "committer",
  branch: "branch",
  tag: "tag",
  path: "path",
  changes: "changes",
  diff: "changes",
  since: "since",
  until: "until"
} as const satisfies Record<string, keyof HistoryFilter>;

type Field = (typeof FIELDS)[keyof typeof FIELDS];

/**
 * `name:value` or `name:"value with spaces"` for a name in `FIELDS`, ignoring case, at the start
 * of the text or after a space. Anything else, such as `fix: typo`, stays search text.
 */
const PREFIX = /(^|\s)([a-z]+):(?:"([^"]*)"|(\S+))/gi;

/**
 * The filter with every `name:value` in its search text moved into the field it names. A field
 * named twice, under either of its names, keeps the last value. Returns the same object when the
 * text names no field.
 */
export function applySearchPrefixes(filter: HistoryFilter): HistoryFilter {
  const fields: Partial<Record<Field, string>> = {};
  const text = filter.text.replace(
    PREFIX,
    (match, before: string, name: string, quoted?: string, plain?: string) => {
      const key = name.toLowerCase();
      if (!Object.hasOwn(FIELDS, key)) {
        return match;
      }
      fields[FIELDS[key as keyof typeof FIELDS]] = quoted ?? plain ?? "";
      return before;
    }
  );
  if (Object.keys(fields).length === 0) {
    return filter;
  }
  return { ...filter, ...fields, text: text.replace(/\s+/g, " ").trim() };
}

/** Whether any of the fields behind the Filters button holds something. */
export function hasFieldFilters(filter: HistoryFilter) {
  return (
    [
      filter.author,
      filter.committer,
      filter.branch,
      filter.tag,
      filter.path,
      filter.changes,
      filter.since,
      filter.until
    ].some(Boolean) || filter.regex === true
  );
}
