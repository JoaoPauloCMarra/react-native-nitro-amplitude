import { type HybridObject } from "react-native-nitro-modules";

export interface AmplitudeContext extends HybridObject<{
  ios: "c++";
  android: "c++";
}> {
  /** Warm native device context caches off the UI-critical path. */
  prefetch(): void;
  /**
   * Returns JSON-encoded application context for analytics/experiment
   * targeting. Missing values are serialized as empty strings. The payload
   * stays JSON on purpose: it is a one-shot call whose fields vary by
   * platform, and JS consumes it via `JSON.parse` anyway.
   */
  getApplicationContextJson(optionsJson: string): string;
  getLegacySessionDataJson(instanceName: string): string;
  getLegacyEventsJson(instanceName: string, eventKind: string): string[];
  removeLegacyEvent(
    instanceName: string,
    eventKind: string,
    eventId: number,
  ): void;
}
