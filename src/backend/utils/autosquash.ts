import type { RebasePlan } from "@/backend/types";

/** Arrange the same explicit plan the editor displays; ambiguous targets stay picked. */
export function autosquashPlan(plan: RebasePlan, originalEntries = plan.entries): RebasePlan {
  const originalMessages = new Map(
    originalEntries.map((entry) => [entry.hash, entry.message.split("\n")[0]!])
  );
  const entries: RebasePlan["entries"] = [];
  const targets = new Map<string, string>();
  for (const original of plan.entries) {
    const entry = { ...original };
    const match = /^(fixup|squash)! (.+)$/.exec(entry.message.split("\n")[0]!);
    if (match && entry.action === "pick") {
      const title = match[2]!;
      let candidates = entries.filter(
        (item) => item.hash.startsWith(title) || originalMessages.get(item.hash) === title
      );
      if (candidates.length === 0) {
        candidates = entries.filter((item) => originalMessages.get(item.hash)?.startsWith(title));
      }
      if (candidates.length === 1) {
        const target = targets.get(candidates[0]!.hash) ?? candidates[0]!.hash;
        entry.action = match[1] === "fixup" ? "fixup" : "squash";
        targets.set(entry.hash, target);
        let index = entries.findIndex((item) => item.hash === target) + 1;
        while (index < entries.length && targets.get(entries[index]!.hash) === target) {
          index++;
        }
        entries.splice(index, 0, entry);
        continue;
      }
    }
    entries.push(entry);
  }
  return { ...plan, entries };
}
