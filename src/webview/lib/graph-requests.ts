import type { GraphQueryCommand } from "@/backend/types";
import { selectedRepo } from "@/webview/lib/stores";

type RequestIdentity = { repo: string; requestId: string };
const pending = new Map<GraphQueryCommand, RequestIdentity>();
let nextRequest = 0;

export function startGraphRequest(command: GraphQueryCommand, repo: string): string {
  const requestId = `graph-${++nextRequest}`;
  pending.set(command, { repo, requestId });
  return requestId;
}

export function invalidateGraphRequest(command: GraphQueryCommand): void {
  pending.delete(command);
}

export function resetGraphRequests(): void {
  pending.clear();
}

/** Consume only the latest reply, including errors, for this view and repository. */
export function acceptGraphResponse(message: RequestIdentity & { command: GraphQueryCommand }) {
  const request = pending.get(message.command);
  if (
    request === undefined ||
    message.requestId !== request.requestId ||
    message.repo !== request.repo ||
    message.repo !== selectedRepo.value
  ) {
    return false;
  }
  pending.delete(message.command);
  return true;
}
