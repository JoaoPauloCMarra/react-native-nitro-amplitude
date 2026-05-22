import type { HttpClient, SimpleResponse } from "../experiment/types/transport";
import { getAmplitudeWorker } from "./hybrid";

type PendingRequest = {
  resolve: (response: SimpleResponse) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

const pendingRequests = new Map<string, PendingRequest>();
let listenerInstalled = false;

function ensureListener(): void {
  if (listenerInstalled) {
    return;
  }
  listenerInstalled = true;
  getAmplitudeWorker().addOnComplete((requestId, statusCode, body, error) => {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      return;
    }
    pendingRequests.delete(requestId);
    clearTimeout(pending.timeoutId);
    if (error) {
      pending.reject(new Error(error));
      return;
    }
    pending.resolve({
      status: statusCode,
      body,
    });
  });
}

function createRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class NitroHttpClient implements HttpClient {
  async request(
    requestUrl: string,
    method: string,
    headers: Record<string, string>,
    data: string | null,
    timeoutMillis = 10000,
  ): Promise<SimpleResponse> {
    ensureListener();
    const requestId = createRequestId();
    return new Promise<SimpleResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(requestId);
        getAmplitudeWorker().cancel(requestId);
        reject(new Error(`Request timed out after ${timeoutMillis}ms`));
      }, timeoutMillis + 250);

      pendingRequests.set(requestId, { resolve, reject, timeoutId });

      try {
        getAmplitudeWorker().enqueue(
          requestId,
          requestUrl,
          method,
          JSON.stringify(headers),
          data ?? "",
          timeoutMillis,
        );
      } catch (error) {
        pendingRequests.delete(requestId);
        clearTimeout(timeoutId);
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }
}

export const nitroHttpClient = new NitroHttpClient();
