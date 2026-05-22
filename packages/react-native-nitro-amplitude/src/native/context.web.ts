import type { ReactNativeTrackingOptions } from "@amplitude/analytics-core";
import type { LegacySessionData, NativeApplicationContext } from "./context";

type NavigatorWithLanguage = Navigator & {
  userLanguage?: string;
};

export function prefetchNativeContext(): void {}

export function getNativeApplicationContext(
  _options: ReactNativeTrackingOptions,
): NativeApplicationContext {
  const browserNavigator =
    typeof navigator === "undefined"
      ? undefined
      : (navigator as NavigatorWithLanguage);
  return {
    platform: "Web",
    language: browserNavigator?.language ?? browserNavigator?.userLanguage,
  };
}

export function getLegacySessionData(_instanceName: string): LegacySessionData {
  return {};
}

export function getLegacyEvents(
  _instanceName: string,
  _eventKind: string,
): string[] {
  return [];
}

export function removeLegacyEvent(
  _instanceName: string,
  _eventKind: string,
  _eventId: number,
): void {}
