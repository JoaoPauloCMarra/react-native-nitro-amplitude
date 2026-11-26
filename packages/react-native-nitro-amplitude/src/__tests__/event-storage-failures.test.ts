jest.mock("react-native", () => ({ Platform: { OS: "web" } }));
jest.mock("../native/context", () => ({
  EXPERIMENT_CONTEXT_OPTIONS: {},
  getNativeApplicationContext: () => ({}),
}));

import { LogLevel } from "@amplitude/analytics-core";
import type { Event, Logger, Storage } from "@amplitude/analytics-core";
import { useReactNativeConfig } from "../analytics/config";
import { getDiagnosticFailures } from "../diagnostic-failures";

const writeFailure = new Error(
  "Storage.set(...): NitroStorage: Disk SQLite set failed: database or disk is full",
);

function createFailingWriteStorage(): Storage<Event[]> {
  return {
    isEnabled: async () => true,
    get: async () => undefined,
    getRaw: async () => undefined,
    set: async () => {
      throw writeFailure;
    },
    remove: async () => {
      throw writeFailure;
    },
    reset: async () => undefined,
  };
}

function createLogger(): Logger & { error: jest.Mock } {
  return {
    logLevel: LogLevel.Error,
    disable: jest.fn(),
    enable: jest.fn(),
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}

test("a failing event store write is logged instead of rejecting", async () => {
  const loggerProvider = createLogger();
  const config = await useReactNativeConfig("api-key", {
    storageProvider: createFailingWriteStorage(),
    loggerProvider,
    disableCookies: true,
  });

  await expect(
    config.storageProvider?.set("events", []),
  ).resolves.toBeUndefined();
  await expect(
    config.storageProvider?.remove("events"),
  ).resolves.toBeUndefined();
  expect(loggerProvider.error).toHaveBeenCalledTimes(2);
  expect(getDiagnosticFailures()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        operation: "storage_write",
        surface: "event_storage",
      }),
    ]),
  );
  expect(String(loggerProvider.error.mock.calls[0]?.[0])).toContain(
    "database or disk is full",
  );
});

test("a store that throws before returning a promise is logged instead of throwing", async () => {
  const loggerProvider = createLogger();
  const storageProvider = {
    ...createFailingWriteStorage(),
    set: () => {
      throw writeFailure;
    },
    remove: () => undefined,
  } as unknown as Storage<Event[]>;
  const config = await useReactNativeConfig("api-key", {
    storageProvider,
    loggerProvider,
    disableCookies: true,
  });

  await expect(
    config.storageProvider?.set("events", []),
  ).resolves.toBeUndefined();
  await expect(
    config.storageProvider?.remove("events"),
  ).resolves.toBeUndefined();
  expect(loggerProvider.error).toHaveBeenCalledTimes(1);
});

test("a working event store keeps its values", async () => {
  const values = new Map<string, Event[]>();
  const storageProvider: Storage<Event[]> = {
    isEnabled: async () => true,
    get: async (key) => values.get(key),
    getRaw: async (key) => JSON.stringify(values.get(key)),
    set: async (key, value) => {
      values.set(key, value);
    },
    remove: async (key) => {
      values.delete(key);
    },
    reset: async () => {
      values.clear();
    },
  };
  const config = await useReactNativeConfig("api-key", {
    storageProvider,
    disableCookies: true,
  });
  const event = { event_type: "opened" } as Event;

  await config.storageProvider?.set("events", [event]);

  await expect(config.storageProvider?.get("events")).resolves.toEqual([event]);
});
