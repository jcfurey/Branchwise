import type { SimpleGit } from "simple-git";

import { gitFolderOf } from "@/backend/gitClient";
import type {
  SignatureCheck,
  SignatureFormat,
  SignatureState,
  UncheckedReason
} from "@/backend/types";
import { readBytesWithInput, readFolder, readGitWithTimeout } from "@/backend/utils/runGit";
import { resolveCommit } from "@/backend/utils/validation";

/** A full SHA-1 or SHA-256 object ID. */
const OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * A signature header of a commit: `gpgsig` signs the commit in the repository's own hash, and
 * `gpgsig-sha256` in SHA-256 for a repository that keeps both. Its value continues on the lines
 * that follow, each indented by a space, so no continuation line can match.
 */
const SIGNATURE_HEADER = /^gpgsig(?:-sha256)? (.*)$/m;

/** The first line of each kind of signature, as Git tells them apart. */
const FORMATS: ReadonlyArray<[prefix: string, format: SignatureFormat]> = [
  ["-----BEGIN PGP SIGNATURE-----", "openpgp"],
  ["-----BEGIN PGP MESSAGE-----", "openpgp"],
  ["-----BEGIN SIGNED MESSAGE-----", "x509"],
  ["-----BEGIN SSH SIGNATURE-----", "ssh"]
];

/**
 * How long a check may take, in milliseconds. A key server lookup or a slow agent ends well
 * within it; a program waiting for a passphrase nobody can type never does.
 */
const SIGNATURE_TIMEOUT = 10_000;

/** How many verdicts the cache keeps before it forgets the oldest. */
const CACHE_SIZE = 2000;

/**
 * Verdicts by repository folder and commit, for as long as the extension runs. A commit's
 * signature never changes, so only verdicts that the user's own setup decides are left out:
 * a signer missing from the allowed signers, a missing key or program, a check that timed out.
 * Once the user fixes that, the next look at the commit checks again.
 */
const verdicts = new Map<string, SignatureCheck>();

const CACHED = new Set<SignatureState>([
  "good",
  "bad",
  "expiredSignature",
  "expiredKey",
  "revoked",
  "unsigned"
]);

/** The header of a raw commit object: everything before the first empty line. */
function commitHeader(object: Buffer) {
  const end = object.indexOf("\n\n");
  // The header is ASCII apart from names, and only ASCII is looked for in it.
  return object.toString("latin1", 0, end < 0 ? object.length : end);
}

/** The kind of signature a commit header carries, `"openpgp"` if Git would treat it so, or `null`. */
function signatureFormat(header: string): SignatureFormat | null {
  const first = SIGNATURE_HEADER.exec(header)?.[1];
  if (first === undefined) {
    return null;
  }
  // A signature of a kind Git does not know still signs the commit. It counts as OpenPGP, Git's
  // default format; Git refuses to check it, and the check reports Git's message.
  return FORMATS.find(([prefix]) => first.startsWith(prefix))?.[1] ?? "openpgp";
}

/**
 * The raw objects of `cat-file --batch`, by object ID. Each comes after a line naming it, its
 * type and its size in bytes, and is followed by a newline. A name Git cannot find gets a line
 * of its own, `<name> missing`, and no object.
 */
function parseBatch(output: Buffer) {
  const objects = new Map<string, { type: string; content: Buffer }>();
  let at = 0;
  while (at < output.length) {
    const lineEnd = output.indexOf(10, at);
    if (lineEnd < 0) {
      break;
    }
    const [id = "", type = "", size] = output.toString("latin1", at, lineEnd).split(" ");
    at = lineEnd + 1;
    if (size === undefined) {
      continue;
    }
    const length = Number(size);
    objects.set(id, { type, content: output.subarray(at, at + length) });
    at += length + 1;
  }
  return objects;
}

/** A folder of the repository to run in, without starting Git to find one when possible. */
async function folderOf(git: SimpleGit) {
  return gitFolderOf(git) ?? (await readFolder(git));
}

async function readCommits(git: SimpleGit, folder: string, hashes: string[]) {
  const input = hashes.join("\n") + "\n";
  return parseBatch(
    await readBytesWithInput(git, ["cat-file", "--batch", "--buffer"], input, folder)
  );
}

/**
 * Which of `hashes` carry a signature. This only reads the commit objects, in one Git process
 * for the whole page, and starts no signing program, so the graph can afford it on every load;
 * whether a signature is valid is left to `verifySignature`.
 */
export async function signedCommits(git: SimpleGit, hashes: string[]): Promise<Set<string>> {
  const signed = new Set<string>();
  if (hashes.length === 0) {
    return signed;
  }
  for (const [id, { type, content }] of await readCommits(git, await folderOf(git), hashes)) {
    if (type === "commit" && signatureFormat(commitHeader(content)) !== null) {
      signed.add(id);
    }
  }
  return signed;
}

