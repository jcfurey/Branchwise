import { execFileSync, spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { createGit } from "@/backend/gitClient";
import { loadCommits } from "@/backend/queries/loadCommits";
import { repositoryQuery } from "@/backend/queries/repository";
import { signatureState, signedCommits, verifySignature } from "@/backend/queries/signatures";
import type { SignatureCheck } from "@/backend/types";

import { git, gitOutput, makeRepo } from "@tests/backend/helpers";
import { onWindows } from "@tests/backend/sandbox";

/**
 * Git settings that the environment can inject into every Git process. They outrank a
 * repository's own settings, so one naming a signing program or an allowed-signers file would
 * decide the checks below.
 */
const INJECTED_CONFIG = /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+|PARAMETERS)$/;

const saved = new Map<string, string>();
beforeAll(() => {
  for (const [name, value] of Object.entries(process.env)) {
    if (INJECTED_CONFIG.test(name) && value !== undefined) {
      saved.set(name, value);
      delete process.env[name];
    }
  }
});
afterAll(() => {
  for (const [name, value] of saved) {
    process.env[name] = value;
  }
});

const folders: string[] = [];
afterEach(() => {
  for (const dir of folders.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function tempFolder() {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-sign-")));
  folders.push(dir);
  return dir;
}

function repository() {
  const repo = makeRepo();
  folders.push(repo);
  return repo;
}

/** A path as Git reads it in its configuration, with forward slashes on Windows too. */
const configPath = (file: string) => file.split(path.sep).join("/");

/** An executable shell script, which Git also runs on Windows through the shell it ships. */
function script(dir: string, name: string, body: string) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  return configPath(file);
}

/** Whatever a read could change: the work tree and index, the refs, and the object store. */
function snapshot(repo: string) {
  return [
    gitOutput(["status", "--porcelain"], repo),
    gitOutput(["for-each-ref"], repo),
    gitOutput(["count-objects", "-v"], repo)
  ];
}

const AT = "1700000000 +0000";

/**
 * A commit on HEAD whose header carries `signature`, a signature header's lines, which no
 * program ever checked. Returns its ID.
 */
function commitWithHeader(repo: string, subject: string, signature: string[], body = "") {
  const object = [
    `tree ${gitOutput(["write-tree"], repo)}`,
    `parent ${gitOutput(["rev-parse", "HEAD"], repo)}`,
    `author T <t@t.com> ${AT}`,
    `committer T <t@t.com> ${AT}`,
    ...signature,
    "",
    subject,
    ...(body === "" ? [] : ["", body]),
    ""
  ].join("\n");
  const id = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], {
    cwd: repo,
    input: object,
    stdio: "pipe"
  })
    .toString()
    .trim();
  git(["update-ref", "HEAD", id], repo);
  return id;
}

const armour = (first: string, last: string) => [
  `gpgsig ${first}`,
  " U1NIU0lHAAAAAQ==",
  ` ${last}`
];
const PGP = armour("-----BEGIN PGP SIGNATURE-----", "-----END PGP SIGNATURE-----");
const X509 = armour("-----BEGIN SIGNED MESSAGE-----", "-----END SIGNED MESSAGE-----");
const SSH = armour("-----BEGIN SSH SIGNATURE-----", "-----END SSH SIGNATURE-----");

const page = {
  branchName: "",
  maxCommits: 50,
  showRemoteBranches: true,
  hard: false,
  dateType: "Author Date" as const,
  showUncommittedChanges: true
};

/** The subjects of the graph's rows and whether each is marked as signed. */
async function marks(repo: string, showSignatures?: boolean) {
  const result = await loadCommits(createGit(repo, "git"), {
    ...page,
    ...(showSignatures === undefined ? {} : { showSignatures })
  });
  return result.commits.map((commit) => [commit.message, "signed" in commit && commit.signed]);
}

