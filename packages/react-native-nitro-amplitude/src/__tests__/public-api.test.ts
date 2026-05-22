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
import {
  NitroAnalyticsStorage as WebAnalyticsStorage,
  NitroExperimentStorage as WebExperimentStorage,
  NitroMemoryStorage as WebMemoryStorage,
} from "../native/storage.web";
import {
  getLegacyEvents as getWebLegacyEvents,
  getLegacySessionData as getWebLegacySessionData,
  getNativeApplicationContext as getWebApplicationContext,
  prefetchNativeContext as prefetchWebNativeContext,
  removeLegacyEvent as removeWebLegacyEvent,
} from "../native/context.web";
import { nitroHttpClient as webNitroHttpClient } from "../native/http.web";

type ConnectorGlobal = typeof globalThis & {
  analyticsConnectorInstances?: unknown;
};

describe("react-native-nitro-amplitude", () => {
  beforeEach(() => {
    jest.useRealTimers();
    (globalThis as ConnectorGlobal).analyticsConnectorInstances = undefined;
    mockMemory.clear();
    mockDisk.clear();
    for (const key of Object.keys(mockHybridObjects)) {
      delete mockHybridObjects[key];
    }
    resetHybridInstancesForTests();
  });

  it("exports VERSION", () => {
    expect(VERSION).toBe("0.2.0");
  });

  it("exports analytics and experiment factories", () => {
    expect(typeof createInstance).toBe("function");
    expect(typeof Experiment.initialize).toBe("function");
    expect(typeof Experiment.initializeWithAmplitudeAnalytics).toBe("function");
  });

  it("shares named analytics identity with named experiment clients", async () => {
    const analytics = createInstance();
    await analytics.init("analytics-key", "named-user", {
      instanceName: "named",
    }).promise;

    const experiment = Experiment.initializeWithAmplitudeAnalytics(
      "deployment-key",
      {
        instanceName: "named",
      },
    );

    await expect(experiment.getUserProvider().getUser()).resolves.toMatchObject(
      {
        user_id: "named-user",
        device_id: analytics.getDeviceId(),
      },
    );

    analytics.shutdown();
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

  it("provides web storage and context fallbacks without Nitro", async () => {
    const analytics = new WebAnalyticsStorage<{ value: string }>("web");
    const disk = new WebExperimentStorage("web-experiment");
    const experiment = new WebMemoryStorage("web-experiment");

    await analytics.set("event", { value: "queued" });
    await disk.put("variant", "disk-on");
    await experiment.put("variant", "on");

    expect(await analytics.get("event")).toEqual({ value: "queued" });
    expect(await disk.get("variant")).toBe("disk-on");
    expect(await experiment.get("variant")).toBe("on");
    expect(getWebApplicationContext({ platform: true }).platform).toBe("Web");
    expect(getWebLegacySessionData("default")).toEqual({});
    expect(getWebLegacyEvents("default", "events")).toEqual([]);
    expect(prefetchWebNativeContext()).toBeUndefined();
    expect(removeWebLegacyEvent("default", "events", 1)).toBeUndefined();

    await analytics.reset();
    await disk.reset();
    await experiment.reset();

    expect(await analytics.get("event")).toBeUndefined();
    expect(await disk.get("variant")).toBeNull();
    expect(await experiment.get("variant")).toBeNull();
  });

  it("uses browser storage and fetch for web fallbacks", async () => {
    const values = new Map<string, string>();
    const originalLocalStorage = globalThis.localStorage;
    const originalFetch = globalThis.fetch;

    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        get length() {
          return values.size;
        },
        key: (index: number) => Array.from(values.keys())[index] ?? null,
        getItem: (key: string) => values.get(key) ?? null,
        setItem: (key: string, value: string) => {
          values.set(key, value);
        },
        removeItem: (key: string) => {
          values.delete(key);
        },
      },
    });
    globalThis.fetch = jest.fn(async () => ({
      status: 202,
      text: async () => "accepted",
    })) as unknown as typeof fetch;

    try {
      const analytics = new WebAnalyticsStorage<{ value: string }>("persisted");
      const experiment = new WebExperimentStorage("persisted");

      await analytics.set("event", { value: "stored" });
      await experiment.put("flag", "enabled");

      expect(await analytics.get("event")).toEqual({ value: "stored" });
      expect(await experiment.get("flag")).toBe("enabled");
      await expect(
        webNitroHttpClient.request(
          "https://example.com/variants",
          "POST",
          { authorization: "redacted" },
          null,
          1000,
        ),
      ).resolves.toEqual({ status: 202, body: "accepted" });

      expect(globalThis.fetch).toHaveBeenCalledWith(
        "https://example.com/variants",
        expect.objectContaining({
          method: "POST",
          headers: { authorization: "redacted" },
          body: "",
        }),
      );

      await analytics.reset();

      expect(values.size).toBe(0);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalLocalStorage,
      });
      globalThis.fetch = originalFetch;
    }
  });
});
