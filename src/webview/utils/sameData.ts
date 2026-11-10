/** The keys of `object` that hold a value. */
function present(object: Record<string, unknown>) {
  return Object.keys(object).filter((key) => object[key] !== undefined);
}

/**
 * Whether two values that arrived as JSON hold the same data: the same primitives, arrays of the
 * same items in the same order, and objects with the same keys and values, whatever the order of
 * their keys. A key set to `undefined` counts as missing, as it is once the value is sent.
 */
export function sameData(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) {
    // NaN is the one primitive that is not itself.
    return typeof a === "number" && typeof b === "number" && Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => sameData(item, b[index]))
    );
  }
  const left = a as Record<string, unknown>;
  const right = b as Record<string, unknown>;
  const keys = present(left);
  return (
    keys.length === present(right).length && keys.every((key) => sameData(left[key], right[key]))
  );
}

/**
 * `next`, with each row that `previous` already holds unchanged replaced by the object
 * `previous` holds, and `previous` itself when every row is one of its own in the same order.
 * What is drawn from the rows then sees a reload that changed nothing as no change at all, and
 * a reload that changed little as a change to those rows only. `same` decides whether a row is
 * unchanged; rows are matched by `hash`.
 */
export function reuseRows<Row extends { hash: string }>(
  previous: ReadonlyArray<Row> | undefined,
  next: Array<Row>,
  same: (a: Row, b: Row) => boolean = sameData
): Array<Row> {
  if (previous === undefined) {
    return next;
  }
  const known = new Map(previous.map((row) => [row.hash, row]));
  let unchanged = previous.length === next.length;
  const rows = next.map((row, index) => {
    const old = known.get(row.hash);
    if (old === undefined || !same(old, row)) {
      unchanged = false;
      return row;
    }
    if (previous[index] !== old) {
      unchanged = false;
    }
    return old;
  });
  return unchanged ? (previous as Array<Row>) : rows;
}
