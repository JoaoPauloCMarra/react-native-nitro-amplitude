import type { HttpClient, SimpleResponse } from "../experiment/types/transport";
import { createAmplitudeError, getAmplitudeErrorCode } from "../errors";
import { assertNetworkEnabled } from "../network";
import { getAmplitudeWorker } from "./hybrid";
import type { AmplitudeWorker } from "../AmplitudeWorker.nitro";

type PendingRequest = {
  resolve: (response: SimpleResponse) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
};

const pendingRequests = new Map<string, PendingRequest>();
let listenerInstalled = false;
let listenerWorker: AmplitudeWorker | undefined;
const DEFAULT_TIMEOUT_MILLIS = 10000;
const MAX_TIMEOUT_MILLIS = 300000;

function ensureListener(): void {
  const worker = getAmplitudeWorker();
  if (listenerInstalled && listenerWorker === worker) {
    return;
  }
  listenerInstalled = true;
  listenerWorker = worker;
  worker.addOnComplete((requestId, statusCode, body, error) => {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      return;
    }
    pendingRequests.delete(requestId);
    clearTimeout(pending.timeoutId);
    if (error) {
      pending.reject(
        createAmplitudeError(getAmplitudeErrorCode(new Error(error)), error),
      );
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

function normalizeTimeoutMillis(timeoutMillis: number): number {
  if (!Number.isFinite(timeoutMillis) || timeoutMillis <= 0) {
    return DEFAULT_TIMEOUT_MILLIS;
  }
  return Math.min(Math.ceil(timeoutMillis), MAX_TIMEOUT_MILLIS);
}

export class NitroHttpClient implements HttpClient {
  async request(
    requestUrl: string,
    method: string,
    headers: Record<string, string>,
    data: string | null,
    timeoutMillis = DEFAULT_TIMEOUT_MILLIS,
  ): Promise<SimpleResponse> {
    assertNetworkEnabled();
    ensureListener();
    const requestId = createRequestId();
    const normalizedTimeoutMillis = normalizeTimeoutMillis(timeoutMillis);
    return new Promise<SimpleResponse>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingRequests.delete(requestId);
        getAmplitudeWorker().cancel(requestId);
        reject(
          createAmplitudeError(
            "timeout",
            `Request timed out after ${normalizedTimeoutMillis}ms`,
          ),
        );
      }, normalizedTimeoutMillis + 250);

      pendingRequests.set(requestId, { resolve, reject, timeoutId });

      try {
        getAmplitudeWorker().enqueue(
          requestId,
          requestUrl,
          method,
          JSON.stringify(headers),
          data ?? "",
          normalizedTimeoutMillis,
        );
      } catch (error) {
        pendingRequests.delete(requestId);
        clearTimeout(timeoutId);
        reject(
          createAmplitudeError(
            getAmplitudeErrorCode(error),
            error instanceof Error ? error.message : String(error),
            error,
          ),
        );
      }
    });
  }
}

export const nitroHttpClient = new NitroHttpClient();
