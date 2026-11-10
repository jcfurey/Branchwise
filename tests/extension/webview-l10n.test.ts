import { expect, it, vi } from "vitest";

import { getHistoryLocalizedStrings } from "@/old-extension/l10n/historyL10n";
import { getRepositoryLocalizedStrings } from "@/old-extension/l10n/repositoryL10n";
import { getWebviewLocalizedStrings } from "@/old-extension/l10n/webviewL10n";
import { getWorkflowLocalizedStrings } from "@/old-extension/l10n/workflowL10n";

vi.mock("vscode", () => ({ l10n: { t: (message: string) => message } }));

// The page's strings are four tables spread into one object, where a name used twice silently
// keeps only its last text: the conflict list was once headed "{0} conflicted files" that way.
it("gives every string of the page a name no other table uses", () => {
  const tables = {
    repository: getRepositoryLocalizedStrings(),
    history: getHistoryLocalizedStrings(),
    workflow: getWorkflowLocalizedStrings()
  };
  const owners = new Map<string, string>();
  const shared: string[] = [];
  for (const [table, strings] of Object.entries(tables)) {
    for (const name of Object.keys(strings)) {
      const owner = owners.get(name);
      if (owner !== undefined) {
        shared.push(`${name} (${owner} and ${table})`);
      }
      owners.set(name, table);
    }
  }
  expect(shared).toStrictEqual([]);

  // The entries of the last table, written out in `getWebviewLocalizedStrings`, replace nothing.
  const all: Record<string, string> = getWebviewLocalizedStrings();
  const replaced = Object.values(tables).flatMap((strings) =>
    Object.entries(strings)
      .filter(([name, text]) => all[name] !== text)
      .map(([name]) => name)
  );
  expect(replaced).toStrictEqual([]);
});

it("keeps a heading for the list of conflicted files, apart from the count of them", () => {
  const strings = getWebviewLocalizedStrings();
  expect(strings.conflictedFiles).toBe("Conflicted Files");
  expect(strings.conflictedFileCount).toBe("{0} conflicted files");
});
