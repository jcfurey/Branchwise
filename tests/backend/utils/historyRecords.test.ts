import { expect, it } from "vitest";

import { parseHistory } from "@/backend/utils/history";

it("keeps a history entry whose timestamp is empty, dated at the epoch", () => {
  const hash = "0123456789abcdef0123456789abcdef01234567";
  const record = ["NGG-HISTORY", hash, "", "Grace", "grace@example.test", "", "No date", ""];

  // The graph's log parser gives NaN here instead; history entries pin 0 until they agree.
  expect(parseHistory(record.join("\0"))).toStrictEqual([
    {
      hash,
      parentHashes: [],
      author: "Grace",
      email: "grace@example.test",
      date: 0,
      message: "No date",
      refs: []
    }
  ]);
});
