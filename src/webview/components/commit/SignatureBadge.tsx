import { Fragment } from "preact";

import type { SignatureCheck, SignatureFormat, SignatureState } from "@/backend/types";
import { KeyIcon, ShieldIcon, type ShieldMark } from "@/webview/components/ui/Icons";
import { useRepositoryQuery } from "@/webview/lib/use-repository-query";

/**
 * How each verdict looks: the mark on its shield and its colour. Its words always say the same,
 * so the colour is never the only sign.
 */
const LOOKS: Record<SignatureState, { mark: ShieldMark; colour: string }> = {
  good: { mark: "check", colour: "text-signature-good" },
  untrusted: { mark: "exclamation", colour: "text-signature-unknown" },
  bad: { mark: "cross", colour: "text-signature-bad" },
  expiredSignature: { mark: "clock", colour: "text-signature-warning" },
  expiredKey: { mark: "clock", colour: "text-signature-warning" },
  revoked: { mark: "slash", colour: "text-signature-bad" },
  unchecked: { mark: "question", colour: "text-signature-unknown" },
  unsigned: { mark: "none", colour: "text-signature-unknown" }
};

/** The program Git starts to check each kind of signature. */
const PROGRAMS: Record<SignatureFormat, string> = {
  openpgp: "gpg",
  x509: "gpgsm",
  ssh: "ssh-keygen"
};

/** A whole OpenPGP or X.509 fingerprint, as opposed to a key ID or an SSH key's hash. */
const HEX_FINGERPRINT = /^[0-9A-Fa-f]{17,}$/;

/**
 * Enough of a fingerprint to recognise the key by: the last 16 hex digits of an OpenPGP or X.509
 * fingerprint, which are its long key ID, or the start of an SSH key's `SHA256:` hash.
 */
export function shortFingerprint(fingerprint: string): string {
  if (HEX_FINGERPRINT.test(fingerprint)) {
    return fingerprint.slice(-16);
  }
  return fingerprint.length > 19 ? `${fingerprint.slice(0, 19)}…` : fingerprint;
}

/** `template` with its `{0}` replaced by `value` as written, even when it contains `$`. */
function fill(template: string, value: string) {
  return template.replace("{0}", () => value);
}

function verdict(check: SignatureCheck) {
  const l10n = window.l10n;
  switch (check.state) {
    case "good":
      return check.signer === "" ? l10n.signatureGood : fill(l10n.signatureGoodBy, check.signer);
    case "untrusted":
      return l10n.signatureUntrusted;
    case "bad":
      return l10n.signatureBad;
    case "expiredSignature":
      return l10n.signatureExpired;
    case "expiredKey":
      return l10n.signatureExpiredKey;
    case "revoked":
      return l10n.signatureRevoked;
    case "unchecked":
      return l10n.signatureUnchecked;
    case "unsigned":
      return l10n.signatureUnsigned;
  }
}

/** Git's trust levels, in the words the page shows. `undefined` says nothing, so it is left out. */
function trustLevel(trust: string) {
  const l10n = window.l10n;
  switch (trust) {
    case "never":
      return l10n.trustNever;
    case "marginal":
      return l10n.trustMarginal;
    case "fully":
      return l10n.trustFully;
    case "ultimate":
      return l10n.trustUltimate;
    default:
      return null;
  }
}

function uncheckedReason(check: SignatureCheck) {
  const l10n = window.l10n;
  switch (check.reason) {
    case "missingKey":
      return l10n.signatureMissingKey;
    case "noProgram":
      return fill(l10n.signatureNoProgram, PROGRAMS[check.format ?? "openpgp"]);
    case "allowedSigners":
      return l10n.signatureAllowedSigners;
    case "timeout":
      return l10n.signatureTimeout;
    default:
      return l10n.signatureUnreadable;
  }
}

/** The facts after the verdict: who signed, with which key and how far it is trusted, or why not. */
function facts(check: SignatureCheck): Array<{ text: string; title?: string }> {
  const l10n = window.l10n;
  const shown: Array<{ text: string; title?: string }> = [];
  if (check.state === "unchecked") {
    shown.push({ text: uncheckedReason(check) });
  }
  if (check.signer !== "" && check.state !== "good") {
    shown.push({ text: fill(l10n.signatureSigner, check.signer) });
  }
  const key = check.fingerprint || check.key;
  if (key !== "") {
    shown.push({ text: fill(l10n.signatureKey, shortFingerprint(key)), title: key });
  }
  const trust = trustLevel(check.trust);
  if (trust !== null && (check.state === "good" || check.state === "untrusted")) {
    shown.push({ text: fill(l10n.signatureTrust, trust) });
  }
  return shown;
}

/** A verdict: its shield and words in the verdict's colour, then its facts in muted text. */
export function SignatureVerdict({ check, error }: { check: SignatureCheck; error?: string }) {
  const { mark, colour } = LOOKS[check.state];
  const shown = facts(check);
  if (error !== undefined) {
    shown.push({ text: error });
  }
  return (
    <>
      <span class={`inline-flex min-w-0 items-center gap-1 ${colour}`} data-signature={check.state}>
        <ShieldIcon mark={mark} class="size-3.5 shrink-0" />
        {verdict(check)}
      </span>
      {/* The gap only shows the spaces; these keep the words apart when read or copied. */}
      {shown.map(({ text, title }) => (
        <Fragment key={text}>
          {" "}
          <span class="text-muted" title={title}>
            {text}
          </span>
        </Fragment>
      ))}
    </>
  );
}

/** What the page shows when the check itself failed, as when Git could not read the commit. */
const FAILED: SignatureCheck = {
  state: "unchecked",
  format: null,
  signer: "",
  key: "",
  fingerprint: "",
  trust: "",
  reason: "unreadable"
};

/**
 * The line of a commit's details that says whether it is signed and whether the signature is
 * good. The check runs when the details open, and is cancelled if they close first.
 */
export function SignatureLine({ hash }: { hash: string }) {
  const { data, error, loading } = useRepositoryQuery<"signature">({ kind: "signature", hash });
  const [label, after = ""] = window.l10n.detailSignature.split("{0}");
  let content;
  if (data !== null) {
    content = <SignatureVerdict check={data.check} />;
  } else if (loading || error === null) {
    content = (
      <span class="text-muted" data-signature="checking">
        {window.l10n.signatureChecking}
      </span>
    );
  } else {
    content = <SignatureVerdict check={FAILED} error={error} />;
  }
  return (
    <div class="flex flex-wrap items-center gap-x-2" aria-live="polite">
      <b>{label}</b>
      {content}
      {after}
    </div>
  );
}

/**
 * A small key after the description of a signed commit. Whether the signature is valid is only
 * known once the commit's details check it, which the tooltip says.
 */
export function SignedMark() {
  const label = window.l10n.signedCommit;
  return (
    <span
      role="img"
      aria-label={label}
      title={label}
      data-signed
      class="ml-1 flex shrink-0 text-muted"
    >
      <KeyIcon class="size-3.5" />
    </span>
  );
}
