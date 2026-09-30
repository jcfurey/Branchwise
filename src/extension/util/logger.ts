import * as vscode from "vscode";

import { EXTENSION_NAME } from "@/extension/constants";

/** Where log lines go once activation has called `init`. Until then they are dropped. */
let channel: vscode.LogOutputChannel | undefined;

/**
 * The extension's log, shared by every module. VS Code stamps each line with its time and level,
 * and hides levels below the one the user chose, so lines are passed on exactly as given.
 */
export const logger = {
  init: (ctx: vscode.ExtensionContext): void => {
    channel = vscode.window.createOutputChannel(EXTENSION_NAME, { log: true });
    ctx.subscriptions.push(channel);
  },
  error: (message: string | Error, ...args: unknown[]): void => {
    channel?.error(message, ...args);
  },
  warn: (message: string, ...args: unknown[]): void => {
    channel?.warn(message, ...args);
  },
  info: (message: string, ...args: unknown[]): void => {
    channel?.info(message, ...args);
  },
  debug: (message: string, ...args: unknown[]): void => {
    channel?.debug(message, ...args);
  }
};
