import type { ReactNativeTrackingOptions } from "@amplitude/analytics-core";
import UAParser from "@amplitude/ua-parser-js";
import type { NativeApplicationContext } from "./context";

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
  const userAgent =
    typeof navigator !== "undefined" && navigator.userAgent
      ? navigator.userAgent
      : undefined;
  const uaResult = new UAParser(userAgent).getResult();
  const context: NativeApplicationContext = {
    platform: "Web",
    language: browserNavigator?.language ?? browserNavigator?.userLanguage,
  };
  if (uaResult.os.name) {
    context.osName = uaResult.os.name;
  }
  if (uaResult.os.version) {
    context.osVersion = uaResult.os.version;
  }
  if (uaResult.device.vendor) {
    context.deviceManufacturer = uaResult.device.vendor;
  }
  if (uaResult.device.model) {
    context.deviceModel = uaResult.device.model;
  }
  return context;
}
