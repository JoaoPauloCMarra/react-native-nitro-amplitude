jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
jest.mock("../native/context", () => ({
  EXPERIMENT_CONTEXT_OPTIONS: {},
  getNativeApplicationContext: () => ({}),
}));

import type { Storage } from "@amplitude/analytics-core";
import { useReactNativeConfig } from "../analytics/config";
import { parseOldCookies } from "../analytics/cookie-migration";

function createFailingReadStorage<T>(): Storage<T> {
  const readFailure = new Error(
    "[nitro-error:storage_full] NitroStorage: Disk SQLite exec failed: disk I/O error",
  );
  return {
    isEnabled: async () => true,
    get: async () => {
      throw readFailure;
    },
    getRaw: async () => {
      throw readFailure;
    },
    set: async () => undefined,
    remove: async () => undefined,
    reset: async () => undefined,
  };
}

test("old cookie migration treats an unreadable cookie store as empty", async () => {
  await expect(
    parseOldCookies("api-key", {
      cookieStorage: createFailingReadStorage(),
      disableCookies: true,
    }),
  ).resolves.toEqual({ optOut: false });
});

test("config resolution starts a fresh session when the stored session is unreadable", async () => {
  const config = await useReactNativeConfig("api-key", {
    cookieStorage: createFailingReadStorage(),
    disableCookies: true,
  });

  expect(config.deviceId).toEqual(expect.any(String));
  expect(config.optOut).toBe(false);
  expect(config.sessionId).toBeUndefined();
});
