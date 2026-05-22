const mockMemory = new Map<string, string>();
const mockDisk = new Map<string, string>();
const mockHybridObjects: Record<string, Record<string, jest.Mock>> = {};

function createStorageHybrid() {
  const selectStore = (persist: boolean) => (persist ? mockDisk : mockMemory);
  return {
    set: jest.fn((key: string, value: string, persist: boolean) => {
      selectStore(persist).set(key, value);
    }),
    get: jest.fn((key: string, persist: boolean) => {
      return selectStore(persist).get(key);
    }),
    remove: jest.fn((key: string, persist: boolean) => {
      selectStore(persist).delete(key);
    }),
    clear: jest.fn((persist: boolean) => {
      selectStore(persist).clear();
    }),
    has: jest.fn((key: string, persist: boolean) => {
      return selectStore(persist).has(key);
    }),
    getAllKeys: jest.fn((persist: boolean) => {
      return Array.from(selectStore(persist).keys());
    }),
    getKeysByPrefix: jest.fn((prefix: string, persist: boolean) => {
      return Array.from(selectStore(persist).keys()).filter((key) =>
        key.startsWith(prefix),
      );
    }),
    setBatch: jest.fn((keys: string[], values: string[], persist: boolean) => {
      keys.forEach((key, index) => {
        selectStore(persist).set(key, values[index] ?? "");
      });
    }),
    getBatch: jest.fn((keys: string[], persist: boolean) => {
      return keys.map(
        (key) =>
          selectStore(persist).get(key) ??
          "__nitro_amplitude_batch_missing__::v1",
      );
    }),
    removeBatch: jest.fn((keys: string[], persist: boolean) => {
      keys.forEach((key) => selectStore(persist).delete(key));
    }),
  };
}

function createContextHybrid() {
  return {
    prefetch: jest.fn(),
    getApplicationContextJson: jest.fn(() =>
      JSON.stringify({ platform: "iOS", version: "1.0.0" }),
    ),
    getLegacySessionDataJson: jest.fn(() =>
      JSON.stringify({
        deviceId: "legacy-device",
        userId: "legacy-user",
        sessionId: 123,
      }),
    ),
    getLegacyEventsJson: jest.fn(() => ["event-one", "event-two"]),
    removeLegacyEvent: jest.fn(),
  };
}

function createWorkerHybrid() {
  const listeners = new Set<
    (requestId: string, statusCode: number, body: string, error: string) => void
  >();
  return {
    enqueue: jest.fn(
      (
        requestId: string,
        _url: string,
        _method: string,
        _headersJson: string,
        body: string,
      ) => {
        setTimeout(() => {
          listeners.forEach((listener) =>
            listener(
              requestId,
              200,
              JSON.stringify({ ok: true, echoedBody: body }),
              "",
            ),
          );
        }, 0);
      },
    ),
    cancel: jest.fn((requestId: string) => {
      listeners.forEach((listener) => listener(requestId, 0, "", "cancelled"));
    }),
    addOnComplete: jest.fn((callback) => {
      listeners.add(callback);
      return jest.fn(() => listeners.delete(callback));
    }),
    queueSize: jest.fn(() => 0),
  };
}

jest.mock("react-native-nitro-modules", () => ({
  NitroModules: {
    createHybridObject: jest.fn((name: string) => {
      const hybrid =
        name === "AmplitudeContext"
          ? createContextHybrid()
          : name === "AmplitudeStorage"
            ? createStorageHybrid()
            : createWorkerHybrid();
      mockHybridObjects[name] = hybrid;
      return hybrid;
    }),
  },
}));

jest.mock("react-native", () => ({
  Platform: { OS: "ios" },
  AppState: {
    currentState: "active",
    addEventListener: jest.fn(() => ({ remove: jest.fn() })),
  },
  NativeModules: {},
}));

