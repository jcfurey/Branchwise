import { vi } from "vitest";

import type { Config } from "@/extension/config";
import { registerMessageHandlers } from "@/old-extension/messageHandler";
import type { RepoManager } from "@/old-extension/repoManager";
import type { WebviewBridge } from "@/old-extension/webviewBridge";
import type { RequestMessage, ResponseMessage } from "@/types";

/** A page message as a test writes it: a known command and whatever fields the case needs. */
export type PageMessage = { command: RequestMessage["command"]; [field: string]: unknown };

type Route = (message: PageMessage) => void | Promise<void>;

/**
 * The graph page seen from the legacy handlers. `send` delivers a message the way the bridge
 * does, starting its handler within the call; `received` collects every post in order.
 */
export function legacyPage(
  setup: {
    config?: Partial<Config>;
    repoManager?: Partial<RepoManager>;
    /** Replaces the recording post, for pages that fail to receive. */
    post?: WebviewBridge["post"];
  } = {}
) {
  const routes = new Map<string, Route>();
  const received: ResponseMessage[] = [];
  const post = vi.fn(
    setup.post ??
      (async (message: ResponseMessage) => {
        received.push(message);
        return true;
      })
  );
  const bridge: WebviewBridge = {
    post,
    onMessage: (command, handler) => {
      routes.set(command, handler as Route);
    },
    dispose: () => {}
  };
  const lifetime = registerMessageHandlers(bridge, {
    config: { gitPath: () => "git", ...setup.config } as Config,
    repoManager: { getRepos: () => ({}), ...setup.repoManager } as RepoManager
  });
  return {
    routes,
    received,
    post,
    lifetime,
    send: async (message: PageMessage) => {
      const route = routes.get(message.command);
      if (route === undefined) {
        throw new Error(`Nothing handles ${message.command}`);
      }
      await route(message);
    },
    /** Posts with this command, in order. */
    postsOf: (command: ResponseMessage["command"]) =>
      received.filter((message) => message.command === command)
  };
}
