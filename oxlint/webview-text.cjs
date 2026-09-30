/**
 * Lint rules for the webview. `no-hard-coded-text` reports text that people read or hear and that
 * does not come from `window.l10n`: JSX text, string children such as `{"Retry"}`, and string
 * values of attributes such as `aria-label` and `title`. Text without letters, such as "·" or "→",
 * needs no translation and is allowed.
 */

/** Attributes that people read or hear. */
const READ_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "aria-roledescription",
  "aria-valuetext",
  "alt",
  "placeholder",
  "title"
]);
/** A letter in any script. */
const WORDS = /\p{L}/u;
/** Character references such as `&lt;`, whose names are not words. */
const ENTITIES = /&(?:[a-z][a-z0-9]*|#\d+|#x[0-9a-f]+);/gi;

/** The text of a string literal or a template literal without substitutions, else null. */
function literalText(node) {
  if (node?.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (node?.type === "TemplateLiteral" && node.expressions.length === 0) {
    return node.quasis.map((quasi) => quasi.value.cooked ?? "").join("");
  }
  return null;
}

const noHardCodedText = {
  meta: {
    type: "problem",
    docs: { description: "Read user-facing webview text from window.l10n" }
  },
  create(context) {
    const report = (node, text) => {
      if (text !== null && WORDS.test(text.replace(ENTITIES, ""))) {
        context.report({
          node,
          message: `Hard-coded text "${text.trim()}". Add it to the webview strings and read it from window.l10n.`
        });
      }
    };
    return {
      JSXText(node) {
        report(node, node.value);
      },
      JSXExpressionContainer(node) {
        if (node.parent?.type !== "JSXAttribute") {
          report(node, literalText(node.expression));
        }
      },
      JSXAttribute(node) {
        const name = node.name.type === "JSXIdentifier" ? node.name.name : null;
        if (!READ_ATTRIBUTES.has(name)) {
          return;
        }
        const value =
          node.value?.type === "JSXExpressionContainer" ? node.value.expression : node.value;
        report(node, literalText(value));
      }
    };
  }
};

module.exports = {
  meta: { name: "webview" },
  rules: { "no-hard-coded-text": noHardCodedText }
};
