// What the Vitest `extension` project loads for the bare specifier `vscode` (see
// vitest.config.ts). It holds no state and records nothing, so a test that needs to observe the
// API spies on a member here or replaces the whole module with its own factory.

/** A subscription whose end does nothing. */
const inertSubscription = () => ({ dispose: () => {} });

export const workspace = {
  // Every setting reads as the fallback the caller passes, so settings keep their defaults, and
  // no setting is stored at any scope.
  getConfiguration: () => ({
    get: <T>(_key: string, defaultValue?: T) => defaultValue,
    inspect: () => undefined
  }),
  workspaceFolders: undefined,
  createFileSystemWatcher: () => ({ onDidCreate: inertSubscription, dispose: () => {} }),
  onDidChangeWorkspaceFolders: inertSubscription,
  onDidChangeConfiguration: inertSubscription
};

export const commands = {
  registerCommand: inertSubscription
};

export const window = {
  showErrorMessage: () => Promise.resolve(undefined)
};
