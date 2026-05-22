import { type HybridObject } from "react-native-nitro-modules";

export interface AmplitudeWorker extends HybridObject<{
  ios: "c++";
  android: "c++";
}> {
  enqueue(
    requestId: string,
    url: string,
    method: string,
    headersJson: string,
    body: string,
    timeoutMillis: number,
  ): void;
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
}