describe("the graph's signed marks", () => {
  it("mark exactly the commits whose header carries a signature, of any kind", async () => {
    const repo = repository();
    commitWithHeader(repo, "openpgp", PGP);
    commitWithHeader(repo, "x509", X509);
    commitWithHeader(repo, "ssh", SSH);
    commitWithHeader(repo, "sha256", ["gpgsig-sha256 -----BEGIN PGP SIGNATURE-----", " AA=="]);
    // Words in the message, or a signed tag merged in, do not sign the commit itself.
    commitWithHeader(
      repo,
      "message only",
      ["mergetag object 0000000000000000000000000000000000000000", " gpgsig -----BEGIN"],
      "gpgsig -----BEGIN PGP SIGNATURE-----"
    );
    const before = snapshot(repo);

    expect(await marks(repo)).toStrictEqual([
      ["message only", false],
      ["sha256", true],
      ["ssh", true],
      ["x509", true],
      ["openpgp", true],
      ["init", false]
    ]);
    expect(await marks(repo, false)).toStrictEqual([
      ["message only", false],
      ["sha256", false],
      ["ssh", false],
      ["x509", false],
      ["openpgp", false],
      ["init", false]
    ]);
    expect(snapshot(repo)).toStrictEqual(before);
  });

  it("read nothing for an empty page and skip IDs Git does not have", async () => {
    const repo = repository();
    const signed = commitWithHeader(repo, "signed", SSH);
    const client = createGit(repo, "git");
    expect(await signedCommits(client, [])).toStrictEqual(new Set());
    expect(await signedCommits(client, ["0".repeat(40), signed])).toStrictEqual(new Set([signed]));
  });
});

describe("Git's %G? letters", () => {
  it("map one to one onto the verdicts", () => {
    expect(["G", "B", "U", "X", "Y", "R", "E", "N"].map(signatureState)).toStrictEqual([
      "good",
      "bad",
      "untrusted",
      "expiredSignature",
      "expiredKey",
      "revoked",
      "unchecked",
      "unsigned"
    ]);
  });
});

const unchecked = (format: SignatureCheck["format"], reason: SignatureCheck["reason"]) => ({
  state: "unchecked",
  format,
  signer: "",
  key: "",
  fingerprint: "",
  trust: expect.any(String),
  reason
});

describe("checking a signature without a program to check it", () => {
  it("says it can't be checked when gpg or gpgsm can't be started", async () => {
    const repo = repository();
    const missing = configPath(path.join(tempFolder(), "missing"));
    git(["config", "gpg.program", missing], repo);
    git(["config", "gpg.x509.program", missing], repo);
    const openpgp = commitWithHeader(repo, "openpgp", PGP);
    const x509 = commitWithHeader(repo, "x509", X509);
    const client = createGit(repo, "git");
    const before = snapshot(repo);

    expect(await verifySignature(client, openpgp)).toStrictEqual({
      hash: openpgp,
      check: unchecked("openpgp", "noProgram")
    });
    expect((await verifySignature(client, x509)).check).toStrictEqual(
      unchecked("x509", "noProgram")
    );
    expect(snapshot(repo)).toStrictEqual(before);
  });

  it("says an unsigned commit is unsigned, by any name of it", async () => {
    const repo = repository();
    const hash = gitOutput(["rev-parse", "HEAD"], repo);
    git(["tag", "-a", "-m", "annotated", "v1"], repo);
    const tag = gitOutput(["rev-parse", "v1"], repo);
    const client = createGit(repo, "git");
    const unsigned = {
      state: "unsigned",
      format: null,
      signer: "",
      key: "",
      fingerprint: "",
      trust: "",
      reason: null
    };
    for (const name of ["HEAD", "main", tag, hash]) {
      // eslint-disable-next-line no-await-in-loop
      expect(await verifySignature(client, name), name).toStrictEqual({ hash, check: unsigned });
    }
    expect(await repositoryQuery(client, { kind: "signature", hash: "HEAD" })).toStrictEqual({
      kind: "signature",
      hash,
      check: unsigned
    });
    await expect(verifySignature(client, "no-such-revision")).rejects.toThrow();
  });
});

/**
 * A key that signs commits through ssh-keygen, or why there is none: ssh-keygen is missing, or
 * too old to sign (before OpenSSH 8.2), or Git is too old to sign with it (before 2.34).
 */
