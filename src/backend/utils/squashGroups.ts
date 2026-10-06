import type { RebaseEntry } from "@/backend/types";

/**
 * The commits of a plan that end up as one commit with a message to edit: a Pick or Reword
 * followed by Squash and Fixup entries, at least one of them Squash. Drop entries leave the todo
 * list, so a commit squashes into the retained commit before it even with a Drop in between. A
 * run of Fixups alone keeps the first message, so Git asks for none and neither does the editor.
 */
export function squashGroups(entries: RebaseEntry[]) {
  const groups: RebaseEntry[][] = [];
  let current: RebaseEntry[] | undefined;
  for (const entry of entries) {
    if (entry.action === "pick" || entry.action === "reword") {
      current = [entry];
      groups.push(current);
    } else if (entry.action !== "drop") {
      current?.push(entry);
    }
  }
  return groups.filter((group) => group.some((entry) => entry.action === "squash"));
}

/**
 * The message Git offers for `group` without its comment lines: the first commit's message (as
 * reworded, for Reword) and each Squash commit's, with a blank line between them. Fixup
 * messages are left out, as Git leaves them.
 */
export function combinedMessage(group: RebaseEntry[]) {
  return group
    .filter((entry, index) => index === 0 || entry.action === "squash")
    .map((entry) => entry.message)
    .join("\n\n");
}
