import type { ReactNativeTrackingOptions } from "@amplitude/analytics-core";
import { getAmplitudeContext } from "./hybrid";

export type NativeApplicationContext = {
  version?: string;
  platform?: string;
  language?: string;
  country?: string;
  osName?: string;
  osVersion?: string;
  deviceBrand?: string;
  deviceManufacturer?: string;
  deviceModel?: string;
  carrier?: string;
  adid?: string;
  appSetId?: string;
  idfv?: string;
};

export type LegacySessionData = {
  deviceId?: string;
  userId?: string;
  sessionId?: number;
  lastEventTime?: number;
  lastEventId?: number;
};

export function prefetchNativeContext(): void {
  getAmplitudeContext().prefetch();
}

export function getNativeApplicationContext(
  options: ReactNativeTrackingOptions,
): NativeApplicationContext {
  const json = getAmplitudeContext().getApplicationContextJson(
    JSON.stringify(options),
  );
  if (!json) {
    return {};
  }
  try {
    return JSON.parse(json) as NativeApplicationContext;
  } catch {
    return {};
  }
}

export function getLegacySessionData(instanceName: string): LegacySessionData {
  const json = getAmplitudeContext().getLegacySessionDataJson(instanceName);
  if (!json) {
    return {};
  }
  try {
    return JSON.parse(json) as LegacySessionData;
  } catch {
    return {};
  }
}

export function getLegacyEvents(
  instanceName: string,
  eventKind: string,
): string[] {
  return getAmplitudeContext().getLegacyEventsJson(instanceName, eventKind);
}

export function removeLegacyEvent(
  instanceName: string,
  eventKind: string,
  eventId: number,
): void {
  getAmplitudeContext().removeLegacyEvent(instanceName, eventKind, eventId);
}
