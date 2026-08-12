import { type HybridObject } from "react-native-nitro-modules";

export interface AmplitudeWorker extends HybridObject<{
  ios: "c++";
  android: "c++";
}> {
  enqueue(
    requestId: string,
    url: string,
    method: string,
    headers: Record<string, string>,
    body: string,
    timeoutMillis: number,
  ): void;
  /**
   * Cancels a request that is still queued. Requests already handed to the
   * platform HTTP layer are not interrupted; they settle within their timeout
   * and their completion callback still fires.
   */
  cancel(requestId: string): void;
  addOnComplete(
    callback: (
      requestId: string,
      statusCode: number,
      body: string,
      error: string,
    ) => void,
  ): () => void;
  queueSize(): number;
  /** Number of requests currently being executed by the HTTP worker threads. */
  inFlightCount(): number;
  /** Bytes of request bodies and headers currently waiting in the queue. */
  pendingBodyBytes(): number;
}
