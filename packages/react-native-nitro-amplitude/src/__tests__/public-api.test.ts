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
        url: string,
        _method: string,
        _headersJson: string,
        body: string,
      ) => {
        setTimeout(() => {
          const responseBody = url.includes("amplitude.com")
            ? JSON.stringify({
                code: 200,
                events_ingested: 1,
                payload_size_bytes: body.length,
                server_upload_time: 1,
              })
            : JSON.stringify({ ok: true, echoedBody: body });
          listeners.forEach((listener) =>
            listener(requestId, 200, responseBody, ""),
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

import type { Payload, Response, Transport } from "@amplitude/analytics-core";
import { Status } from "@amplitude/analytics-core";
import { NetworkGuardedFetchTransport } from "../analytics/network-guarded-fetch-transport";
import {
  VERSION,
  clearDryRunTransportRecords,
  createAmplitudeClient,
  createDurableAmplitudeStoragePreset,
  createFakeExperimentStorage,
  createMockExperimentClient,
  createNetworkTimingBuffer,
  createTimedAnalyticsTransport,
  createTimedHttpClient,
  Experiment,
  createInstance,
  dryRunHttpClient,
  dryRunTransport,
  getDryRunTransportRecords,
  getAmplitudeErrorCode,
  getDiagnostics,
  getLastNativeError,
  getNetworkEnabled,
  getNativeStartupDiagnostics,
  prefetchNativeContext,
  nitroHttpClient,
  setNetworkEnabled,
  variantBoolean,
  variantString,
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
import * as WebEntry from "../index.web";

type ConnectorGlobal = typeof globalThis & {
  analyticsConnectorInstances?: unknown;
};

type ReactNativeMock = {
  Platform: { OS: string };
};

describe("react-native-nitro-amplitude", () => {
  beforeEach(() => {
    jest.useRealTimers();
    (jest.requireMock("react-native") as ReactNativeMock).Platform.OS = "ios";
    (globalThis as ConnectorGlobal).analyticsConnectorInstances = undefined;
    mockMemory.clear();
    mockDisk.clear();
    for (const key of Object.keys(mockHybridObjects)) {
      delete mockHybridObjects[key];
    }
    resetHybridInstancesForTests();
  });

  it("exports VERSION", () => {
    expect(VERSION).toBe("0.5.0");
  });

  it("exports analytics and experiment factories", () => {
    expect(typeof createInstance).toBe("function");
    expect(typeof createAmplitudeClient).toBe("function");
    expect(typeof Experiment.initialize).toBe("function");
    expect(typeof Experiment.initializeWithAmplitudeAnalytics).toBe("function");
  });

  it("exports durable storage presets and root experiment storage", async () => {
    const preset = createDurableAmplitudeStoragePreset({
      namespace: "preset-test",
      dryRun: true,
    });

    await preset.analytics.storageProvider?.set("events", [
      { event_type: "demo" },
    ]);
    await preset.analytics.cookieStorage?.set("session", {
      deviceId: "device",
      sessionId: 1,
    });
    await preset.experiment.storage?.put("variant", "on");

    expect(await preset.analytics.storageProvider?.get("events")).toEqual([
      { event_type: "demo" },
    ]);
    expect(await preset.analytics.cookieStorage?.get("session")).toMatchObject({
      deviceId: "device",
      sessionId: 1,
    });
    expect(await preset.experiment.storage?.get("variant")).toBe("on");

    await preset.clear();

    expect(
      await preset.analytics.storageProvider?.get("events"),
    ).toBeUndefined();
    expect(await preset.experiment.storage?.get("variant")).toBeNull();
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

  it("uses Nitro transport by default for analytics flushes", async () => {
    const analytics = createInstance();
    try {
      await analytics.init("analytics-key", "default-user", {
        instanceName: "default-transport",
        migrateLegacyData: false,
      }).promise;

      await analytics.track("default_transport").promise;

      expect(mockHybridObjects.AmplitudeStorage?.set).toHaveBeenCalledWith(
        expect.stringContaining("analytics-events::AMP_unsent_analytics-"),
        expect.any(String),
        true,
      );
      await expect(analytics.flushWithResult()).resolves.toMatchObject({
        ok: true,
        failed: 0,
      });
      expect(mockHybridObjects.AmplitudeWorker?.enqueue).toHaveBeenCalled();
    } finally {
      analytics.shutdown();
    }
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

  it("clears stale native diagnostics after successful probes", () => {
    const nitroModules = jest.requireMock("react-native-nitro-modules") as {
      NitroModules: {
        createHybridObject: jest.Mock;
      };
    };
    const createHybridObject = nitroModules.NitroModules.createHybridObject;
    const originalCreateHybridObject =
      createHybridObject.getMockImplementation();

    createHybridObject.mockImplementationOnce(() => {
      throw new Error("native unavailable");
    });

    expect(getNativeStartupDiagnostics()).toMatchObject({
      nativeAvailable: false,
      lastError: {
        message: "native unavailable",
      },
    });
    expect(getLastNativeError()?.message).toBe("native unavailable");

    resetHybridInstancesForTests();
    if (originalCreateHybridObject) {
      createHybridObject.mockImplementation(originalCreateHybridObject);
    }

    expect(getNativeStartupDiagnostics()).toMatchObject({
      nativeAvailable: true,
    });
    expect(getLastNativeError()).toBeUndefined();
  });

  it("reports root diagnostics with native and network status", () => {
    const diagnostics = getDiagnostics();

    expect(diagnostics.native).toMatchObject({
      nativeAvailable: true,
      contextAvailable: true,
      storageAvailable: true,
      workerAvailable: true,
    });
    expect(diagnostics.networkEnabled).toBe(true);
    expect(diagnostics.activeInstanceNames).toEqual([]);
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

  it("supports global network disable and dry-run transport records", async () => {
    clearDryRunTransportRecords();
    expect(getNetworkEnabled()).toBe(true);
    setNetworkEnabled(false);
    await expect(
      nitroHttpClient.request("https://example.com", "POST", {}, null, 1000),
    ).rejects.toMatchObject({ code: "network_error" });
    setNetworkEnabled(true);

    await dryRunHttpClient.request(
      "https://example.com/dry-run",
      "POST",
      { accept: "application/json" },
      "{}",
      1000,
    );
    await dryRunTransport.send("https://example.com/events", {
      events: [{ event_type: "demo" }],
    });

    expect(getDryRunTransportRecords()).toEqual([
      expect.objectContaining({
        url: "https://example.com/dry-run",
        method: "POST",
      }),
    ]);
  });

  it("records bounded analytics and experiment request timings", async () => {
    const buffer = createNetworkTimingBuffer(1);
    const analyticsTransport = createTimedAnalyticsTransport(
      dryRunTransport,
      buffer.record,
    );
    const experimentHttpClient = createTimedHttpClient(
      dryRunHttpClient,
      buffer.record,
    );

    await analyticsTransport.send("https://example.com/events", {
      events: [{ event_type: "demo" }],
    });
    expect(buffer.getTimings()).toEqual([
      expect.objectContaining({
        kind: "analytics",
        method: "POST",
        status: "success",
      }),
    ]);

    await experimentHttpClient.request(
      "https://example.com/variants",
      "GET",
      {},
      null,
      1000,
    );

    expect(buffer.getTimings()).toEqual([
      expect.objectContaining({
        kind: "experiment",
        method: "GET",
        status: 202,
      }),
    ]);
  });

  it("preserves analytics transport compression options when timing requests", async () => {
    const calls: Array<{
      payload: Payload;
      compression?: boolean;
    }> = [];
    const transport: Transport = {
      async send(
        _serverUrl: string,
        payload: Payload,
        enableRequestBodyCompression?: boolean,
      ): Promise<Response | null> {
        calls.push({ payload, compression: enableRequestBodyCompression });
        return {
          status: "success",
          statusCode: 200,
          body: {
            eventsIngested: 1,
            payloadSizeBytes: 1,
            serverUploadTime: 1,
          },
        };
      },
    };

    await createTimedAnalyticsTransport(transport, jest.fn()).send(
      "https://example.com/events",
      { events: [{ event_type: "demo" }] },
      true,
    );

    expect(calls).toEqual([
      expect.objectContaining({
        compression: true,
      }),
    ]);
  });

  it("records timing failures before rethrowing network errors", async () => {
    const buffer = createNetworkTimingBuffer();
    const experimentHttpClient = createTimedHttpClient(
      {
        async request() {
          throw new Error("offline");
        },
      },
      buffer.record,
    );

    await expect(
      experimentHttpClient.request(
        "https://example.com/variants",
        "GET",
        {},
        null,
        1000,
      ),
    ).rejects.toThrow("offline");

    expect(buffer.getTimings()).toEqual([
      expect.objectContaining({
        kind: "experiment",
        method: "GET",
        error: "offline",
      }),
    ]);
  });

  it("reports failed flushes when events stay queued for retry", async () => {
    jest.useFakeTimers();
    const analytics = createInstance();
    const otherAnalytics = createInstance();
    try {
      await analytics.init("analytics-key", "flush-user", {
        instanceName: "flush-failure",
        flushIntervalMillis: 60000,
        transportProvider: {
          async send() {
            throw new Error("offline");
          },
        },
      }).promise;
      await otherAnalytics.init("other-analytics-key", "other-user", {
        instanceName: "flush-other",
        transportProvider: dryRunTransport,
      }).promise;

      analytics.track("flush_failure");

      const result = await analytics.flushWithResult();

      expect(result).toMatchObject({
        ok: false,
        sent: 0,
        failed: 1,
        retried: 1,
      });
      expect(result.reason).toContain("queued event");
      expect(analytics.getDiagnostics().lastFlushError).toContain(
        "queued event",
      );
      expect(otherAnalytics.getDiagnostics().lastFlushError).toBeUndefined();
      expect(otherAnalytics.getDiagnostics().lastFlushTime).toBeUndefined();
    } finally {
      analytics.shutdown();
      otherAnalytics.shutdown();
      jest.clearAllTimers();
      jest.useRealTimers();
    }
  });

  it("counts events still in the timeline queue during flush", async () => {
    clearDryRunTransportRecords();
    const analytics = createInstance();
    try {
      await analytics.init("analytics-key", "flush-user", {
        instanceName: "flush-timeline-queue",
        migrateLegacyData: false,
        transportProvider: dryRunTransport,
      }).promise;

      const trackPromise = analytics.track("flush_timeline_queue").promise;

      const result = await analytics.flushWithResult();
      await expect(trackPromise).resolves.toMatchObject({ code: 202 });

      expect(result).toMatchObject({
        ok: true,
        failed: 0,
        dropped: 0,
      });
      expect(result.sent).toBeGreaterThanOrEqual(1);
      expect(analytics.getDiagnostics().queueSize).toBe(0);
    } finally {
      analytics.shutdown();
    }
  });

  it("reports server-dropped flushes as failed", async () => {
    const analytics = createInstance();
    try {
      await analytics.init("analytics-key", "flush-user", {
        instanceName: "flush-dropped",
        migrateLegacyData: false,
        transportProvider: {
          async send(): Promise<Response> {
            return {
              status: Status.Invalid,
              statusCode: 400,
              body: {
                error: "Invalid API key",
                missingField: "api_key",
                eventsWithInvalidFields: {},
                eventsWithMissingFields: {},
                eventsWithInvalidIdLengths: {},
                epsThreshold: 0,
                exceededDailyQuotaDevices: {},
                silencedDevices: [],
                silencedEvents: [],
                throttledDevices: {},
                throttledEvents: [],
              },
            };
          },
        },
      }).promise;

      analytics.track("flush_dropped");

      const result = await analytics.flushWithResult();

      expect(result).toMatchObject({
        ok: false,
        sent: 0,
        failed: 1,
        dropped: 1,
        retried: 0,
      });
      expect(result.reason).toContain("Invalid API key");
      expect(analytics.getDiagnostics().lastFlushError).toContain(
        "Invalid API key",
      );
      expect(analytics.getDiagnostics().queueSize).toBe(0);
    } finally {
      analytics.shutdown();
    }
  });

  it("records fetch failures for existing experiment fetch APIs", async () => {
    const experiment = Experiment.initialize("fetch-failure-key", {
      retryFetchOnFailure: false,
      httpClient: {
        async request() {
          throw new Error("fetch offline");
        },
      },
    });

    await expect(
      experiment.fetchOrThrow(
        { user_id: "fetch-failure-user" },
        { flagKeys: ["missing-flag"] },
      ),
    ).rejects.toThrow("fetch offline");

    expect(experiment.variantWithMetadata("missing-flag")).toMatchObject({
      reason: "fetch_failure",
    });
  });

  it("wires combined dry-run clients across analytics and experiment", async () => {
    clearDryRunTransportRecords();
    const amplitude = createAmplitudeClient({
      analyticsApiKey: "analytics-dry-run-key",
      experimentDeploymentKey: "deployment-dry-run-key",
      instanceName: "dry-run",
      userId: "dry-run-user",
      durableStorage: false,
      dryRun: true,
      experiment: { retryFetchOnFailure: false },
    });

    await amplitude.init();
    await amplitude.experiment?.fetchWithMetadata(
      { user_id: "dry-run-user" },
      { flagKeys: ["demo-flag"] },
    );

    expect(getDryRunTransportRecords()).toEqual([
      expect.objectContaining({
        url: expect.stringContaining("amplitude"),
        method: "GET",
      }),
    ]);
  });

  it("classifies deployment-key errors distinctly", () => {
    expect(getAmplitudeErrorCode(new Error("Missing deployment key"))).toBe(
      "invalid_deployment_key",
    );
  });

  it("provides typed testing helpers and variant helpers", async () => {
    const storage = createFakeExperimentStorage({ flag: "on" });
    expect(await storage.get("flag")).toBe("on");

    const experiment = createMockExperimentClient({
      bool: { value: "true" },
      string: { value: "enabled" },
    });

    expect(variantBoolean(experiment, "bool", false)).toBe(true);
    expect(variantString(experiment, "string", "fallback")).toBe("enabled");
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
    (jest.requireMock("react-native") as ReactNativeMock).Platform.OS = "web";

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
      expect(WebEntry.nitroTransport).toBeInstanceOf(
        NetworkGuardedFetchTransport,
      );

      const analytics = new WebEntry.NitroAnalyticsStorage<{ value: string }>(
        "persisted",
      );
      const experiment = new WebEntry.NitroExperimentStorage("persisted");

      await analytics.set("event", { value: "stored" });
      await experiment.put("flag", "enabled");

      expect(await analytics.get("event")).toEqual({ value: "stored" });
      expect(await experiment.get("flag")).toBe("enabled");
      const webAnalytics = createInstance();
      await webAnalytics.init("analytics-key", "web-user", {
        instanceName: "web-default",
        migrateLegacyData: false,
      }).promise;
      webAnalytics.track("web_default_transport");
      await expect(webAnalytics.flushWithResult()).resolves.toMatchObject({
        ok: true,
        failed: 0,
      });
      webAnalytics.shutdown();
      expect(mockHybridObjects.AmplitudeWorker).toBeUndefined();
      expect(globalThis.fetch).toHaveBeenCalledWith(
        expect.stringContaining("amplitude"),
        expect.objectContaining({
          method: "POST",
        }),
      );
      await webAnalytics.reset();
      (globalThis.fetch as jest.Mock).mockClear();
      setNetworkEnabled(false);
      const blockedAnalytics = createInstance();
      await blockedAnalytics.init("analytics-key", "web-user", {
        instanceName: "web-blocked",
        migrateLegacyData: false,
      }).promise;
      blockedAnalytics.track("web_blocked_transport");
      await expect(blockedAnalytics.flushWithResult()).resolves.toMatchObject({
        ok: false,
        failed: 1,
      });
      await new WebAnalyticsStorage("analytics-events").reset();
      await blockedAnalytics.reset();
      blockedAnalytics.shutdown();
      setNetworkEnabled(true);
      expect(globalThis.fetch).not.toHaveBeenCalled();
      await expect(
        WebEntry.nitroHttpClient.request(
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
      await expect(
        webNitroHttpClient.request(
          "https://example.com/variants",
          "GET",
          { authorization: "redacted" },
          null,
          1000,
        ),
      ).resolves.toEqual({ status: 202, body: "accepted" });

      expect(globalThis.fetch).toHaveBeenLastCalledWith(
        "https://example.com/variants",
        expect.not.objectContaining({
          body: expect.any(String),
        }),
      );

      (globalThis.fetch as jest.Mock).mockClear();
      (globalThis.fetch as jest.Mock).mockResolvedValueOnce({
        status: 200,
        text: async () =>
          JSON.stringify({
            "web-flag": { key: "on", value: "enabled" },
          }),
      });

      const webExperiment = WebEntry.Experiment.initialize(
        "web-experiment-key",
        {
          instanceName: "web-experiment-defaults",
          retryFetchOnFailure: false,
        },
      );
      await expect(
        webExperiment.fetchWithMetadata(
          { user_id: "web-user" },
          { flagKeys: ["web-flag"] },
        ),
      ).resolves.toMatchObject({
        flagKeys: ["web-flag"],
      });
      expect(webExperiment.variant("web-flag")).toMatchObject({
        value: "enabled",
      });
      expect(mockHybridObjects.AmplitudeStorage).toBeUndefined();

      await analytics.reset();

      expect(values.size).toBe(0);
    } finally {
      setNetworkEnabled(true);
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: originalLocalStorage,
      });
      globalThis.fetch = originalFetch;
    }
  });
});
