import type { GitCommitNode } from "@/backend/types";

export function commit(hash: string, ...parentHashes: string[]): GitCommitNode {
  return {
    hash,
    parentHashes,
    author: "Author",
    email: "a@test",
    date: 0,
    message: hash,
    refs: []
  };
}

export const histories = {
  "reused lanes": [
    commit("merge", "main", "topic"),
    commit("main", "between"),
    commit("topic", "between"),
    commit("between", "older-merge"),
    commit("older-merge", "older-main", "older-topic"),
    commit("older-main", "base"),
    commit("older-topic", "base"),
    commit("base")
  ],
  "octopus merge": [
    commit("merge", "main", "one", "two", "three"),
    commit("main", "base"),
    commit("one", "base"),
    commit("two", "base"),
    commit("three", "base"),
    commit("base")
  ],
  "criss-cross merges": [
    commit("tip", "left-merge", "right-merge"),
    commit("left-merge", "left", "right"),
    commit("right-merge", "right", "left"),
    commit("left", "base"),
    commit("right", "base"),
    commit("base")
  ],
  "parents outside the page": [
    commit("merge", "outside-main", "topic"),
    commit("other", "outside-other"),
    commit("topic", "outside-topic")
  ],
  "shallow roots": [
    commit("merge", "main", "shallow"),
    commit("main", "base"),
    commit("shallow"),
    commit("base")
  ],
  "merge into a parent another branch reached first": [
    commit("tip", "merge", "side"),
    commit("merge", "main", "base"),
    commit("side", "base"),
    commit("main", "base"),
    commit("base")
  ]
};
