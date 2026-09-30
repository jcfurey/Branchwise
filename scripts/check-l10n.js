/**
 * Checks the hand-edited translations against the English they translate.
 *
 * Two kinds of file are checked, each against its own English file:
 *
 * - `l10n/bundle.l10n.<locale>.json`, the page and extension strings, against
 *   `l10n/bundle.l10n.json`, which `pnpm run l10n:export` generates from the source;
 * - `package.nls.<locale>.json`, the texts of the extension manifest (settings, commands,
 *   walkthrough), against `package.nls.json`.
 *
 * A translation file may hold no key its English file lacks, must hold a non-empty translation
 * of every key it has, and must use exactly the placeholders (`{0}`, `{1}`, …) of each English
 * string, in any order and as often as it likes. Every value must be a string.
 *
 * `package.nls.json` is also checked against `package.json`, the manifest whose `%key%` strings
 * it resolves: every key the manifest refers to must be in it, and it may hold no key the
 * manifest does not refer to. Its problems are reported with the English file's own.
 *
 * A file that passes prints one line to standard output; a file that fails prints its name and
 * one line per problem to standard error, and the script exits with 1 once every file is checked.
 * Unreadable files and invalid JSON are not reported this way: they stop the script with Node's
 * own error.
 */
const fs = require("node:fs");
const path = require("node:path");

/**
 * Each kind of translation file: where it lives, its English file, its own names, and the file
 * whose `%key%` strings the English file resolves, if any.
 */
const GROUPS = [
  { dir: "l10n", english: "bundle.l10n.json", locale: /^bundle\.l10n\..+\.json$/s },
  {
    dir: ".",
    english: "package.nls.json",
    locale: /^package\.nls\..+\.json$/s,
    manifest: "package.json"
  }
];

/** A placeholder is a number in braces; any other brace is ordinary text. */
const PLACEHOLDER = /\{[0-9]+\}/g;

/** The distinct placeholders of `text`, in the order they first appear. */
function placeholders(text) {
  return [...new Set(text.match(PLACEHOLDER) ?? [])];
}

function readObject(file) {
  const data = JSON.parse(fs.readFileSync(file, "utf8"));
  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new Error(`${file} does not hold a JSON object`);
  }
  return data;
}

/** Problems of an English file on its own: every value must be a string. */
function englishProblems(english) {
  return Object.keys(english)
    .filter((key) => typeof english[key] !== "string")
    .map((key) => `not a string: "${key}"`);
}

/**
 * The keys that the manifest's `%key%` strings refer to, each listed once in the order it first
 * appears. As in VS Code, a reference is a whole string value of at least two characters that
 * starts and ends with `%`, anywhere in the manifest; the key is what lies between them.
 */
function manifestKeys(manifest) {
  const keys = new Set();
  const visit = (value) => {
    if (typeof value === "string") {
      if (value.length > 1 && value.startsWith("%") && value.endsWith("%")) {
        keys.add(value.slice(1, -1));
      }
    } else if (value !== null && typeof value === "object") {
      for (const item of Object.values(value)) {
        visit(item);
      }
    }
  };
  visit(manifest);
  return [...keys];
}

/**
 * Problems of an English file against the manifest that refers to it, both parsed, in report
 * order: keys the manifest refers to that the English lacks (in the manifest's order), then keys
 * the manifest does not refer to (in English order).
 */
function manifestProblems(english, manifest) {
  const referenced = manifestKeys(manifest);
  return [
    ...referenced
      .filter((key) => !Object.hasOwn(english, key))
      .map((key) => `missing (used in package.json): "${key}"`),
    ...Object.keys(english)
      .filter((key) => !referenced.includes(key))
      .map((key) => `unused (not in package.json): "${key}"`)
  ];
}

/**
 * Whether `translated` holds a translation of `key`: an own property that is not empty. Own
 * properties only, so a name that every object inherits, such as `toString`, is no exception.
 */
function isTranslated(translated, key) {
  return Object.hasOwn(translated, key) && translated[key] !== "";
}

/**
 * Problems of one translation file against its English file, both parsed, in report order:
 * keys the English lacks (in the file's order), then keys without a translation, then each
 * translated key whose value is not a string or whose placeholders differ (both in English
 * order).
 */
function translationProblems(english, translated) {
  const problems = [];

  for (const key of Object.keys(translated)) {
    if (!Object.hasOwn(english, key)) {
      problems.push(`stale (not in English): "${key}"`);
    }
  }

  for (const key of Object.keys(english)) {
    if (!isTranslated(translated, key)) {
      problems.push(`missing translation: "${key}"`);
    }
  }

  for (const key of Object.keys(english).filter((name) => isTranslated(translated, name))) {
    const value = translated[key];
    if (typeof value !== "string") {
      problems.push(`not a string: "${key}"`);
      continue;
    }
    // A non-string English value is reported with the English file.
    if (typeof english[key] !== "string") {
      continue;
    }
    const expected = placeholders(english[key]);
    const found = placeholders(value);
    for (const dropped of expected.filter((token) => !found.includes(token))) {
      problems.push(`placeholder ${dropped} dropped: "${key}"`);
    }
    for (const added of found.filter((token) => !expected.includes(token))) {
      problems.push(`placeholder ${added} added: "${key}"`);
    }
  }

  return problems;
}

/** The translation files of `group` under `root`, sorted by name. */
function translationFiles(root, group) {
  return fs
    .readdirSync(path.join(root, group.dir))
    .filter((name) => group.locale.test(name))
    .toSorted();
}

/**
 * Check every translation file under `root` (the repository root), and each English file against
 * the manifest that refers to it, writing report lines with `out` and `err`, one call per line.
 * An English file is reported only when it fails. Each file's lines are written as soon as it is
 * checked.
 * Returns the exit code: 1 if any file failed, else 0.
 */
function checkTranslations(root, out, err) {
  let failed = false;
  const fail = (name, problems) => {
    failed = true;
    err(`✗ ${name}`);
    for (const problem of problems) {
      err(`  ${problem}`);
    }
  };

  for (const group of GROUPS) {
    const names = translationFiles(root, group);
    const english = readObject(path.join(root, group.dir, group.english));
    const englishFaults = englishProblems(english);
    if (group.manifest !== undefined) {
      englishFaults.push(
        ...manifestProblems(english, readObject(path.join(root, group.dir, group.manifest)))
      );
    }
    if (englishFaults.length > 0) {
      fail(group.english, englishFaults);
    }

    const total = Object.keys(english).length;
    for (const name of names) {
      const translated = readObject(path.join(root, group.dir, name));
      const problems = translationProblems(english, translated);
      if (problems.length === 0) {
        out(`✓ ${name} (${Object.keys(translated).length}/${total} translated)`);
      } else {
        fail(name, problems);
      }
    }
  }

  if (failed) {
    err("");
    err("l10n check failed.");
  }
  return failed ? 1 : 0;
}

module.exports = {
  checkTranslations,
  englishProblems,
  manifestKeys,
  manifestProblems,
  placeholders,
  translationProblems
};

if (require.main === module) {
  process.exitCode = checkTranslations(path.join(__dirname, ".."), console.log, console.error);
}
