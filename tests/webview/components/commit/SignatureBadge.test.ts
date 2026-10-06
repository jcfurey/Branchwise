// @vitest-environment jsdom
import { h, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { GitCommitNode, QueryRequest, SignatureCheck } from "@/backend/types";
import { CommitRow } from "@/webview/components/commit/CommitRow";
import { shortFingerprint, SignatureLine } from "@/webview/components/commit/SignatureBadge";
import { handleRepositoryQuery } from "@/webview/lib/repository-actions";
import { selectedRepo } from "@/webview/lib/stores";

import { speak } from "@tests/webview/components/commit/commit-view-fixtures";
import { vscodeApi } from "@tests/webview/setup";
import { setupWebviewTest } from "@tests/webview/test-utils";

const ENGLISH = {
  detailSignature: "Signature: {0}",
  signedCommit: "Signed — open the details to verify",
  signatureChecking: "Checking the signature…",
  signatureGoodBy: "Good signature by {0}",
  signatureGood: "Good signature",
  signatureUntrusted: "Good signature from a key that is not trusted",
  signatureBad: "Bad signature",
  signatureExpired: "Expired signature",
  signatureExpiredKey: "Signed with an expired key",
  signatureRevoked: "Signed with a revoked key",
  signatureUnchecked: "Signature can't be checked",
  signatureUnsigned: "Unsigned",
  signatureSigner: "Signer: {0}",
  signatureKey: "Key {0}",
  signatureTrust: "Trust: {0}",
  trustNever: "never",
  trustMarginal: "marginal",
  trustFully: "full",
  trustUltimate: "ultimate",
  signatureMissingKey: "The key that made it is not available here.",
  signatureNoProgram: "Git could not start {0} to check it.",
  signatureAllowedSigners: "Set gpg.ssh.allowedSignersFile to check SSH signatures.",
  signatureTimeout: "The check took too long and was stopped.",
  signatureUnreadable: "Git could not read the signature."
};

const HASH = "5".repeat(40);
const FINGERPRINT = "0123456789ABCDEF0123456789ABCDEF01234567";
const SSH_KEY = "SHA256:a68IzAJXzqU4JqxhDkD97PdY7RQ1w/kLumRXugUb6/Y";

const UNSIGNED: SignatureCheck = {
  state: "unsigned",
  format: null,
  signer: "",
  key: "",
  fingerprint: "",
  trust: "",
  reason: null
};

let host: HTMLDivElement;

beforeAll(() => setupWebviewTest());
beforeEach(() => {
  speak(ENGLISH);
  selectedRepo.value = "/repo";
  vscodeApi.postMessage.mockClear();
  host = document.createElement("div");
  document.body.append(host);
});
afterEach(() => {
  act(() => render(null, host));
  host.remove();
});

/** The page's signature reads, in the order it posted them. */
const reads = () =>
  vscodeApi.postMessage.mock.calls
    .map(([message]) => message as QueryRequest)
    .filter((message) => message.command === "repositoryQuery");

/** Answer the latest read with `check`, or fail it with `status`. */
function answer(check: SignatureCheck | null, status: string | null = null) {
  const read = reads().at(-1)!;
  act(() =>
    handleRepositoryQuery({
      repo: read.repo,
      requestId: read.requestId,
      data: check === null ? null : { kind: "signature", hash: HASH, check },
      status
    })
  );
}

/** Whitespace as one space, since the line is made of separate pieces. */
const lineText = () => host.textContent?.replaceAll(/\s+/g, " ").trim();
const verdict = () => host.querySelector<HTMLElement>("[data-signature]")!;
/** The muted facts after the verdict, in order. */
const facts = () => [...host.querySelectorAll("span.text-muted")].map((span) => span.textContent);

describe("the signature line of the details", () => {
  it("asks for the check once open, says it is checking, and cancels it when closed", () => {
    act(() => render(h(SignatureLine, { hash: HASH }), host));
    expect(reads()).toEqual([
      {
        command: "repositoryQuery",
        repo: "/repo",
        requestId: expect.any(String),
        query: { kind: "signature", hash: HASH }
      }
    ]);
    expect(lineText()).toBe("Signature: Checking the signature…");
    expect(verdict().dataset.signature).toBe("checking");

    const { requestId } = reads()[0]!;
    act(() => render(null, host));
    expect(vscodeApi.postMessage).toHaveBeenLastCalledWith({
      command: "cancelRepositoryQuery",
      repo: "/repo",
      requestId
    });
  });

  const cases: Array<{
    name: string;
    check: SignatureCheck;
    text: string;
    colour: string;
    mark: string;
    facts: string[];
  }> = [
    {
      name: "a good OpenPGP signature, with its signer, key and trust",
      check: {
        state: "good",
        format: "openpgp",
        signer: "Ann Signer <ann@example.org>",
        key: FINGERPRINT.slice(-16),
        fingerprint: FINGERPRINT,
        trust: "ultimate",
        reason: null
      },
      text: "Good signature by Ann Signer <ann@example.org>",
      colour: "text-signature-good",
      mark: "check",
      facts: ["Key 89ABCDEF01234567", "Trust: ultimate"]
    },
    {
      name: "a good SSH signature",
      check: {
        state: "good",
        format: "ssh",
        signer: "ann@example.org",
        key: SSH_KEY,
        fingerprint: SSH_KEY,
        trust: "fully",
        reason: null
      },
      text: "Good signature by ann@example.org",
      colour: "text-signature-good",
      mark: "check",
      facts: ["Key SHA256:a68IzAJXzqU4…", "Trust: full"]
    },
    {
      name: "a good signature from a key nobody vouched for",
      check: {
        state: "untrusted",
        format: "ssh",
        signer: "",
        key: SSH_KEY,
        fingerprint: SSH_KEY,
        trust: "undefined",
        reason: null
      },
      text: "Good signature from a key that is not trusted",
      colour: "text-signature-unknown",
      mark: "exclamation",
      facts: ["Key SHA256:a68IzAJXzqU4…"]
    },
    {
      name: "a bad signature",
      check: { ...UNSIGNED, state: "bad", format: "ssh", trust: "never" },
      text: "Bad signature",
      colour: "text-signature-bad",
      mark: "cross",
      facts: []
    },
    {
      name: "an expired signature",
      check: {
        ...UNSIGNED,
        state: "expiredSignature",
        format: "openpgp",
        signer: "Ann",
        key: "89ABCDEF01234567"
      },
      text: "Expired signature",
      colour: "text-signature-warning",
      mark: "clock",
      facts: ["Signer: Ann", "Key 89ABCDEF01234567"]
    },
    {
      name: "a signature by an expired key",
      check: { ...UNSIGNED, state: "expiredKey", format: "openpgp", signer: "Ann" },
      text: "Signed with an expired key",
      colour: "text-signature-warning",
      mark: "clock",
      facts: ["Signer: Ann"]
    },
    {
      name: "a signature by a revoked key",
      check: { ...UNSIGNED, state: "revoked", format: "x509", signer: "CN=Ann" },
      text: "Signed with a revoked key",
      colour: "text-signature-bad",
      mark: "slash",
      facts: ["Signer: CN=Ann"]
    },
    {
      name: "a signature whose key is missing",
      check: {
        ...UNSIGNED,
        state: "unchecked",
        format: "openpgp",
        key: "89ABCDEF01234567",
        reason: "missingKey"
      },
      text: "Signature can't be checked",
      colour: "text-signature-unknown",
      mark: "question",
      facts: ["The key that made it is not available here.", "Key 89ABCDEF01234567"]
    },
    {
      name: "a signature whose program is missing",
      check: { ...UNSIGNED, state: "unchecked", format: "x509", reason: "noProgram" },
      text: "Signature can't be checked",
      colour: "text-signature-unknown",
      mark: "question",
      facts: ["Git could not start gpgsm to check it."]
    },
    {
      name: "an SSH signature without allowed signers",
      check: { ...UNSIGNED, state: "unchecked", format: "ssh", reason: "allowedSigners" },
      text: "Signature can't be checked",
      colour: "text-signature-unknown",
      mark: "question",
      facts: ["Set gpg.ssh.allowedSignersFile to check SSH signatures."]
    },
    {
      name: "a check that timed out",
      check: { ...UNSIGNED, state: "unchecked", format: "openpgp", reason: "timeout" },
      text: "Signature can't be checked",
      colour: "text-signature-unknown",
      mark: "question",
      facts: ["The check took too long and was stopped."]
    },
    {
      name: "a signature Git could not read",
      check: { ...UNSIGNED, state: "unchecked", format: "openpgp", reason: "unreadable" },
      text: "Signature can't be checked",
      colour: "text-signature-unknown",
      mark: "question",
      facts: ["Git could not read the signature."]
    },
    {
      name: "an unsigned commit",
      check: UNSIGNED,
      text: "Unsigned",
      colour: "text-signature-unknown",
      mark: "none",
      facts: []
    }
  ];

  it.each(cases)(
    "shows $name with an icon and words",
    ({ check, text, colour, mark, facts: shown }) => {
      act(() => render(h(SignatureLine, { hash: HASH }), host));
      answer(check);
      const badge = verdict();
      expect(badge.dataset.signature).toBe(check.state);
      expect(badge.textContent).toBe(text);
      expect(badge.classList.contains(colour)).toBe(true);
      // The shield's drawing tells the verdicts apart without their colour.
      const paths = badge.querySelectorAll("svg path");
      expect(paths).toHaveLength(mark === "none" ? 1 : 2);
      expect(paths[0]!.getAttribute("stroke-dasharray") !== null).toBe(mark === "none");
      expect(facts()).toEqual(shown);
      expect(lineText()).toBe(["Signature:", text, ...shown].join(" "));
    }
  );

  it("gives every verdict a drawing of its own", () => {
    const drawings = new Map<string, string>();
    for (const { check } of cases) {
      act(() => render(h(SignatureLine, { hash: HASH }), host));
      answer(check);
      drawings.set(check.state, verdict().querySelector("svg")!.innerHTML);
      act(() => render(null, host));
    }
    expect(drawings.size).toBe(8);
    // Only the two kinds of expiry share a drawing; their words differ.
    expect(drawings.get("expiredKey")).toBe(drawings.get("expiredSignature"));
    expect(new Set(drawings.values()).size).toBe(7);
  });

  it("shows the whole fingerprint when the pointer rests on the short one", () => {
    act(() => render(h(SignatureLine, { hash: HASH }), host));
    answer(cases[0]!.check);
    const key = [...host.querySelectorAll("span.text-muted")].find((span) =>
      span.textContent?.startsWith("Key ")
    );
    expect(key?.getAttribute("title")).toBe(FINGERPRINT);
  });

  it("says the signature can't be checked when the check fails, and why", () => {
    act(() => render(h(SignatureLine, { hash: HASH }), host));
    answer(null, "fatal: bad object");
    expect(verdict().dataset.signature).toBe("unchecked");
    expect(lineText()).toBe(
      "Signature: Signature can't be checked Git could not read the signature. fatal: bad object"
    );
  });
});

describe("shortFingerprint", () => {
  it("keeps the long key ID of a hex fingerprint and the start of an SSH key's hash", () => {
    expect(shortFingerprint(FINGERPRINT)).toBe("89ABCDEF01234567");
    expect(shortFingerprint("89ABCDEF01234567")).toBe("89ABCDEF01234567");
    expect(shortFingerprint(SSH_KEY)).toBe("SHA256:a68IzAJXzqU4…");
    expect(shortFingerprint("SHA256:short")).toBe("SHA256:short");
  });
});

describe("the signed mark on a row", () => {
  const commit: GitCommitNode = {
    hash: HASH,
    parentHashes: [],
    author: "Ann",
    email: "ann@example.org",
    date: 0,
    message: "Sign the release",
    refs: []
  };

  function drawRow(row: GitCommitNode) {
    const body = document.createElement("tbody");
    host.append(body);
    act(() =>
      render(
        h(CommitRow, {
          commit: row,
          isHead: false,
          headBranch: null,
          messages: new Map(),
          colour: undefined,
          expanded: false,
          onSelect: undefined
        }),
        body
      )
    );
    return body;
  }

  it("shows a key after the description of a signed commit, and says how to verify it", () => {
    const body = drawRow({ ...commit, signed: true });
    const mark = body.querySelector<HTMLElement>("[data-signed]")!;
    expect(mark.getAttribute("role")).toBe("img");
    expect(mark.getAttribute("aria-label")).toBe("Signed — open the details to verify");
    expect(mark.getAttribute("title")).toBe("Signed — open the details to verify");
    expect(mark.classList.contains("text-muted")).toBe(true);
    expect(mark.querySelector("svg")).not.toBeNull();
    // It follows the description, and the row asks Git nothing for it.
    const description = [...body.querySelectorAll("span")].find(
      (span) => span.textContent === commit.message
    )!;
    expect(description.nextElementSibling).toBe(mark);
    expect(reads()).toEqual([]);
    render(null, body);
  });

  it("shows nothing on an unsigned commit", () => {
    const body = drawRow(commit);
    expect(body.querySelector("[data-signed]")).toBeNull();
    render(null, body);
  });
});
