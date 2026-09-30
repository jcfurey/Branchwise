import { copyToClipboard } from "@/extension/handlers/clipboard";
import { webviewInitialize } from "@/extension/handlers/initialize";
import { initializeRepo } from "@/extension/handlers/initialize-repo";
import { runCommand } from "@/extension/handlers/onboarding";
import { openExtensionSettings } from "@/extension/handlers/open-settings";
import { scanRepos } from "@/extension/handlers/scan-repo";
import type { RpcMethod, RpcMethodMap } from "@/types";

/**
 * One handler per method of `RpcMethodMap`, answering with that method's result. Params arrive
 * unchecked from the page, so a handler that reads them takes `unknown` and validates them.
 */
type RpcHandlerTable = {
  readonly [M in RpcMethod]: (
    params: unknown
  ) => RpcMethodMap[M]["result"] | Promise<RpcMethodMap[M]["result"]>;
};

/**
 * What answers each RPC method the page may call. The RPC server looks methods up among these
 * own properties only; a new method goes into `RpcMethodMap` and here.
 */
export const rpcHandlers = {
  "clipboard.copy": (text) => copyToClipboard(text),
  "webview.initialize": () => webviewInitialize(),
  "git.init": () => initializeRepo(),
  "repo.scan": () => scanRepos(),
  "settings.open": () => openExtensionSettings(),
  "docs.open": () => runCommand("branchwise.openDocumentation"),
  "walkthrough.open": () => runCommand("branchwise.openWalkthrough")
} satisfies RpcHandlerTable;