/**
 * The state for each letter of Git's `%G?` placeholder:
 *
 * - `G`: a good, valid signature → `good`
 * - `B`: a bad signature, which does not match the commit → `bad`
 * - `U`: a good signature with unknown validity, as from a key nobody certified, or an SSH key
 *   with no entry in the allowed signers → `untrusted`
 * - `X`: a good signature that has expired → `expiredSignature`
 * - `Y`: a good signature made by a key that has expired → `expiredKey`
 * - `R`: a good signature made by a key that was revoked → `revoked`
 * - `E`: a signature that cannot be checked, as when the key is missing → `unchecked`
 * - `N`: no signature → `unsigned`. Git also prints it for a signature it got no verdict on,
 *   which `verifySignature` tells apart from the commit header.
 */
export function signatureState(letter: string): SignatureState {
  switch (letter) {
    case "G":
      return "good";
    case "B":
      return "bad";
    case "U":
      return "untrusted";
    case "X":
      return "expiredSignature";
    case "Y":
      return "expiredKey";
    case "R":
      return "revoked";
    case "E":
      return "unchecked";
    default:
      return "unsigned";
  }
}

/** What Git prints when it cannot start a program: `cannot exec`, or `cannot spawn` on Windows. */
const NO_PROGRAM = /\bcannot (?:exec|spawn|run)\b/;

/**
 * The verdict for a signed commit from `%G?` and the lines after it, and what Git said on
 * standard error. Git reports a check whose program failed to start as `B` or `N`, as if the
 * signature were bad or missing, so its message decides those first.
 */
function judge(format: SignatureFormat, fields: string[], stderr: string): SignatureCheck {
  const [letter = "", signer = "", key = "", fingerprint = "", trust = ""] = fields;
  const found = { format, signer, key, fingerprint, trust };
  const unchecked = (reason: UncheckedReason) => ({
    ...found,
    state: "unchecked" as const,
    reason
  });
  const state = signatureState(letter);
  if (
    (state === "bad" || state === "unsigned" || state === "unchecked") &&
    NO_PROGRAM.test(stderr)
  ) {
    return unchecked("noProgram");
  }
  if (state === "unchecked") {
    return unchecked("missingKey");
  }
  if (state === "unsigned") {
    return unchecked(stderr.includes("allowedSignersFile") ? "allowedSigners" : "unreadable");
  }
  return { ...found, state, reason: null };
}

const UNSIGNED: SignatureCheck = {
  state: "unsigned",
  format: null,
  signer: "",
  key: "",
  fingerprint: "",
  trust: "",
  reason: null
};

/**
 * Check the signature of the commit `revision` names, with the program and keys the user's Git
 * configuration chooses. An unsigned commit starts no program. A check that has not finished
 * after `timeout` milliseconds is stopped and reported as unchecked; nothing on disk changes.
 */
export async function verifySignature(
  git: SimpleGit,
  revision: string,
  timeout = SIGNATURE_TIMEOUT
): Promise<{ hash: string; check: SignatureCheck }> {
  const [folder, named] = await Promise.all([
    folderOf(git),
    OBJECT_ID.test(revision) ? revision : resolveCommit(git, revision)
  ]);
  let hash = named;
  const known = verdicts.get(`${folder}\0${hash}`);
  if (known !== undefined) {
    return { hash, check: known };
  }
  let object = (await readCommits(git, folder, [hash])).get(hash);
  if (object?.type !== "commit") {
    // A tag's ID is peeled to its commit; for anything else, Git names the problem.
    hash = await resolveCommit(git, hash);
    object = (await readCommits(git, folder, [hash])).get(hash);
  }
  const format = object === undefined ? null : signatureFormat(commitHeader(object.content));
  let check: SignatureCheck;
  if (format === null) {
    check = UNSIGNED;
  } else {
    const output = await readGitWithTimeout(
      git,
      [
        "log",
        "-1",
        "--no-walk",
        "--format=%G?%x00%GS%x00%GK%x00%GF%x00%GT",
        "--end-of-options",
        hash,
        "--"
      ],
      folder,
      timeout
    );
    check =
      output === null
        ? { ...UNSIGNED, format, state: "unchecked", reason: "timeout" }
        : judge(format, output.stdout.replace(/\n$/, "").split("\0"), output.stderr);
  }
  if (CACHED.has(check.state)) {
    if (verdicts.size >= CACHE_SIZE) {
      verdicts.delete(verdicts.keys().next().value!);
    }
    verdicts.set(`${folder}\0${hash}`, check);
  }
  return { hash, check };
}
