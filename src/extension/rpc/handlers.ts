import { copyToClipboard } from "@/extension/handlers/clipboard";
import { showGoTo } from "@/extension/handlers/go-to";
import { webviewInitialize } from "@/extension/handlers/initialize";
import { cloneRepo, initializeRepo, openFolder } from "@/extension/handlers/initialize-repo";
import { runCommand } from "@/extension/handlers/onboarding";
import { openExtensionSettings } from "@/extension/handlers/open-settings";
import { openUrl } from "@/extension/handlers/open-url";
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
  "git.clone": () => cloneRepo(),
  "folder.open": () => openFolder(),
  "repo.scan": () => scanRepos(),
  "settings.open": () => openExtensionSettings(),
  "docs.open": () => runCommand("branchwise.openDocumentation"),
  "walkthrough.open": () => runCommand("branchwise.openWalkthrough"),
  "goTo.show": (params) => showGoTo(params),
  "url.open": (url) => openUrl(url)
} satisfies RpcHandlerTable;
