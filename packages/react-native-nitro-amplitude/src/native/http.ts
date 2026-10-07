import type { HttpClient, SimpleResponse } from "../experiment/types/transport";
import {
  createAmplitudeError,
  getAmplitudeErrorCode,
  parseNativeError,
} from "../errors";
import type { AmplitudeError } from "../errors";
import { assertNetworkEnabled } from "../network";
import { getAmplitudeWorker } from "./hybrid";
import type { AmplitudeWorker } from "../AmplitudeWorker.nitro";

type PendingRequest = {
  resolve: (response: SimpleResponse) => void;
  reject: (error: Error) => void;
};

const DEFAULT_TIMEOUT_MILLIS = 10000;

function createNativeError(
  raw: string,
  cause: unknown,
  message?: string,
): AmplitudeError {
  const parsed = parseNativeError(raw);
  return createAmplitudeError(
    getAmplitudeErrorCode(new Error(raw)),
    message ?? parsed.nativeCode,
    cause,
    parsed,
  );
}

function createRequestId(): string {
  return `req_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export class NitroHttpClient implements HttpClient {
  private readonly pendingRequests = new Map<string, PendingRequest>();
  private listenerInstalled = false;
  private listenerWorker: AmplitudeWorker | undefined;

  private ensureListener(): void {
    const worker = getAmplitudeWorker();
    if (this.listenerInstalled && this.listenerWorker === worker) {
      return;
    }
    this.listenerInstalled = true;
    this.listenerWorker = worker;
    worker.addOnComplete((requestId, statusCode, body, error) => {
      const pending = this.pendingRequests.get(requestId);
      if (!pending) {
        return;
      }
      this.pendingRequests.delete(requestId);
      if (error) {
        pending.reject(createNativeError(error, new Error(error)));
        return;
      }
      pending.resolve({
        status: statusCode,
        body,
      });
    });
  }

  async request(
    requestUrl: string,
    method: string,
    headers: Record<string, string>,
    data: string | null,
    timeoutMillis = DEFAULT_TIMEOUT_MILLIS,
  ): Promise<SimpleResponse> {
    assertNetworkEnabled();
    this.ensureListener();
    const requestId = createRequestId();
    return new Promise<SimpleResponse>((resolve, reject) => {
      this.pendingRequests.set(requestId, { resolve, reject });

      try {
        getAmplitudeWorker().enqueue(
          requestId,
          requestUrl,
          method,
          headers,
          data ?? "",
          timeoutMillis,
        );
      } catch (error) {
        this.pendingRequests.delete(requestId);
        const raw = error instanceof Error ? error.message : String(error);
        reject(createNativeError(raw, error, raw));
      }
    });
  }
}

export const nitroHttpClient = new NitroHttpClient();
