import { type HybridObject } from "react-native-nitro-modules";

export interface AmplitudeContext extends HybridObject<{
  ios: "c++";
  android: "c++";
}> {
  /** Warm native device context caches off the UI-critical path. */
  prefetch(): void;
  /** Returns JSON-encoded application context for analytics/experiment targeting. */
  getApplicationContextJson(optionsJson: string): string;
  /** Returns JSON-encoded legacy SDK session data for migration. */
  getLegacySessionDataJson(instanceName: string): string;
  /** Returns JSON-encoded legacy queued events for migration. */
  getLegacyEventsJson(instanceName: string, eventKind: string): string[];
  /** Removes a migrated legacy event after successful upload. */
  removeLegacyEvent(
    instanceName: string,
    eventKind: string,
    eventId: number,
  ): void;
}
