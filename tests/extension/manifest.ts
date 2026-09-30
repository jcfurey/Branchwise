import { readFileSync } from "node:fs";

/** A setting as `contributes.configuration.properties` in package.json declares it. */
type DeclaredSetting = { default?: unknown; items?: { pattern?: string } };

const manifestUrl = new URL("../../package.json", import.meta.url);
const declared = (
  JSON.parse(readFileSync(manifestUrl, "utf8")) as {
    contributes: { configuration: { properties: Record<string, DeclaredSetting> } };
  }
).contributes.configuration.properties;

/** The declaration of `branchwise.<key>`; throws for a setting the manifest lacks. */
export function declaredSetting(key: string): DeclaredSetting {
  const setting = declared[`branchwise.${key}`];
  if (setting === undefined) {
    throw new Error(`package.json declares no branchwise.${key}`);
  }
  return setting;
}

/** The colours the graph uses when the user stored none. */
export const declaredGraphColours = declaredSetting("graphColours").default as string[];
