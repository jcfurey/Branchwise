/** How hard `git reset` moves the branch: `--soft`, `--mixed` or `--hard`. */
export type GitResetMode = "soft" | "mixed" | "hard";

/**
 * Values of the `branchwise.dateType` setting. Producers read the author time for exactly
 * `"Author Date"` and the committer time for anything else.
 */
export type DateType = "Author Date" | "Commit Date";

/**
 * How a path changed in a commit. Git's type changes are folded into `"M"`, and copies are
 * never detected, so no other letter appears.
 */
export type GitFileChangeType = "A" | "M" | "D" | "R";

/**
 * A branch, tag or remote-tracking label on a commit. `"head"` means a local branch, not HEAD.
 * `name` drops the namespace (`main`, `v1.0`, `origin/main`), and `hash` is the full ID of the
 * commit the ref resolves to, with annotated tags peeled.
 */
export type GitRef = { hash: string; name: string; type: "head" | "tag" | "remote" };

/** One commit as the graph's log reports it. */
export type GitLogEntry = {
  /** Full lowercase object ID. */
  hash: string;
  /** First parent first; empty for a root or shallow-boundary commit. */
  parentHashes: string[];
  author: string;
  email: string;
  /**
   * Unix seconds, from the author or committer time as `DateType` chooses. `NaN` when Git gave
   * no usable timestamp, which reaches the webview as `null`.
   */
  date: number;
  /** The subject line only. */
  message: string;
};

/**
 * A row of the graph: a log entry and the labels pointing at it. A row with `hash` `"*"` stands
 * for the uncommitted changes.
 */
export type GitCommitNode = GitLogEntry & {
  refs: GitRef[];
  /**
   * Present, and true, when the graph found a signature in the commit. Whether the signature is
   * valid is only known once `SignatureCheck` has checked it.
   */
  signed?: true;
};

/** The kinds of signature Git makes and checks: by gpg, by gpgsm, and by ssh-keygen. */
export type SignatureFormat = "openpgp" | "x509" | "ssh";

/** What checking a commit's signature found. `signatureState` maps Git's letters to these. */
export type SignatureState =
  | "good"
  | "untrusted"
  | "bad"
  | "expiredSignature"
  | "expiredKey"
  | "revoked"
  | "unchecked"
  | "unsigned";

/** Why a signature could not be checked. */
export type UncheckedReason =
  /** Git reported that the signing key is not available, as for a key not in the keyring. */
  | "missingKey"
  /** The checking program, gpg, gpgsm or ssh-keygen, could not be started. */
  | "noProgram"
  /** SSH signatures are only checked against `gpg.ssh.allowedSignersFile`, which is not set. */
  | "allowedSigners"
  /** The check took too long and was stopped. */
  | "timeout"
  /** Git gave no verdict on the signature, as for one it cannot read. */
  | "unreadable";

/** The verdict on one commit's signature, and what Git told about the signer. */
export type SignatureCheck = {
  state: SignatureState;
  /** The kind of signature the commit carries; `null` for an unsigned commit. */
  format: SignatureFormat | null;
  /** The signer's name, or the SSH principal; empty when Git names none. */
  signer: string;
  /** The key Git names: an OpenPGP key ID or fingerprint, or an SSH key's fingerprint. */
  key: string;
  /** The signing key's whole fingerprint, when Git knows it. */
  fingerprint: string;
  /** Git's trust level for the key: `undefined`, `never`, `marginal`, `fully` or `ultimate`. */
  trust: string;
  /** Set exactly when `state` is `"unchecked"`. */
  reason: UncheckedReason | null;
};

/** One changed path, compared with the commit's first parent or the empty tree. */
export type GitFileChange = {
  /** The source of a rename; otherwise the same as `newFilePath`, even for an added file. */
  oldFilePath: string;
  newFilePath: string;
  type: GitFileChangeType;
  /** Line counts, or `null` for a binary file or when no count matched the path. */
  additions: number | null;
  deletions: number | null;
};

/** What the details panel shows for one commit. */
export type GitCommitDetails = {
  /** The resolved commit's full ID, which may be spelt differently from the request. */
  hash: string;
  parents: string[];
  author: string;
  email: string;
  date: number;
  /** The committer's name alone. */
  committer: string;
  /** The whole message with line endings made `\n` and trailing newlines removed. */
  body: string;
  fileChanges: GitFileChange[];
};
