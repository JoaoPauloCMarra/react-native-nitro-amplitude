import { type HybridObject } from "react-native-nitro-modules";

export interface AmplitudeContext extends HybridObject<{
  ios: "c++";
  android: "c++";
}> {
  /** Warm native device context caches off the UI-critical path. */
  prefetch(): void;
  /**
   * Returns JSON-encoded application context for analytics/experiment
   * targeting. The payload stays JSON on purpose: it is a one-shot call whose
   * fields vary by platform, and JS consumes it via `JSON.parse` anyway.
   */
  getApplicationContextJson(optionsJson: string): string;
  /**
   * Returns JSON-encoded legacy SDK session data for migration.
   * Currently a stub on both platforms: returns `"{}"` because legacy
   * Amplitude SQLite databases are not read yet. See
   * `getNativeStartupDiagnostics().legacyMigrationSupported`.
   */
  getLegacySessionDataJson(instanceName: string): string;
  /**
   * Returns JSON-encoded legacy queued events for migration.
   * Currently a stub on both platforms: returns an empty list (see
   * `getLegacySessionDataJson`).
   */
  getLegacyEventsJson(instanceName: string, eventKind: string): string[];
  /** Removes a migrated legacy event after successful upload. */
  removeLegacyEvent(
    instanceName: string,
    eventKind: string,
    eventId: number,
  ): void;
}