function sshSigner(): { dir: string; key: string; publicKey: string } | string {
  const dir = fs.realpathSync.native(fs.mkdtempSync(path.join(os.tmpdir(), "ngg-ssh-key-")));
  const key = path.join(dir, "signer");
  const fail = (why: string) => {
    fs.rmSync(dir, { recursive: true, force: true });
    return why;
  };
  const made = spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-C", "", "-f", key], {
    stdio: "pipe"
  });
  if (made.error !== undefined || made.status !== 0) {
    return fail(`ssh-keygen cannot make a key: ${made.error?.message ?? made.stderr.toString()}`);
  }
  const probe = makeRepo();
  try {
    git(["config", "gpg.format", "ssh"], probe);
    git(["config", "user.signingkey", configPath(key)], probe);
    git(["commit", "-q", "--allow-empty", "-S", "-m", "probe"], probe);
  } catch (error) {
    return fail(`Git or ssh-keygen cannot sign: ${String(error)}`);
  } finally {
    fs.rmSync(probe, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
  return { dir, key, publicKey: fs.readFileSync(`${key}.pub`, "utf8").trim() };
}

const signer = sshSigner();
const noSigning = typeof signer === "string" ? signer : null;
if (noSigning !== null) {
  // eslint-disable-next-line no-console
  console.warn(`Skipping the SSH signature checks: ${noSigning}`);
}
afterAll(() => {
  if (typeof signer !== "string") {
    fs.rmSync(signer.dir, { recursive: true, force: true });
  }
});

describe.skipIf(noSigning !== null)("checking SSH signatures", () => {
  const { key, publicKey } = signer as Exclude<typeof signer, string>;
  const PRINCIPAL = "signer@example.com";

  /**
   * A repository that signs with the test key, and whose allowed signers name that key, name
   * nobody, or are not configured at all.
   */
  function sshRepository(allowed: "signer" | "nobody" | "unset") {
    const repo = repository();
    git(["config", "gpg.format", "ssh"], repo);
    git(["config", "user.signingkey", configPath(key)], repo);
    const allowedSigners = path.join(repo, ".git", "allowed_signers");
    if (allowed !== "unset") {
      fs.writeFileSync(allowedSigners, allowed === "signer" ? `${PRINCIPAL} ${publicKey}\n` : "");
      git(["config", "gpg.ssh.allowedSignersFile", configPath(allowedSigners)], repo);
    }
    return { repo, allowedSigners };
  }

  function commit(repo: string, subject: string, sign: boolean) {
    fs.writeFileSync(path.join(repo, subject), subject);
    git(["add", "--", subject], repo);
    git(["commit", "-q", sign ? "-S" : "--no-gpg-sign", "-m", subject], repo);
    return gitOutput(["rev-parse", "HEAD"], repo);
  }

  const good = {
    state: "good",
    format: "ssh",
    signer: PRINCIPAL,
    key: expect.stringMatching(/^SHA256:/),
    fingerprint: expect.stringMatching(/^SHA256:/),
    trust: expect.any(String),
    reason: null
  };

  it("says a signature is good when its signer is allowed, and changes nothing", async () => {
    const { repo } = sshRepository("signer");
    const hash = commit(repo, "signed", true);
    const before = snapshot(repo);
    const answer = await repositoryQuery(createGit(repo, "git"), { kind: "signature", hash });
    expect(answer).toStrictEqual({ kind: "signature", hash, check: good });
    expect(snapshot(repo)).toStrictEqual(before);
  });

  it("says a signature is from an untrusted key when no allowed signer matches", async () => {
    const { repo } = sshRepository("nobody");
    const hash = commit(repo, "signed", true);
    expect((await verifySignature(createGit(repo, "git"), hash)).check).toStrictEqual({
      ...good,
      state: "untrusted",
      signer: ""
    });
  });

  it("says a signature can't be checked without an allowed-signers file", async () => {
    const { repo } = sshRepository("unset");
    const hash = commit(repo, "signed", true);
    expect((await verifySignature(createGit(repo, "git"), hash)).check).toStrictEqual(
      unchecked("ssh", "allowedSigners")
    );
  });

  it("says a signature is bad once the commit is changed, also through a replacement", async () => {
    const { repo } = sshRepository("signer");
    const original = commit(repo, "signed", true);
    const raw = gitOutput(["cat-file", "commit", original], repo);
    const tampered = execFileSync("git", ["hash-object", "-t", "commit", "-w", "--stdin"], {
      cwd: repo,
      input: raw.replace(/\n\nsigned$/, "\n\ntampered") + "\n",
      stdio: "pipe"
    })
      .toString()
      .trim();
    const bad = { ...good, state: "bad", signer: "", key: "", fingerprint: "" };
    const client = createGit(repo, "git");
    expect((await verifySignature(client, tampered)).check).toStrictEqual(bad);

    git(["replace", original, tampered], repo);
    expect((await verifySignature(client, original)).check).toStrictEqual(bad);
    // The graph shows the replacement, whose signature header is still there.
    expect(await marks(repo)).toStrictEqual([
      ["tampered", true],
      ["init", false]
    ]);
  });

  it("marks the signed commits of a mixed page", async () => {
    const { repo } = sshRepository("signer");
    commit(repo, "first signed", true);
    commit(repo, "unsigned", false);
    commit(repo, "second signed", true);
    expect(await marks(repo)).toStrictEqual([
      ["second signed", true],
      ["unsigned", false],
      ["first signed", true],
      ["init", false]
    ]);
  });

  // The tests below put shell scripts in the place of ssh-keygen, which Git on Windows does not run.
  it.skipIf(onWindows)("starts no checking program for an unsigned commit", async () => {
    const { repo } = sshRepository("signer");
    const signed = commit(repo, "signed", true);
    const plain = commit(repo, "unsigned", false);
    const started = path.join(tempFolder(), "started");
    git(
      ["config", "gpg.ssh.program", script(tempFolder(), "ssh-keygen", `touch '${started}'`)],
      repo
    );
    const client = createGit(repo, "git");
    expect((await verifySignature(client, plain)).check.state).toBe("unsigned");
    expect(fs.existsSync(started)).toBe(false);
    await verifySignature(client, signed);
    expect(fs.existsSync(started)).toBe(true);
  });

  it("says ssh-keygen can't be started rather than calling the signature bad", async () => {
    const { repo } = sshRepository("signer");
    const hash = commit(repo, "signed", true);
    git(["config", "gpg.ssh.program", configPath(path.join(tempFolder(), "missing"))], repo);
    expect((await verifySignature(createGit(repo, "git"), hash)).check).toStrictEqual(
      unchecked("ssh", "noProgram")
    );
  });

  it.skipIf(onWindows)("stops a check that hangs, with the program it started", async () => {
    const { repo } = sshRepository("signer");
    const hash = commit(repo, "signed", true);
    const pidFile = path.join(tempFolder(), "pid");
    git(
      [
        "config",
        "gpg.ssh.program",
        script(tempFolder(), "ssh-keygen", `echo $$ > '${pidFile}'\nexec sleep 30`)
      ],
      repo
    );
    const started = Date.now();
    const answer = await verifySignature(createGit(repo, "git"), hash, 1500);
    expect(answer.check).toStrictEqual({ ...unchecked("ssh", "timeout"), trust: "" });
    expect(Date.now() - started).toBeLessThan(10_000);
    const pid = Number(fs.readFileSync(pidFile, "utf8"));
    await vi.waitFor(() => expect(() => process.kill(pid, 0)).toThrow(), { timeout: 5000 });
  });

  it.skipIf(onWindows)("stops a check when the read is cancelled", async () => {
    const { repo } = sshRepository("signer");
    const hash = commit(repo, "signed", true);
    git(["config", "gpg.ssh.program", script(tempFolder(), "ssh-keygen", "exec sleep 30")], repo);
    const controller = new AbortController();
    const check = verifySignature(createGit(repo, "git", controller.signal), hash);
    setTimeout(() => controller.abort(), 300);
    const started = Date.now();
    await expect(check).rejects.toThrow();
    expect(Date.now() - started).toBeLessThan(10_000);
  });

  it("remembers verdicts, except those the user's setup decides", async () => {
    const { repo, allowedSigners } = sshRepository("nobody");
    const hash = commit(repo, "signed", true);
    const client = createGit(repo, "git");
    expect((await verifySignature(client, hash)).check.state).toBe("untrusted");

    // Allowing the signer shows at the next check.
    fs.writeFileSync(allowedSigners, `${PRINCIPAL} ${publicKey}\n`);
    expect((await verifySignature(client, hash)).check).toStrictEqual(good);

    // A good verdict is kept: a program that cannot start is never asked again.
    git(["config", "gpg.ssh.program", configPath(path.join(tempFolder(), "missing"))], repo);
    expect((await verifySignature(createGit(repo, "git"), hash)).check).toStrictEqual(good);
    // Verdicts belong to their repository.
    const clone = repository();
    git(["fetch", "-q", repo, "main"], clone);
    expect((await verifySignature(createGit(clone, "git"), hash)).check).toStrictEqual(
      unchecked("ssh", "allowedSigners")
    );
  });
});
