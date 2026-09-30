import type { SimpleGit } from "simple-git";
import { beforeEach, describe, expect, test, vi } from "vitest";

import { DiffDocProvider, encodeDiffDocUri } from "@/old-extension/diffDocProvider";

/** What the provider did with the VS Code API. */
const api = vi.hoisted(() => ({
  closeListeners: [] as ((document: { uri: { toString(): string } }) => void)[],
  emitters: 0,
  fired: 0,
  released: [] as string[]
}));

vi.mock("vscode", () => ({
  Uri: {
    from: (parts: { scheme: string; path: string; query: string }) => ({
      ...parts,
      toString: () => `${parts.scheme}|${parts.path}|${parts.query}`
    })
  },
  EventEmitter: class {
    constructor() {
      api.emitters++;
    }
    readonly event = () => ({ dispose() {} });
    fire() {
      api.fired++;
    }
    dispose() {
      api.released.push("emitter");
    }
  },
  workspace: {
    onDidCloseTextDocument(listener: (typeof api.closeListeners)[number]) {
      api.closeListeners.push(listener);
      return { dispose: () => api.released.push("close listener") };
    }
  }
}));

const id = "4b".repeat(20);
let serial = 0;

beforeEach(() => {
  api.closeListeners.length = 0;
  api.emitters = 0;
  api.fired = 0;
  api.released.length = 0;
});

/** A repository folder no other test has built a URI for. */
function freshFolder() {
  serial += 1;
  return `/lifecycle/repo-${serial}`;
}

