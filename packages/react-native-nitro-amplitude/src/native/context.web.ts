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
  const osName = uaResult.os.name || uaResult.browser.name;
  if (osName) {
    context.osName = osName;
  }
  const osVersion = uaResult.os.version || uaResult.browser.version;
  if (osVersion) {
    context.osVersion = osVersion;
  }
  if (uaResult.device.vendor) {
    context.deviceManufacturer = uaResult.device.vendor;
  }
  const deviceModel = uaResult.device.model || uaResult.os.name;
  if (deviceModel) {
    context.deviceModel = deviceModel;
  }
  return context;
}
