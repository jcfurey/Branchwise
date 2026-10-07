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

/** The default of the `graphColours` setting, which the theme's lane colours also default to. */
export const declaredGraphColours = declaredSetting("graphColours").default as string[];

/** A colour as `contributes.colors` in package.json declares it. */
export type DeclaredColour = {
  id: string;
  description: string;
  defaults: Record<"dark" | "light" | "highContrast" | "highContrastLight", string>;
};

/** Every theme colour Branchwise contributes, in the manifest's order. */
export const declaredColours = (
  JSON.parse(readFileSync(manifestUrl, "utf8")) as { contributes: { colors: DeclaredColour[] } }
).contributes.colors;

/**
 * The colours the graph uses when the user stored none: the theme's lane colours as CSS
 * variables, each falling back to the setting's default colour for its lane.
 */
export const themeGraphColours = declaredGraphColours.map(
  (colour, index) => `var(--vscode-branchwise-graphLane${index + 1}, ${colour})`
);
