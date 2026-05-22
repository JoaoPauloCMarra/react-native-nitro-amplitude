import {
  UserSession,
  ReactNativeOptions,
  getOldCookieName,
} from "@amplitude/analytics-core";
import {
  createCookieStorage,
  getDefaultConfig,
  getTopLevelDomain,
} from "../config";

export const parseOldCookies = async (
  apiKey: string,
  options?: ReactNativeOptions,
): Promise<UserSession> => {
  const disableCookies =
    options?.disableCookies ?? getDefaultConfig().disableCookies;
  const storage = await createCookieStorage<string>({
    ...options,
    disableCookies,
    domain: disableCookies
      ? ""
      : (options?.domain ?? (await getTopLevelDomain())),
  });
  const oldCookieName = getOldCookieName(apiKey);
  const cookies = await storage.getRaw(oldCookieName);

  if (!cookies) {
    return {
      optOut: false,
    };
  }

  if (options?.cookieUpgrade ?? getDefaultConfig().cookieUpgrade) {
    await storage.remove(oldCookieName);
  }
  const [deviceId, userId, optOut, sessionId, lastEventTime] =
    cookies.split(".");
  return {
    deviceId,
    userId: decode(userId ?? ""),
    sessionId: parseTime(sessionId),
    lastEventTime: parseTime(lastEventTime),
    optOut: parseOptOut(optOut),
  };
};

export const parseTime = (num: string) => {
  const integer = parseInt(num, 32);
  if (isNaN(integer)) {
    return undefined;
  }
  return integer;
};

export const decode = (value?: string): string | undefined => {
  if (typeof atob !== "function" || typeof escape !== "function" || !value) {
    return undefined;
  }
  try {
    return decodeURIComponent(escape(atob(value)));
  } catch {
    return undefined;
  }
};

export const parseOptOut = (value?: string): boolean => {
  return value === "1" || value === "true";
};
