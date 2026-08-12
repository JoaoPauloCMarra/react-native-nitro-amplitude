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

export const EXPERIMENT_CONTEXT_OPTIONS: ReactNativeTrackingOptions = {
  adid: true,
  carrier: true,
  deviceManufacturer: true,
  deviceModel: true,
  ipAddress: false,
  language: true,
  osName: true,
  osVersion: true,
  platform: true,
  appSetId: true,
  idfv: true,
  country: true,
};

export function prefetchNativeContext(): void {
  const context = getAmplitudeContext();
  context.prefetch();
  context.getApplicationContextJson(JSON.stringify(EXPERIMENT_CONTEXT_OPTIONS));
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
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const context: NativeApplicationContext = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string") {
        context[key as keyof NativeApplicationContext] = value;
      } else if (value === null) {
        context[key as keyof NativeApplicationContext] = "";
      }
    }
    return context;
  } catch {
    return {};
  }
}