import {
  VERSION,
  Experiment,
  createInstance,
  prefetchNativeContext,
  nitroHttpClient,
} from "../index";
import * as AnalyticsCompat from "../analytics";
import * as ExperimentCompat from "../experiment";
import {
  getLegacyEvents,
  getLegacySessionData,
  getNativeApplicationContext,
  removeLegacyEvent,
} from "../native/context";
import { resetHybridInstancesForTests } from "../native/hybrid";
import {
  NitroAnalyticsStorage,
  NitroExperimentStorage,
  NitroMemoryStorage,
} from "../native/storage";

describe("react-native-nitro-amplitude", () => {
  beforeEach(() => {
    jest.useRealTimers();
    mockMemory.clear();
    mockDisk.clear();
    for (const key of Object.keys(mockHybridObjects)) {
      delete mockHybridObjects[key];
    }
    resetHybridInstancesForTests();
  });

  it("exports VERSION", () => {
    expect(VERSION).toBe("0.1.0");
  });

  it("exports analytics and experiment factories", () => {
    expect(typeof createInstance).toBe("function");
    expect(typeof Experiment.initialize).toBe("function");
    expect(typeof Experiment.initializeWithAmplitudeAnalytics).toBe("function");
  });

  it("keeps analytics and experiment compatibility subpaths", () => {
    expect(typeof AnalyticsCompat.init).toBe("function");
    expect(typeof AnalyticsCompat.track).toBe("function");
    expect(typeof AnalyticsCompat.createInstance).toBe("function");
    expect(typeof ExperimentCompat.Experiment.initialize).toBe("function");
    expect(typeof ExperimentCompat.ExperimentClient).toBe("function");
  });

  it("reads native context and legacy migration hooks through Nitro", () => {
    prefetchNativeContext();
    const context = getNativeApplicationContext({
      platform: true,
      language: true,
      osName: true,
      osVersion: true,
      deviceManufacturer: true,
      deviceModel: true,
      adid: false,
      carrier: false,
      ipAddress: false,
      appSetId: false,
      idfv: false,
      country: false,
    });
    const legacy = getLegacySessionData("example");
    const events = getLegacyEvents("example", "events");
    removeLegacyEvent("example", "events", 1);

    expect(context.platform).toBe("iOS");
    expect(legacy.deviceId).toBe("legacy-device");
    expect(events).toEqual(["event-one", "event-two"]);
    expect(
      mockHybridObjects.AmplitudeContext?.removeLegacyEvent,
    ).toHaveBeenCalledWith("example", "events", 1);
  });

  it("stores analytics values in Nitro disk storage with namespace reset", async () => {
    const storage = new NitroAnalyticsStorage<{ enabled: boolean }>(
      "analytics",
    );

    await storage.set("config", { enabled: true });
    await storage.set("other", { enabled: false });

    expect(await storage.get("config")).toEqual({ enabled: true });
    expect(await storage.getRaw("config")).toBe('{"enabled":true}');

    await storage.reset();

    expect(await storage.get("config")).toBeUndefined();
    expect(await storage.get("other")).toBeUndefined();
  });

  it("isolates experiment disk and memory storage namespaces", async () => {
    const disk = new NitroExperimentStorage("experiment");
    const memory = new NitroMemoryStorage("experiment");

    await disk.put("flag", "disk-on");
    await memory.put("flag", "memory-on");

    expect(await disk.get("flag")).toBe("disk-on");
    expect(await memory.get("flag")).toBe("memory-on");

    await memory.reset();

    expect(await disk.get("flag")).toBe("disk-on");
    expect(await memory.get("flag")).toBeNull();
  });

  it("bridges Nitro HTTP requests through the worker", async () => {
    jest.useFakeTimers();

    const request = nitroHttpClient.request(
      "https://example.com",
      "POST",
      { authorization: "redacted" },
      '{"event":"demo"}',
      1000,
    );

    await jest.runOnlyPendingTimersAsync();
    await expect(request).resolves.toEqual({
      status: 200,
      body: '{"ok":true,"echoedBody":"{\\"event\\":\\"demo\\"}"}',
    });
    expect(mockHybridObjects.AmplitudeWorker?.enqueue).toHaveBeenCalledWith(
      expect.stringMatching(/^req_/),
      "https://example.com",
      "POST",
      '{"authorization":"redacted"}',
      '{"event":"demo"}',
      1000,
    );
  });
});
