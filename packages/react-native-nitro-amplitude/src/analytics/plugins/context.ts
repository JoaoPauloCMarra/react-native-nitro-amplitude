import {
  BeforePlugin,
  ReactNativeConfig,
  Event,
  ReactNativeTrackingOptions,
  UUID,
  getLanguage,
} from "@amplitude/analytics-core";
import UAParser from "@amplitude/ua-parser-js";
import { VERSION } from "../version";
import { Platform } from "react-native";
import { getNativeApplicationContext } from "../../native/context";

const BROWSER_PLATFORM = "Web";
const IP_ADDRESS = "$remote";
const ReactNativePlatform = Platform;

function getPlatformOS(): string | undefined {
  try {
    return ReactNativePlatform?.OS;
  } catch {
    return undefined;
  }
}

function getNativePlatformName(platformOS = getPlatformOS()): string {
  switch (platformOS) {
    case "ios":
      return "iOS";
    case "android":
      return "Android";
    default:
      return BROWSER_PLATFORM;
  }
}

type NativeContext = {
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

export class Context implements BeforePlugin {
  name = "@amplitude/plugin-context-react-native";
  type = "before" as const;

  // this.config is defined in setup() which will always be called first

  // @ts-ignore
  config: ReactNativeConfig;
  uaResult: UAParser.IResult;
  library = `amplitude-nitro-ts/${VERSION}`;

  constructor() {
    let agent: string | undefined;
    /* istanbul ignore else */
    if (typeof navigator !== "undefined") {
      agent = navigator.userAgent;
    }

    this.uaResult = new UAParser(agent).getResult();
  }

  setup(config: ReactNativeConfig): Promise<undefined> {
    this.config = config;
    return Promise.resolve(undefined);
  }

  private getNativeContext(): NativeContext | undefined {
    try {
      return getNativeApplicationContext(this.config.trackingOptions);
    } catch (error) {
      this.config.loggerProvider?.error(
        `Failed to load native application context: ${String(error)}`,
      );
      return undefined;
    }
  }

  async execute(context: Event): Promise<Event> {
    const time = new Date().getTime();
    const platformOS = getPlatformOS();
    const nativeContext = this.getNativeContext();
    const isWebPlatform = platformOS === "web";
    const fallbackPlatform = getNativePlatformName(platformOS);
    const appVersion = this.config.appVersion || nativeContext?.version;
    const platform = nativeContext?.platform || fallbackPlatform;

    const osName =
      nativeContext?.osName ||
      (isWebPlatform ? this.uaResult.browser.name : fallbackPlatform);

    const osVersion =
      nativeContext?.osVersion ||
      (isWebPlatform ? this.uaResult.browser.version : undefined);

    const deviceVendor =
      nativeContext?.deviceManufacturer ||
      (isWebPlatform ? this.uaResult.device.vendor : undefined);

    const deviceModel =
      nativeContext?.deviceModel ||
      (isWebPlatform
        ? this.uaResult.device.model || this.uaResult.os.name
        : undefined);
    const language = nativeContext?.language || getLanguage();
    const country = nativeContext?.country;
    const carrier = nativeContext?.carrier;
    const adid = nativeContext?.adid;
    const appSetId = nativeContext?.appSetId;
    const idfv = nativeContext?.idfv;

    const event: Event = {
      user_id: this.config.userId,
      device_id: this.config.deviceId,
      session_id: this.config.sessionId,
      time,
      ...(appVersion && { app_version: appVersion }),
      ...(this.config.trackingOptions.platform && { platform: platform }),

      ...(this.config.trackingOptions.osName && { os_name: osName }),

      ...(this.config.trackingOptions.osVersion && { os_version: osVersion }),

      ...(this.config.trackingOptions.deviceManufacturer && {
        device_manufacturer: deviceVendor,
      }),

      ...(this.config.trackingOptions.deviceModel && {
        device_model: deviceModel,
      }),

      ...(this.config.trackingOptions.language && { language: language }),
      ...(this.config.trackingOptions.country && { country: country }),
      ...(this.config.trackingOptions.carrier && { carrier: carrier }),
      ...(this.config.trackingOptions.ipAddress && { ip: IP_ADDRESS }),
      ...(this.config.trackingOptions.adid && { adid: adid }),
      ...(this.config.trackingOptions.appSetId && {
        android_app_set_id: appSetId,
      }),
      ...(this.config.trackingOptions.idfv && { idfv: idfv }),
      insert_id: UUID(),
      partner_id: this.config.partnerId,
      plan: this.config.plan,
      ...(this.config.ingestionMetadata && {
        ingestion_metadata: {
          source_name: this.config.ingestionMetadata.sourceName,
          source_version: this.config.ingestionMetadata.sourceVersion,
        },
      }),
      ...context,
      library: this.library,
    };
    return event;
  }
}