/** A promise the test settles by hand. */
function deferred() {
  let resolve!: (text: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}

/**
 * A provider whose clients answer `show` with `answer`. `folders` lists the folders it made
 * clients for; `show` is shared by every client.
 */
function setup(
  answer: (args: string[]) => string | Promise<string> = () => "text",
  saved: (key: string) => boolean = () => false
) {
  const folders: string[] = [];
  const show = vi.fn(answer);
  const provider = new DiffDocProvider((folder) => {
    folders.push(folder);
    return { show } as unknown as SimpleGit;
  }, saved);
  return { provider, folders, show };
}

/** A document URI written by hand, with a string form of its own. */
function handMade(key: string, query: string, path = "file.txt") {
  return { path, query, toString: () => key } as unknown as import("vscode").Uri;
}

function closeDocument(key: string) {
  for (const listener of api.closeListeners) {
    listener({ uri: { toString: () => key } });
  }
}

describe("constructing", () => {
  test("subscribes to closed documents and makes one emitter, without calling back", () => {
    const repos = vi.fn(() => ({}) as SimpleGit);
    const saved = vi.fn(() => true);
    const provider = new DiffDocProvider(repos, saved);
    expect(api.closeListeners).toHaveLength(1);
    expect(api.emitters).toBe(1);
    expect(repos).not.toHaveBeenCalled();
    expect(saved).not.toHaveBeenCalled();
    expect(provider.onDidChange).toBe(provider.onDidChange);
    expect(typeof provider.onDidChange).toBe("function");
  });
});

describe("asking Git", () => {
  test("passes the revision between --end-of-options and --, and only the ID for objects", async () => {
    const folder = freshFolder();
    const { provider, show } = setup(undefined, () => true);
    const repo = encodeURIComponent(folder);

    await provider.provideTextDocumentContent(
      handMade("parent", `commit=${id}%5E&repo=${repo}`, "a b/c.txt")
    );
    await provider.provideTextDocumentContent(
      handMade("object", `commit=${id}&repo=${repo}&blob=1`, "a b/c.txt")
    );
    expect(show.mock.calls).toEqual([
      [["--end-of-options", `${id}^:a b/c.txt`, "--"]],
      [["--end-of-options", id, "--"]]
    ]);
  });

  test("keeps a path that looks like an option inside the revision", async () => {
    const folder = freshFolder();
    const { provider, show } = setup();
    await provider.provideTextDocumentContent(encodeDiffDocUri(folder, "--output=/tmp/x", id));
    expect(show).toHaveBeenCalledExactlyOnceWith([
      "--end-of-options",
      `${id}:--output=/tmp/x`,
      "--"
    ]);
  });

  test.each([
    ["uppercase hex", id.toUpperCase()],
    ["two parent steps", `${id}^^`],
    ["a tilde", `${id}~1`],
    ["a numbered parent", `${id}^2`],
    ["the empty object's parent", "0".repeat(40) + "^"],
    ["a SHA-256 empty object", "0".repeat(64)],
    ["an abbreviation", id.slice(0, 39)],
    ["an overlong ID", id + "4"],
    ["surrounding space", ` ${id}`],
    ["a range", `${id}..${id}`],
    ["an option", "--textconv"],
    ["nothing", ""]
  ])("refuses %s without making a client", async (_name, commit) => {
    const { provider, folders } = setup(undefined, () => true);
    const query = `commit=${encodeURIComponent(commit)}&repo=${encodeURIComponent(freshFolder())}`;
    expect(provider.provideTextDocumentContent(handMade(commit, query))).toBe("");
    expect(provider.provideTextDocumentContent(handMade(commit + "b", query + "&blob=1"))).toBe("");
    expect(folders).toEqual([]);
  });

  test("refuses a document with no file path, but not an object, which needs none", async () => {
    const folder = freshFolder();
    const { provider, show } = setup();
    const blank = encodeDiffDocUri(folder, "", id);
    expect(provider.provideTextDocumentContent(blank)).toBe("");
    expect(show).not.toHaveBeenCalled();

    const object = handMade("object", `commit=${id}&repo=${encodeURIComponent(folder)}&blob=1`, "");
    expect(await provider.provideTextDocumentContent(object)).toBe("text");
    expect(show).toHaveBeenCalledExactlyOnceWith(["--end-of-options", id, "--"]);
  });

  test("accepts SHA-256 IDs", async () => {
    const long = "e7".repeat(32);
    const { provider, show } = setup();
    expect(
      await provider.provideTextDocumentContent(encodeDiffDocUri(freshFolder(), "f", long))
    ).toBe("text");
    expect(show).toHaveBeenCalledExactlyOnceWith(["--end-of-options", `${long}:f`, "--"]);
  });
});

describe("repositories", () => {
  test("asks about saved state by the normalized key, and serves the folder as written", () => {
    const folder = freshFolder();
    const asked: string[] = [];
    const { provider, folders } = setup(undefined, (key) => {
      asked.push(key);
      return true;
    });
    void provider.provideTextDocumentContent(
      handMade("odd", `commit=${id}&repo=${encodeURIComponent(folder + "/sub/..//")}`)
    );
    expect(asked).toEqual([folder + "/"]);
    expect(folders).toEqual([folder + "/sub/..//"]);
  });

  test("treats a trailing separator as a different repository", () => {
    const folder = freshFolder();
    const asked: string[] = [];
    const { provider, folders } = setup(undefined, (key) => {
      asked.push(key);
      return false;
    });
    encodeDiffDocUri(folder, "f", id);
    expect(
      provider.provideTextDocumentContent(
        handMade("slash", `commit=${id}&repo=${encodeURIComponent(folder + "/./")}`)
      )
    ).toBe("");
    expect(asked).toEqual([folder + "/"]);
    expect(folders).toEqual([]);
  });

  test("does not ask about saved state for repositories it built URIs for", async () => {
    const saved = vi.fn(() => false);
    const { provider } = setup(undefined, saved);
    expect(
      await provider.provideTextDocumentContent(encodeDiffDocUri(freshFolder(), "f", id))
    ).toBe("text");
    expect(saved).not.toHaveBeenCalled();
  });

  test("records a repository even when its URI is never opened", async () => {
    const folder = freshFolder();
    encodeDiffDocUri(folder, "f", id);
    const { provider } = setup();
    expect(
      await provider.provideTextDocumentContent(
        handMade("later", `commit=${id}&repo=${encodeURIComponent(folder)}`)
      )
    ).toBe("text");
  });
});

describe("failures", () => {
  test("serve an empty document when Git fails, and ask Git again next time", async () => {
    const { provider, show } = setup(() => Promise.reject(new Error("fatal: bad object")));
    const uri = encodeDiffDocUri(freshFolder(), "f", id);
    expect(await provider.provideTextDocumentContent(uri)).toBe("");
    expect(await provider.provideTextDocumentContent(uri)).toBe("");
    expect(show).toHaveBeenCalledTimes(2);

    show.mockImplementation(() => "recovered");
    expect(await provider.provideTextDocumentContent(uri)).toBe("recovered");
  });

  test("serve an empty document at once when no client can be made, every time", () => {
    const folder = freshFolder();
    const repos = vi.fn((): SimpleGit => {
      throw new Error("Cannot use simple-git on a directory that does not exist");
    });
    const provider = new DiffDocProvider(repos, () => true);
    const uri = encodeDiffDocUri(folder, "f", id);
    expect(provider.provideTextDocumentContent(uri)).toBe("");
    expect(provider.provideTextDocumentContent(uri)).toBe("");
    expect(repos).toHaveBeenCalledTimes(2);
  });

  test("serve an empty document when the saved-state check throws", () => {
    const { provider, folders } = setup(undefined, () => {
      throw new Error("state unavailable");
    });
    const uri = handMade("saved", `commit=${id}&repo=${encodeURIComponent(freshFolder())}`);
    expect(provider.provideTextDocumentContent(uri)).toBe("");
    expect(folders).toEqual([]);
  });

  test("serve an empty document when the client throws instead of rejecting", async () => {
    const { provider, show } = setup(() => {
      throw new Error("spawn failed");
    });
    const uri = encodeDiffDocUri(freshFolder(), "f", id);
    expect(await provider.provideTextDocumentContent(uri)).toBe("");
    expect(await provider.provideTextDocumentContent(uri)).toBe("");
    expect(show).toHaveBeenCalledTimes(2);
  });

  test("serve an empty document when the URI itself misbehaves", () => {
    const { provider } = setup();
    const broken = {
      path: "f",
      query: "",
      toString() {
        throw new Error("no string form");
      }
    } as unknown as import("vscode").Uri;
    expect(provider.provideTextDocumentContent(broken)).toBe("");
  });
});

describe("keeping content", () => {
  test("answers a repeated request from memory, directly", async () => {
    const { provider, show } = setup();
    const uri = encodeDiffDocUri(freshFolder(), "f", id);
    expect(await provider.provideTextDocumentContent(uri)).toBe("text");
    expect(provider.provideTextDocumentContent(uri)).toBe("text");
    expect(show).toHaveBeenCalledOnce();
  });

  test("keeps an empty file that Git produced", async () => {
    const { provider, show } = setup(() => "");
    const uri = encodeDiffDocUri(freshFolder(), "empty.txt", id);
    expect(await provider.provideTextDocumentContent(uri)).toBe("");
    expect(provider.provideTextDocumentContent(uri)).toBe("");
    expect(show).toHaveBeenCalledOnce();
  });

  test("keeps a cached document even after its repository stops qualifying", async () => {
    let saved = true;
    const { provider, folders } = setup(undefined, () => saved);
    const uri = handMade("kept", `commit=${id}&repo=${encodeURIComponent(freshFolder())}`);
    expect(await provider.provideTextDocumentContent(uri)).toBe("text");
    saved = false;
    expect(provider.provideTextDocumentContent(uri)).toBe("text");
    expect(folders).toHaveLength(1);
  });

  test("forgets a document when VS Code closes it, and only that one", async () => {
    const { provider, show } = setup();
    const folder = freshFolder();
    const first = encodeDiffDocUri(folder, "one.txt", id);
    const second = encodeDiffDocUri(folder, "two.txt", id);
    await provider.provideTextDocumentContent(first);
    await provider.provideTextDocumentContent(second);

    closeDocument(first.toString());
    closeDocument("elsewhere:unrelated");
    expect(await provider.provideTextDocumentContent(first)).toBe("text");
    expect(provider.provideTextDocumentContent(second)).toBe("text");
    expect(show).toHaveBeenCalledTimes(3);
  });

  test("shares one Git run between requests that overlap", async () => {
    const run = deferred();
    const { provider, show, folders } = setup(() => run.promise);
    const uri = encodeDiffDocUri(freshFolder(), "f", id);
    const first = provider.provideTextDocumentContent(uri);
    const second = provider.provideTextDocumentContent(uri);
    run.resolve("shared");
    expect(await Promise.all([first, second])).toEqual(["shared", "shared"]);
    expect(show).toHaveBeenCalledOnce();
    expect(folders).toHaveLength(1);
    expect(provider.provideTextDocumentContent(uri)).toBe("shared");
  });

  test("shares a failed run too, then tries again", async () => {
    const run = deferred();
    const { provider, show } = setup(() => run.promise);
    const uri = encodeDiffDocUri(freshFolder(), "f", id);
    const overlapping = [
      provider.provideTextDocumentContent(uri),
      provider.provideTextDocumentContent(uri)
    ];
    run.reject(new Error("fatal: path 'f' does not exist"));
    expect(await Promise.all(overlapping)).toEqual(["", ""]);
    expect(show).toHaveBeenCalledOnce();

    show.mockImplementation(() => "second try");
    expect(await provider.provideTextDocumentContent(uri)).toBe("second try");
    expect(show).toHaveBeenCalledTimes(2);
  });

  test("does not keep what arrives for a document closed while it loaded", async () => {
    const run = deferred();
    const { provider, show } = setup(() => run.promise);
    const uri = encodeDiffDocUri(freshFolder(), "f", id);
    const loading = provider.provideTextDocumentContent(uri);
    closeDocument(uri.toString());
    run.resolve("late");
    expect(await loading).toBe("late");

    show.mockImplementation(() => "fresh");
    expect(await provider.provideTextDocumentContent(uri)).toBe("fresh");
  });

  test("never announces a change", async () => {
    const { provider } = setup();
    const folder = freshFolder();
    const uris = ["a", "b", "c"].map((file) => encodeDiffDocUri(folder, file, id));
    const heard = vi.fn();
    provider.onDidChange(heard);
    await Promise.all(uris.map((uri) => provider.provideTextDocumentContent(uri)));
    closeDocument(uris[0]!.toString());
    await provider.provideTextDocumentContent(uris[0]!);
    expect(api.fired).toBe(0);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe("disposing", () => {
  test("releases the listener and the emitter once, however often it is called", () => {
    const { provider } = setup();
    provider.dispose();
    provider.dispose();
    expect(api.released.toSorted()).toEqual(["close listener", "emitter"]);
  });

  test("serves nothing afterwards, not even what it had kept", async () => {
    const { provider, folders } = setup();
    const uri = encodeDiffDocUri(freshFolder(), "f", id);
    expect(await provider.provideTextDocumentContent(uri)).toBe("text");
    provider.dispose();
    expect(provider.provideTextDocumentContent(uri)).toBe("");
    expect(
      provider.provideTextDocumentContent(encodeDiffDocUri(freshFolder(), "other.txt", id))
    ).toBe("");
    expect(folders).toHaveLength(1);
  });

  test("still settles a request that was running, without keeping its content", async () => {
    const run = deferred();
    const { provider, show } = setup(() => run.promise);
    const loading = provider.provideTextDocumentContent(encodeDiffDocUri(freshFolder(), "f", id));
    provider.dispose();
    run.resolve("finished");
    expect(await loading).toBe("finished");
    expect(show).toHaveBeenCalledOnce();
  });

  test("leaves the record of repositories for providers made later", async () => {
    const folder = freshFolder();
    encodeDiffDocUri(folder, "f", id);
    setup().provider.dispose();
    const { provider } = setup();
    expect(
      await provider.provideTextDocumentContent(
        handMade("after", `commit=${id}&repo=${encodeURIComponent(folder)}`)
      )
    ).toBe("text");
  });
});
