jest.mock("react-native", () => ({ Platform: { OS: "web" } }));

import type { Event } from "@amplitude/analytics-core";
import {
  clearDiagnosticFailures,
  getDiagnosticFailures,
} from "../diagnostic-failures";
import {
  createKeyValueAmplitudeStorage,
  type AmplitudeKeyValueStorageFailure,
  type AmplitudeKeyValueStore,
} from "../key-value-storage";

function createMapStore(values = new Map<string, string>()) {
  const store: AmplitudeKeyValueStore = {
    getItem: (key) => values.get(key),
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    removeItemsByPrefix: (prefix) => {
      for (const key of Array.from(values.keys())) {
        if (key.startsWith(prefix)) values.delete(key);
      }
    },
  };
  return { store, values };
}

const diskFull = new Error("[nitro-error:storage_full] disk is full");

function createFailingStore(): AmplitudeKeyValueStore {
  return {
    getItem: () => {
      throw diskFull;
    },
    setItem: () => {
      throw diskFull;
    },
    removeItem: () => {
      throw diskFull;
    },
    removeItemsByPrefix: () => {
      throw diskFull;
    },
  };
}

beforeEach(() => {
  clearDiagnosticFailures();
});

test("stores each surface under the namespaced key layout", async () => {
  const { store, values } = createMapStore();
  const storage = createKeyValueAmplitudeStorage({ store, namespace: "app" });
  const event = { event_type: "opened" } as Event;

  await storage.analytics.storageProvider.set("events", [event]);
  await storage.analytics.cookieStorage.set("session", {
    deviceId: "device-1",
    optOut: false,
  });
  await storage.experiment.storage.put("flag", "on");

  expect(Array.from(values.keys()).sort()).toEqual([
    "app:analytics-events::events",
    "app:analytics-session::session",
    "app:experiment-variants::flag",
  ]);
  await expect(
    storage.analytics.storageProvider.get("events"),
  ).resolves.toEqual([event]);
  await expect(storage.experiment.storage.get("flag")).resolves.toBe("on");
});

test("writes that fail are reported and do not reject", async () => {
  const failures: AmplitudeKeyValueStorageFailure[] = [];
  const storage = createKeyValueAmplitudeStorage({
    store: createFailingStore(),
    onError: (failure) => failures.push(failure),
  });

  await expect(
    storage.analytics.storageProvider.set("events", []),
  ).resolves.toBeUndefined();
  await expect(storage.experiment.storage.put("flag", "on")).resolves.toBe(
    undefined,
  );
  await expect(storage.clear()).resolves.toBeUndefined();

  expect(
    failures.map(({ store, operation }) => `${store}:${operation}`),
  ).toEqual([
    "analytics-events:set",
    "experiment-variants:set",
    "analytics-events:reset",
    "analytics-session:reset",
    "experiment-variants:reset",
  ]);
  expect(failures[0]?.error).toBe(diskFull);
  expect(getDiagnosticFailures()).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        operation: "storage_write",
        surface: "event_storage",
        kind: "storage_error",
      }),
    ]),
  );
});

test("an onError handler that throws does not make writes reject", async () => {
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  const storage = createKeyValueAmplitudeStorage({
    store: createFailingStore(),
    onError: () => {
      throw new Error("logger failed");
    },
  });

  await expect(
    storage.analytics.storageProvider.set("events", []),
  ).resolves.toBeUndefined();
  await expect(storage.analytics.storageProvider.getRaw("events")).rejects.toBe(
    diskFull,
  );
  expect(consoleError).toHaveBeenCalled();
  consoleError.mockRestore();
});

test("reads that fail are reported and still reject", async () => {
  const failures: AmplitudeKeyValueStorageFailure[] = [];
  const storage = createKeyValueAmplitudeStorage({
    store: createFailingStore(),
    onError: (failure) => failures.push(failure),
  });

  await expect(storage.analytics.cookieStorage.get("session")).rejects.toBe(
    diskFull,
  );
  expect(failures).toEqual([
    { store: "analytics-session", operation: "get", error: diskFull },
  ]);
});

test("corrupt JSON is reported, removed and read as empty", async () => {
  const { store, values } = createMapStore(
    new Map([["default:analytics-events::events", "{not json"]]),
  );
  const failures: AmplitudeKeyValueStorageFailure[] = [];
  const storage = createKeyValueAmplitudeStorage({
    store,
    onError: (failure) => failures.push(failure),
  });

  await expect(
    storage.analytics.storageProvider.get("events"),
  ).resolves.toBeUndefined();
  expect(values.size).toBe(0);
  expect(failures.map(({ operation }) => operation)).toEqual(["parse"]);
});

test("experiment variants can live in a separate store", async () => {
  const disk = createMapStore();
  const memory = createMapStore();
  const storage = createKeyValueAmplitudeStorage({
    store: disk.store,
    experimentStore: memory.store,
    namespace: "app",
  });

  await storage.experiment.storage.put("flag", "on");

  expect(disk.values.size).toBe(0);
  expect(memory.values.get("app:experiment-variants::flag")).toBe("on");
});

test("failures without an onError handler go to the console", async () => {
  const consoleError = jest
    .spyOn(console, "error")
    .mockImplementation(() => undefined);
  const storage = createKeyValueAmplitudeStorage({
    store: createFailingStore(),
  });

  await storage.analytics.storageProvider.set("events", []);

  expect(consoleError).toHaveBeenCalledWith(
    expect.stringContaining("analytics-events set failed"),
  );
  consoleError.mockRestore();
});
