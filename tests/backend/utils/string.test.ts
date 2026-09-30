import { expect, it } from "vitest";

import { abbrevCommit } from "@/backend/utils/string";

it.each([
  ["a full hash", "0123456789abcdef0123456789abcdef01234567", "01234567"],
  ["nine characters", "123456789", "12345678"],
  ["exactly eight characters", "12345678", "12345678"],
  ["a shorter string", "abc", "abc"],
  ["the empty string", "", ""],
  ["leading spaces, untrimmed", "  abcdefghij", "  abcdef"],
  ["upper case, unchanged", "ABCDEF0123456789", "ABCDEF01"],
  ["surrogate pairs, by UTF-16 unit", "😀😀😀😀😀", "😀😀😀😀"]
])("shortens %s to its first eight units", (_, hash, short) => {
  expect(abbrevCommit(hash)).toBe(short);
});
